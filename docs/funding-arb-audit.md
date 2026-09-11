# funding-arb — Read-only Audit Findings Register

| | |
|---|---|
| **Target** | [`markec12345678/funding-arb`](https://github.com/markec12345678/funding-arb) @ `0373f5d` |
| **Lock status** | LOCKED — Phase-2 paper A/B/C measurement in progress; **zero changes made** to the measured system |
| **Method** | Read-only code inspection at the locked commit (local checkout verified clean at `0373f5d`; identical to GitHub `main`) |
| **Reference standard** | phase3-lab golden contract v1.1.0 — fail-closed semantics (`VENUE_UNAVAILABLE`/`DATA_UNAVAILABLE`/`PRICE_UNAVAILABLE`/`FEE_UNKNOWN` → BLOCK + ALERT) |
| **Rounds** | R1 — API surface · R2 — watcher · R3 — executor/runner order-by-order · R4 — state-by-state failure matrix · R5 — targeted integrity audit (config/experiment/concurrency plane) · R6 — measurement-validity audit (PnL instrument / gates / data-quality plane) · R7 — economic-invariants audit (funding math / quantity-notional / price-source plane) |

**Register status: 42 findings — 3× P0, 20× P1, 15× P2, 4× P3 · 11 deferred to post-Phase-2 hardening.** *(R7: +NEW-16/17/18/19 — the three remaining audit axes executed; NEW-08 materiality re-measured per-leg and confirmed at the upper bound.)*

The dashboard renders this register live (`src/data/audit-findings.ts`) and the failure matrix (`src/data/failure-matrix.ts`); this document holds the evidence.

---

## Round 1 — API surface (`server/main.py` + `server/routes/*`)

Confirmed in REVIEW-1 with full route inventory (23 routes + static + SPA + docs). The middleware *design* is sound (constant-time compare, header-only HTTP auth, pre-routing check before body parse, CORS outermost, WS handshake rejected before accept, close never escalates paper→live, secrets masked, atomic config writes). The **deployment defaults** are fail-open:

### API-01 · P0 · Auth fail-open by default
`FARB_API_TOKEN` unset ⇒ **all 23 `/api` routes unauthenticated**, including `POST /api/positions/open` (live orders) and `POST /api/settings/wallet/connect` (raw secret injection into `os.environ`). `FARB_ALLOW_UNAUTHENTICATED=1` only bypasses the bind guard, not auth — but arrives via plaintext `~/.funding-arb/credentials.json` or `scripts/.env`.

### API-02 · P0 · No hard live gate on the API path
Live trading via API needs only `{"dry_run": false}` + credentials present in process env. The CLI has a `FARB_LIVE=1`-style opt-in; the API has no equivalent server-side hard gate.

### API-03 · P0 · Bind guard bypassable via uvicorn import
Loopback bind protection lives only under `if __name__ == "__main__":`. `uvicorn server.main:app --host 0.0.0.0` — a launch mode the module header advertises — bypasses it entirely.

### API-04 · P1 · wallet/connect arms live trading in one request
Sets `DYDX_ENABLE_LIVE` and injects venue keys into the process env; with auth unset, a single request enables live trading.

### API-05 · P1 · Credential leakage channels
`FARB_ALLOW_UNAUTHENTICATED` + plaintext `~/.funding-arb/credentials.json` and `scripts/.env`.

### API-06 · P2 · Backtest path oracle
`/api/backtest/run` accepts absolute `jsonl_file` paths (file-existence oracle); error strings leak filesystem paths.

### API-07 · P3 · API hygiene gaps
No rate limiting; `/docs` + `/openapi.json` unauthenticated; WS token passed in the query string.

---

## Round 2 — Watcher (`scripts/execution/pure_futures_watcher.py`)

User-reported findings, independently re-verified at the locked commit. All seven confirmed; one amplified.

### W-01 · P1 · Funding-data failure ends the whole cycle — **silently** *(amplified)*
```python
495    except Exception as e:
496        alerts.append(f"rate_fetch_error: {e}")
497        return cycle_result
```
Aborts ALL management (PnL stops, leg checks, rebalance) for **every** open position. **Amplification found during verification:** `cycle_result["alerts"]` is synced from the local `alerts` list only at line 737 and `_append_log(log_path, cycle_result)` runs at line 738 — the early return at 497 skips both. The failed cycle leaves **zero persistent trace**: no returned alert, no `watcher.jsonl` entry, no notification, no stderr print. Detectable only by gap analysis (missing cycle timestamps). Phase-3 contract: `VENUE_UNAVAILABLE` → BLOCK + ALERT.

### W-02 · P1 · Position-fetch failure skips leg checks without escalation state
```python
523        for vid, rows in results.items():
524            if rows is None:
525                failed_venues.add(vid)
526                alerts.append({"alert": "positions_fetch_failed", "venue": vid})
...
627        legs_checkable = (check_legs and not pos_dry_run
630            and pos_long_v in venue_positions and pos_short_v in venue_positions)
```
`fetch failure ≠ no position` is correctly distinguished and a `positions_fetch_failed` alert **is** appended (nuance vs. the original report) — but `legs_checkable=false` silently skips `check_leg_alive()` with **no escalation state**. Safe against false close; unsafe against unmanaged exposure.

### W-03 · P1 · Mark-price failure skips PnL stop-loss
```python
156    except Exception:
157        price = 0.0
158    _mark_price_cache[key] = (now, price)   # 0.0 is cached for 10 s
...
581            long_px = _get_mark_price(pos_long_v, base)
582            short_px = _get_mark_price(pos_short_v, base)
583            if long_px > 0 and short_px > 0:     # PnL stop gated silently
```
The PnL stop-loss runs only when both prices are positive — a mark-price error skips it with no `MARK_PRICE_UNAVAILABLE` alert. The liq-distance alert path also breaks on `mark <= 0` (lines 421–423). Counter-evidence: `check_margin_health` *does* return an explicit `"price_unavailable"` reason (lines 324–325) — the pattern exists in the file, the PnL stop just doesn't use it.

### W-04 · P1 · Fee failure degrades to fee = 0
```python
65 def _venue_taker_fee_pct(venue_id, base, quote="USDT") -> float:
68     """... A resolution failure returns 0.0 so the fee-aware exit degrades
69     to the raw-spread check instead of blocking exits entirely."""
82    except Exception:
83        taker = 0.0
```
Fee error → `exit_fee_pct = 0` (lines 541–543) → NET edge inflated → positions held longer. The docstring documents the deliberate trade-off (degrade-to-raw-spread instead of blocking exits) — but the Phase-3 contract prefers an explicit `FEE_UNKNOWN` state. Mitigating context: `resolve_venue_fee` works offline (VIP0 tier defaults), so the except path is exceptional.

### W-05 · P2 · Funding PnL stop assumes fixed 8 h settlements
```python
592                interval_h = 8.0
593                periods = max(0, held_hours / interval_h)
```
`est_funding_pct = current_spread × periods` regardless of actual settlement intervals — misestimates funding contribution for cross-interval pairs (HL 1 h vs CEX 4/8 h), which the README explicitly documents as supported.

### W-06 · P2 · Silent qty fallback in rebalance check
```python
313    long_qty = short_qty = qty
314    if venue_positions:
315        actual_lq = _leg_qty_from_snapshot(venue_positions, long_venue, base, "long")
317        if actual_lq:          # qty 0 is falsy → stale pos["qty"] survives
318            long_qty = actual_lq
```
An actual quantity of 0 (partial liquidation/ADL, or the venue missing from the snapshot) keeps the stale `pos["qty"]`. Masked by `check_leg_alive()` in the normal flow; manifests with `watcherCheckLegs=false`. Note the contrast: the **executor's** rebalance handles the same read correctly (`if api_lq is not None`, executor lines 906–914).

### W-07 · P3 · CI comment 535 vs 539
`.github/workflows/ci.yml:10` — "535-test matrix"; known count is 539. Doc drift only; deliberately not fixed during the lock.

---

## Round 3 — Executor & runner, order-by-order

Full read of `pure_futures_executor.py` (988 lines), `run_pure_futures_spread.py` (260), plus `cross_venue_executor.py` helpers and the Binance adapter's order path. Order lifecycle: pre-submit recheck → leg A → partial fill → leg B → rollback → close → ledger → restart.

### What is already solid (design strengths observed)

- **Pre-submit funding re-check exists** (executor 378–403) and is **fail-closed in live** by default (`fundingRecheckFailOpen` defaults to `dry_run`).
- **Margin pre-check is fail-closed** by default (`marginCheckFailOpen=False`, executor 156–185, 433–450), with an explicit documented opt-out.
- **Ledger hygiene:** atomic writes (tempfile + `os.replace`), file lock, and corruption **quarantine** instead of silently returning `[]` (executor 48–104) — live legs are not invisibly orphaned by a truncated file.
- **Sequential path partial-fill sizing is correct:** leg B is sized to leg A's *actual* fill (`short_trade["amount_base"] = exec_qty`, 581–582); the close sizes leg 2 to leg 1's *actual* closed qty (730–733).
- **Watcher emergency routing is correct:** `both_legs_gone` → manual review, **no orders placed** (a close order on a vanished leg would open a new position); single-leg-gone → close only the surviving leg (watcher 636–668).
- **`reduce_only` on close orders** (Binance adapter 972, 984) prevents double-exposure when a close is retried after a timeout ambiguity.
- The module docstring is honest: "Best-effort rollback on leg failure; naked state if rollback fails, requires manual handling."

### E-01 · P1 · Submit-timeout ambiguity can orphan a filled leg with zero alerts
Order results are **single-shot POST responses**: `place_futures_order` returns `ok=True` if the call doesn't throw (binance.py 841–897) and `ok=False` on **any** exception — including a network timeout *after* the exchange accepted the order. `_filled()` is status-based (`status in ("filled","simulated")`, cross_venue_executor 241–248). Nothing ever queries order status by `clientOrderId` (it is generated — `qfut…` — but never reused) before deciding a leg failed and rolling the other leg back.

Worst case (parallel open, default `parallelLegs=true`): long POST times out but **fills on the venue**; short fills normally → `long_ok=False, short_ok=True` → rollback closes the short → final state: **naked long on the venue, ledger clean, result "rolled_back", no notification.** The same class exists in the sequential path (571–577: abort with no record) and the close path (725–729: abort; position stays open — safer).

### E-02 · P1 · Open-path naked legs are never persisted
When a rollback *does* run and fails, the executor returns `"naked"` + a one-shot `send_notification` — but **writes no ledger record** (the position record is only written in the both-filled branch, 498–521 / 588–609). The watcher iterates open positions from `positions.json`, so it can never see the naked leg: no re-alerting, no escalation, no retry. Asymmetry: the **close-path** naked leg keeps the position "open" in the ledger (773–779) and therefore stays watched; the open path is the blind spot. Phase-3 contract: dangerous states must remain under supervision until resolved.

### E-03 · P2 · Depth pre-check fails open by default in live mode
`fail_open=bool(pfa_cfg.get("depthCheckFailOpen", True))` (executor 372) — a depth-API **error** lets the open proceed without the slippage gate. Inconsistent with the two sibling gates (margin: fail-closed default; funding re-check: fail-closed in live).

### E-04 · P2 · Runner treats a scanner data gap as an exit signal
```python
131        edge = float(row.get("net_edge_pct", -999.0)) if row else -999.0
132        should_close = row is None or edge <= exit_edge
```
The scan runs with relaxed thresholds (`min_edge=-999`, so a healthy pair always appears) — meaning `row is None` is mostly a **data problem** (venue fetch failure in the scanner, venue removed from config), not "edge collapsed". The position is then closed at market. No distinction between "edge genuinely collapsed" and "data unavailable". This is the mirror image of the watcher's W-01 (watcher fails-open by skipping; runner fails-closed by closing) — both directions violate the Phase-3 `DATA_UNAVAILABLE` contract.

### E-05 · P2 · Partial-close residual leaves the ledger
`_filled()` is true for an *accepted* order, and `exec_qty` comes from the immediate POST response — which can understate the fill (async fills; binance.py 878–881). If the short close reports `exec_qty < qty`, the long close is sized to the understated qty and `_mark_closed` (740–749) closes the **whole** position. The residual pair (equal qty on both legs → still hedged) stays on the venues but exits the ledger: no PnL stop, no funding accrual tracking, no leg-alive check.

### E-06 · P3 · Rebalance ledger update assumes a full trim
After a trim, `long_qty`/`short_qty` are set to `min(lq, sq)` (972–987) even if the trim order partially filled. Residual skew is misrecorded, but self-heals next cycle because rebalance re-reads actual quantities from the venue API (906–914).

---

## Round 4 — State-by-state failure matrix

Goal (per the review direction): stop hunting random bugs and instead **prove that every possible ambiguity has exactly one safe state transition**. 21 cells across three groups (ORDER SUBMITTED ×9, POSITION ×6, RECOVERY ×6), each traced to actual code at the locked commit.

**Score: 5 SAFE · 9 AMBIGUOUS · 7 GAP.**

### Verdict summary

| Group | Cells | Verdicts |
|---|---|---|
| ORDER SUBMITTED | 9 | 1 safe · 4 ambiguous · 4 gap |
| POSITION | 6 | 3 safe · 2 ambiguous · 1 gap |
| RECOVERY | 6 | 1 safe · 3 ambiguous · 2 gap |

The five passing cells are exactly the **dangerous-position routing**: single-leg-gone → close survivor only (PO-1), local-closed/venue-open → re-hedge + stay watched (PO-2), external reduction → deterministic detection (PO-6), emergency unwind (RC-5), and the plain success path (OS-1). Execution *routing* is sound. All 16 non-safe cells cluster on the **ambiguity plane**: unknown submit outcomes, recovery, repeated failure.

### ORDER SUBMITTED (OS-1 … OS-9)

The group's structural fact — every cell below inherits it:

```python
# venues/binance.py — place_futures_order
850    client_oid = f"qfut{int(time.time())}{random.randint(0, 9999)}"   # generated…
863        "newClientOrderId": client_oid,                                # …sent…
900    except urllib.error.HTTPError as e:
905        return False, {"error": f"HTTP {e.code}: {body[:200]}"}       # …and discarded
906    except Exception as e:
907        return False, {"error": str(e)}                                # ← ALL roads
```

```python
# cross_venue_executor.py
241  def _filled(results):
242      return bool(results) and results[0].get("status") in ("filled", "simulated")
# binance.py:988  record["status"] = "filled" if ok else "failed"   ← accepted == filled
```

- **OS-1 success → SAFE.** HTTP 200 → ledger opened with actual `exec_qty`/prices (executor 494–521 / 585–610). Nuance: `ok` means *accepted*; `order_status` (NEW/PARTIALLY_FILLED) is recorded but never gated.
- **OS-2 timeout → GAP (E-01).** `urlopen(req, timeout=15)` raises → generic except (906) → `ok=False` → treated as order-not-placed → other leg rolled back. Venue state UNKNOWN handled as KNOWN-FAILED.
- **OS-3 connection reset → GAP.** Identical code path to timeout (the same `except Exception`).
- **OS-4 HTTP 5xx → AMBIGUOUS.** `HTTPError` branch keeps the code in the error string (auditable) but shares the rollback path with timeout; nothing branches on the code.
- **OS-5 accepted-but-response-lost → GAP (E-01 worst).** Two variants, one outcome: response never arrives, **or arrives truncated** — `json.loads` raises *inside* the try (114–116) → the same generic except → `ok=False`. Order live on the venue, ledger clean, other leg rolled back → naked.
- **OS-6 duplicate retry → AMBIGUOUS.** POST is single-shot (`retries = 3 if method == "GET" else 1`, binance.py 96–97) — no transport duplicate; `reduceOnly` on closes makes a duplicate close a venue-side no-op (965–985). But duplicate **opens** are possible after a crash-in-window or quarantined ledger: the runner gates opens on ledger `active_keys` (run_pure_futures_spread.py 147–161).
- **OS-7 partial fill → AMBIGUOUS.** Sequential path sizes leg B to leg A's actual fill (581–582) — correct. Parallel path records actual per-leg qtys (visible skew) and the watcher flags `rebalance_needed`, but auto-trim needs `autoRebalance=true` — **default false** (watcher 458). If `executedQty=0` comes back, `_exec_qty` falls back to TARGET (M-05).
- **OS-8 delayed fill → AMBIGUOUS.** No post-submit status check exists for futures orders (`_fetch_order_detail` is spot-only, 712–721); `avgPrice=0` → `ref_price` fallback (880). Ledger approximate; nothing ever re-reads the order.
- **OS-9 unknown status → GAP.** Every non-HTTP exception collapses into the same `ok=False` "failed" label: **nine outcomes reduce to two observable states** — the ambiguity itself is unobservable downstream.

### POSITION (PO-1 … PO-6)

- **PO-1 local open / venue closed (single leg) → SAFE.** `check_leg_alive` (95% tolerance, watcher 349–393) → `close_pure_futures_leg` on the surviving leg only, reduce_only, notification, watcher.jsonl audit. Precondition: both venue fetches succeeded.
- **PO-2 local closed / venue open → SAFE (main path).** Close-path failure re-opens the short (752–771) → ledger stays open → watched; if the re-hedge also fails, the next watcher cycle emergency-closes the surviving long (self-heal). Subcase: partial close understated → `_mark_closed` closes the whole record → residual invisible (E-05).
- **PO-3 partial residual → GAP.** Nothing ever re-examines a closed position; the residual pair stays hedged on the venues but exits the ledger — no PnL stop, no funding accrual, no leg-alive check, forever.
- **PO-4 stale snapshot → AMBIGUOUS (W-02).** Fetch failure → `legs_checkable=false` → skip + `positions_fetch_failed` alert (logged). Safe against false close, but no escalation state — can persist for hours with zero management.
- **PO-5 venue unavailable → AMBIGUOUS.** Funding path: W-01 early return bypasses both the alert sync (737) and `_append_log` (738) — zero persistent trace, so "API down vs process dead vs never ran" is indistinguishable from the logs. Positions path: alert + skip (W-02). Mark-price path: PnL stop silently gated on `> 0` (W-03).
- **PO-6 external reduction → SAFE (detection).** `check_rebalance` reads the venue snapshot → `rebalance_needed` alert every cycle (deterministic, logged); auto-trim opt-in; the executor trim itself reads actual venue qty correctly (`is not None`, 906–914).

### RECOVERY (RC-1 … RC-6)

- **RC-1 restart → AMBIGUOUS.** Clean ledger: atomic writes + file lock → deterministic resume. Crash in the order→ledger window: **no startup reconciliation exists** → naked legs invisible to every subsequent cycle. Corrupt ledger: quarantine is loud, then amnesia — `[]` frees slots → duplicate opens possible (M-03). Verified: grep for recover/repair/reconcil across `execution/` and `tools/` finds only the quarantine docstring.
- **RC-2 retry → AMBIGUOUS.** Opens gated by ledger `active_keys` — safe IF the ledger is accurate, which is exactly what E-01/E-02 corrupt. Close retries are venue-side no-ops (reduceOnly).
- **RC-3 reconciliation → GAP.** As a named recovery mechanism it does not exist: no order-level query by clientOrderId, no startup venue↔ledger diff, no closed-position residual scan. The only venue↔ledger comparisons are per-position and per-cycle.
- **RC-4 rollback → AMBIGUOUS (asymmetry).** Close-path rollback keeps the position open and watched (self-heals). Open-path rollback: ok → `rolled_back` with a clean ledger (wrong under E-01 ambiguity); failed → `naked` + one-shot notification but **no ledger record** (E-02) → invisible thereafter.
- **RC-5 emergency unwind → SAFE.** `close_pure_futures_leg`: surviving leg only, reduce_only, notification on failure, ledger closed on success, watcher.jsonl action logged; `both_legs_gone` → no orders + manual_review alert.
- **RC-6 repeated failure → GAP.** No terminal failure state anywhere: failure N is indistinguishable from failure 1 — no circuit breaker, no HALT/BLOCK, no escalation ladder. Notifications are stderr (dies with the process) + fire-and-forget Telegram with an in-memory dedup cache a restart clears (core/notify.py 38–70). The system can fail forever in exactly the same way.

### Cross-cutting root causes (register: M-01 … M-05)

1. **M-01 · P1 · Two-valued submit contract** — all nine submit outcomes collapse into `ok:bool`; clientOrderId discarded on every error path; accepted conflated with filled. Blocks OS-2/3/5/9 + rollback/retry cells. *The disambiguation mechanism exists in the codebase and is never used.*
2. **M-02 · P1 · Ledger is sole truth, never reconciled inbound** — every retry/restart/duplicate decision keys off `positions.json`, but nothing ever cross-checks venue vs ledger. Blocks RC-1/2/3.
3. **M-03 · P1 · Corrupt-ledger quarantine ends in amnesia** — loud detection, unsafe aftermath ([] → slots freed → duplicate opens stacked on live venue positions).
4. **M-04 · P2 · No terminal failure states** — no circuit breaker / HALT / escalation ladder; notification durability is stderr + fire-and-forget Telegram with restart-volatile dedup.
5. **M-05 · P2 · Unconfirmed fill recorded as target qty** — `_exec_qty` target fallback on `exec_qty=0`; no post-submit status check for futures orders.

### What the matrix proves

- The **execution routing core is sound**: the five cells where a human trader would most need determinism (leg gone, both gone, emergency unwind, external reduction, clean success) each have exactly one safe, conservative, audited transition.
- The system **cannot yet prove the Phase-3 contract** on the ambiguity plane: 7 cells have no safe transition at all, and 9 depend on luck, config, or a next-cycle self-heal. "539 tests green" covers the happy paths and the *designed* failures; the matrix covers the *undesigned* ones.
- All 16 non-safe cells reduce to **five structural causes** (M-01…M-05) — meaning the post-Phase-2 hardening pass has a short, high-leverage punch list, not a long tail: (1) submit contract → UNKNOWN + clientOrderId reconcile, (2) inbound reconciliation on start + on naked, (3) safe post-quarantine state, (4) terminal failure states, (5) confirmed-fill recording.

---

## Deferred (repo locked — patch ready)

### D-01 · P1 · funding-arb README
"370+ tests" vs actual 539; clone URL points to `counterfactual5/funding-arb` instead of `markec12345678/funding-arb`. Exact patch prepared in REVIEW-1; apply as a single commit when the lock lifts.

---

## R4 closure — hardening-pass plan (review decision, 2026-09-11)

**The audit phase is CLOSED.** R4 proved the boundary of the system (a stronger result than the 539-test green matrix, which covers only designed failures); further blind bug-hunting in funding-arb is explicitly retired. The register (26 findings at closure; 33 after R5; 38 after R6) + matrix (21 cells) are the complete **pre-change audit trail** — which is exactly why they were recorded before touching anything. *R5/R6 refinement of the closure scope: random bug hunting stays retired, but targeted integrity + measurement-validity audit remains valid — see Rounds 5 and 6.*

**Nothing is fixed now, deliberately:** the Phase-2 A/B/C measurement is running on `0373f5d`; changing execution semantics mid-measurement would mix the baseline with post-hardening results and destroy the experiment's value. Decision gate: Phase-2 verdict → **A/B** = harden + port (Phase-3 safety) · **C** = root-cause + archive lab.

### Remediation order (refined by the review)

1. **M-01 + M-05 — ONE patch, the multi-valued submit contract.**
   `submit()` must return `SUBMITTED → FILLED | PARTIAL | REJECTED | CANCELED | UNKNOWN` — never a bool. **UNKNOWN ≠ FAIL:** timeout, connection reset and unparseable JSON mean "exchange may have accepted the order; the client never received confirmation". The already-generated `clientOrderId` becomes the reconciliation key (currently generated, sent, discarded). `requested_qty / filled_qty / remaining_qty / order_status` recorded as separate fields — only then can partial fill, timeout, retry, duplicate submit, rollback, repair and restart be decided correctly. Solving M-05 separately from M-01 is explicitly rejected: submitted ≠ filled is the same contract.
2. **M-02 + M-03 — ONE safety combination (the flagged chain):**
   corrupt ledger → quarantine → ledger appears empty → free capacity → new OPEN → existing venue position remains → **DUPLICATE EXPOSURE**. A safety failure, not a bookkeeping bug. The Phase-3 principle `local state ≠ truth` is absent from the open path. Startup contract: `LOAD LEDGER → VALIDATE → RECONCILE VENUE → ONLY THEN ALLOW NEW OPEN` — never `ledger empty? → OPEN`.
3. **M-04 — terminal state machine, for forensics:**
   `HEALTHY | BLOCKED | REPAIR | ESCALATE | CONFLICT | UNWOUND`. With 20 identical-looking errors and no terminal state, a restart cannot answer *why the system was not allowed to continue*. Alerting ≠ safety state machine.
4. Remaining register items (API-01/02/03, W-01..W-06, E-01..E-06, D-01) per the order above.

### Regression proof

After the hardening pass, **re-run this exact R4 matrix** against the hardened commit. Target: 21/21 `safe` (or every remaining non-safe cell explicitly waived with a documented reason). The matrix is the acceptance test for the hardening pass — the same instrument, before and after.

### Empirical corroboration observed in the Phase-2 baseline (read-only)

The running paper journal (2026-09-10T13:06Z → 2026-09-11T10:41Z at the time of the finding; 248+ real cycles, 168 opens / 11 closes) shows **5 of 11 closes (45 %) carrying `edge=-999.0`** — the E-04 signature: the scanner row for the pair was missing (venue data gap) and the runner treated it as an exit signal. Harmless in paper mode, but it means **the Phase-2 exit statistics are measurably contaminated by E-04** — nearly half of paper exits are data-gap closes, not genuine edge-collapse exits. This is the finding firing in the wild, on the record, pre-change; the A/B/C verdict should read exit counts with this in mind.

**Directional contamination (measured with the passive classifier):** the contamination is not only count-based — it is PnL-directional. Genuine edge-collapse exits: 6 closes, **total −0.403 %** (avg −0.067 %). E-04 data-gap exits: 5 closes, **total +0.465 %** (avg +0.093 %). The raw baseline's near-zero exit PnL (+0.062 % total) is an artifact of mixing two groups that pull in opposite directions. Reading only the raw number would conclude "the strategy breaks even on exits"; the split shows genuine strategy exits slightly negative while exits taken on missing data happen to be positive. The verdict must be computed on **both views** (raw + diagnostic) — this is now rendered continuously in the tower's exit-classification card (`src/server/exit-classification.ts`, read-only: journal + positions ledger only, runner untouched).

**Reporting contract (review decision, 2026-09-11):** the final A/B/C report never presents a single PnL number. The **strategy-attributable** result (diagnostic baseline — genuine strategy exits with data-gap closes held apart) is the **primary** figure; the **raw** result and the **E-04 contamination** split are always shown alongside it, with the arithmetic identity `strategy-attributable + contamination = raw` carried as a built-in ✓/✗ attribution check on the rendered totals (−0.403 % + 0.465 % = +0.062 % ✓) so the decomposition can never silently drift from the raw number it explains. The tower card enforces this hierarchy visually (primary panel first, decomposition second) and additionally renders a **survival** line — opened positions → closed genuine · closed data-gap · still open — answering "how many opens survive to a normal close" as a live dashboard number. E-04 remains deliberately unfixed during Phase-2: the current error is measured and documented, and fixing it mid-sample would mix the baseline with post-fix behavior.

---

## Round 5 — targeted integrity audit (review round, 2026-09-11)

Scope: one level deeper than the dashboard — the locked `0373f5d` read through **runner → executor → scanner → strategy config → mismatch planner → orchestrator → watcher → persistence**. Provenance: user-driven review round; every claim independently re-verified at the locked commit before entering this register (preveri, ne predvidevaj). **Scope refinement of the R4 closure: random bug hunting stays retired; targeted integrity audit (the experiment-validity plane) remains valid** — R5 is exactly that, and it is read-only: all seven findings are **post-Phase-2 remediation candidates**, nothing is fixed during the measurement.

### NEW-01 · P1 · orchestrator opens duplicates — no active-position gate
The paper runner gates every open on `active_positions` / `active_keys` / `maxConcurrentPairs` (`run_pure_futures_spread.py:148-159`). The orchestrator's `--pure-futures --run-executor` path does not: `candidates → sort → candidates[:max_pairs] → open_pure_futures_pair()` (`cli/orchestrate_funding.py:509-517`) with no ledger query, no `active_keys`, and no dedup inside the executor itself. A second invocation or restart can re-see the same candidate and open a duplicate pair stacked on the live venue position — compounding M-02/M-03 (the ledger is never reconciled inbound). Not active in the current single-PID paper baseline; latent for the live/orchestrator path.

### NEW-02 · P1 · auto-spawned watcher can run a DIFFERENT config than the runner
`_run_pure_futures_mode()` builds its own cfg via `load_strategy_config()` + `apply_strategy_to_pure_futures_cfg()` (lines 436, 449), but the `--auto-spread-watch` watcher is launched with `watcher_cfg = args.config or <raw template path>` (line 549) — **the strategy overlay is not passed**. Runner and watcher can disagree on trade_usd, thresholds and max_positions: a config split in which two processes believe they execute the same experiment while they do not. Not active in the current paper loop (the watcher is not spawned); latent for the orchestrator/live path.

### NEW-03 · P2→P3 (amended in R6) · paper funding re-check — code default vs active template
`fail_open = fundingRecheckFailOpen or dry_run` (`pure_futures_executor.py:399`): in paper mode a funding recheck API failure lets the candidate proceed *when the config omits the key*. **R6 AMENDMENT (full template re-read — the R5 read was truncated):** the locked paper template explicitly sets `fundingRecheckFailOpen: false` (and `fundingRecheck: true`, `fundingRecheckMinSpreadPct: 0.02`, `feeAwareExit: true`, `parallelLegs: true`), and `cfg_lookup` checks the `pureFuturesArbitrage` block first — so the **ACTIVE Phase-2 baseline is fail-closed on ALL three pre-open gates** (depth, margin, funding recheck). The original R5 claim of an active paper-gate divergence was **wrong** and is corrected here. What remains is the capability/config distinction: the executor *supports* fail-open and any config without the override silently re-enables it in paper mode — a latent risk, not an active divergence. The final A/B/C report needs **no PAPER GATE DIVERGENCE label for this baseline**. Severity amended P2→P3.

### NEW-04 · P1 · corrupt strategy config silently becomes DEFAULT config
`load_strategy_config()` wraps the read in `except Exception: pass` and returns `DEFAULT_STRATEGY` (`core/strategy_config.py:35-46`) — trade_usd 5000, 4-CEX scans, default thresholds. A configuration error changes the experimental parameters with **no crash and no alarm**. For Phase-2 the config is effectively part of the immutable experimental baseline; a silent default swap mid-run would be contamination. P1 for validation integrity, P2 for execution. Post-Phase-2 fix: fail loud.

### NEW-05 · P1 · strategy config not locked/hashed into the experiment record
Every journal cycle records thresholds, but the strategy config is an external mutable file — nothing pins the full config (a `strategy_config_hash` / `config_version` / locked manifest) to the sample. Mid-experiment changes would mix two experiments into one journal. **Labeling (important): no evidence of actual config mutation — the invariant is currently UNENFORCED. This is a contamination possibility, not contamination.**

**Empirical corroboration (read-only, current baseline):** across all 261 real cycles the journal carries **exactly one thresholds variant** (`minSpreadPct 0.04 · minNetEdgePct 0.02 · exitThresholdPct 0.01 · minEdge1h 0.01 · allowSettleMismatch false · feePolicy auto`); `trade_usd = 500.0` on all 14 positions — **never** the DEFAULT_STRATEGY 5000, so the silent-default signature is absent; and the journal thresholds differ from the template defaults, proving they come from the strategy overlay — which therefore never changed. **For every dimension the journal records, the sample IS one experiment — verified.** Day-5/7 verdict additionally checks config continuity; post-Phase-2 fix: hash the config into every cycle snapshot.

### NEW-06 · P2 · atomic write is not durable (no fsync before rename)
`_save_positions()` = temp write + `flush()` + `os.replace()` without `fsync()` (`pure_futures_executor.py:61-80`): application crash is covered, OS/power failure is not. "Atomic" ≠ "durable" — the ledger's durability guarantee is weaker than it reads. Post-hardening item.

### NEW-07 · P2 · multi-process TOCTOU on the open decision
The file lock covers ledger **writes** only. The open decision spans load positions → compute slots → choose candidate → place orders → record — unlocked throughout (`run_pure_futures_spread.py:147-199`). Two concurrent runners both see 2/3 slots, both open, both record: capacity exceeded and possible same-pair duplicates. Distinct from M-02/M-03 (corrupt ledger) — a race on a *healthy* ledger. Not proven active with the current single PID (12976); real for production. P2 now, P1 for the live path.

### Verified clean in this round (recorded to prevent re-auditing)
The **scanner plane** was specifically checked for a false-safe hole and is clean: pair construction compares both rates, assigns higher-rate short / lower-rate long, honors settlement intervals, applies `pair_pure_futures_spread`, subtracts fees and only then admits a candidate. The scanner's top-N depth enrichment is **not** a safety hole because the executor re-runs `check_pair_depth` at open time for the actual candidate (and the paper template runs it fail-closed, `depthCheckFailOpen: false`).

### R5 remediation placement
All seven are **post-Phase-2** items and slot into the existing hardening plan without changing its order: NEW-01/NEW-07 extend the M-02+M-03 safety combination (ledger truth + locking); NEW-02 rides the M-04 state-machine patch (watcher lifecycle); NEW-04/NEW-05 are the experiment-integrity pair (fail loud + config hash) — cheap, and the first thing to land after the gate; NEW-06 is a one-line durability addition. NEW-03 needs no code change before the verdict: it is carried as a labeled divergence in the final A/B/C report.

---

## Round 6 — measurement-validity audit (review round, 2026-09-11)

Scope: the locked `0373f5d` read through the **measurement instrument itself** — PnL formulas, entry/exit gates, funding semantics, data-quality paths. Provenance: user-driven review round; every claim independently re-verified at the locked commit before entering the register. Read-only: all new findings are post-Phase-2 candidates or report-labeling rules; **nothing is fixed during the measurement**.

### NEW-08 · P1 · paper PnL does not measure actual funding cashflow
`estimate_spread_pnl()` (`pure_futures_watcher.py:247-272`) computes **price-spread convergence only** — its own docstring: "Price P&L = inter-venue spread at open - inter-venue spread now". Funding appears only as a stop-loss **estimate** (current spread × elapsed periods, fixed `interval_h = 8.0` — see W-05), never as realized cashflow; in paper mode actual funding does not exist. Therefore: **paper result = spread convergence ± fees, NOT the strategy's economics** (price convergence + realized funding received/paid − fees). Phase-2 can validate execution/funnel/price-convergence behavior; it cannot by itself prove funding-cashflow ROI.

**Materiality (read-only, rough 2-point estimate over the classified closes; settlements = held_h / 8h per W-05, close spread from edge+fees, data-gap closes decayed to 0):** for the **7 strategy-attributable closes** the excluded funding component is **≈ +1.03 %** (linear decay open→close) to **+1.60 %** (spread held constant) — versus the measured **−0.424 %** paper spread PnL. The excluded component is **2–4× the measured one and opposite in sign**. If the estimate is even roughly right, the true strategy economics are *positive* while the paper spread PnL reads negative — the paper instrument cannot decide the strategy's economics, and the Day-5/7 verdict must say so explicitly.

### NEW-09 · P2 · funding recheck verifies RAW spread, not net executable edge
`recheck_funding_edge()` (`funding_recheck.py:139-176`) re-fetches both legs and checks `spread_pct >= fundingRecheckMinSpreadPct` (template: 0.02) — the **raw funding spread only, no fee subtraction**, while the scanner entry gate required `net_edge >= 0.02` (spread ≥ fees + 0.02 ≈ 0.13 at 0.11 fees). Example: funding spread 0.06 % + fees 0.11 % → net edge −0.05 %, recheck says OK. It is the **last economic gate before submit in paper mode** (margin is live-only, depth is non-economic), so a spread collapse into [0.02, fees+0.02) can open at negative net edge — bounded by the exit logic closing it on the next cycle. Architecturally the recheck is weaker than the economic decision it re-verifies.

### NEW-10 · P2 · exit decision is funding-based, PnL attribution is price-based
Close signal: runner exit = net **funding** spread ≤ exit threshold; watcher `check_exit` = **funding** spread − fees ≤ threshold (`feeAwareExit`). Attributed result: **price**-spread convergence (`estimate_spread_pnl`). The signal triggering a close and the PnL booked to it are different economic components — an attribution-integrity caveat that must accompany any per-exit PnL reading, including the strategy-attributable primary view.

### NEW-13 · P2 · failed mark price is CACHED as 0.0 for the TTL
`_get_mark_price()` (`pure_futures_watcher.py:141-159`): on API failure `price = 0.0` and **then it is written into the cache** — a transient failure becomes a cached unavailable price for the whole TTL, unlike the usual failure→don't-cache pattern. Downstream the PnL stop runs only when both legs > 0, so a short data failure silently extends the PnL-stop outage beyond the failing call. (W-03 records the skip; this registers the failure-caching that extends it.)

### NEW-15 · P1 · four different economic truths — the naming rule (validation limitation)
The paper experiment carries four distinct metrics that are not one quantity: **entry edge** = funding spread − fees · **exit edge** = funding spread − fees · **PnL** = price-spread convergence · **funding** = estimated only, never realized. Consequence — the naming rule, now enforced in the tower labels: the primary result is reported as **strategy-attributable paper SPREAD PnL**, with the explicit limitation **"realized funding cashflow = not observed in paper mode"** — never as funding-arbitrage profitability. A validation limitation, not a reason to stop Phase-2. Post-gate fix if the project continues: realized-funding accounting in the paper instrument.

### Re-confirmations of already-registered findings (no new entries)
- **NEW-11 → E-04** (re-confirmed): `row is None → exit` in `run_once()` — E-04 is an **execution policy** (missing observation → exit decision), not merely a reporting anomaly; the +0.465 % data-gap group are exits taken on missing data. E-04's register entry amended with this insight.
- **NEW-12 → W-06** (re-confirmed): `if actual_lq:` truthiness drops a legitimate 0.0 quantity in rebalance.
- **NEW-14 → W-04** (re-confirmed): fee-provider failure degrades to `taker = 0.0` — `feeAwareExit=true` does not mean fee-aware when the provider is down.

### Template capability vs active configuration (NEW-03 corrected)
The locked template is **safer than the executor code reads**: `depthCheckFailOpen: false` · `marginCheckFailOpen: false` · `fundingRecheck: true` · `fundingRecheckFailOpen: false` · `feeAwareExit: true` · `parallelLegs: true`. The ACTIVE Phase-2 baseline is fail-closed on all three pre-open gates. Generic "fail-open gate" findings are therefore **code-capability notes, not active baseline problems** — see the NEW-03 amendment above (P2→P3, R5 claim corrected: the R5 template read was truncated).

### R6 scope-closure — the three remaining audit axes
Generic bug hunting stays retired. Remaining axes where genuinely new information is still possible (all post-gate, all read-only until then):
1. **Funding-calculation correctness** — is `short_rate − long_rate` economically correct for every forward/reverse/interval combination?
2. **Quantity/notional correctness** — is every PnL, fee, depth and margin computation on the same notional basis?
3. **Timestamp/data-freshness correctness** — is every rate/price/fee used with a known timestamp, and can stale data influence a decision?

### Live-sample note (advanced during this round)
The sample moved while R6 was being processed: **12 closes** (7 strategy-attributable, −0.424 % · 5 data-gap, +0.465 % · raw +0.041 %; identity holds), 15 opened → 12 closed (7 genuine · 5 data-gap) · 3 still open. All numbers in this section refer to this snapshot; the tower renders them continuously.

---

## Round 7 — economic-invariants audit (review round, 2026-09-11)

Scope: the three audit axes left open after R6, executed as one user-driven review round — **funding-calculation correctness → quantity/notional correctness → price-source correctness**. Provenance: user-driven review round on the locked `0373f5d`; every claim independently re-verified at the locked commit before entering the register (preveri, ne predslidevaj), and the two quantity findings additionally verified **empirically against all 15 ledger rows**. Read-only: all four findings are post-Phase-2 candidates; **nothing is fixed during the measurement**.

### NEW-16 · P1 · the price named “mark price” is the futures ticker/last price
The venue contract is explicit (`venues/base.py:100-110`): `get_ticker()` = “Spot ticker price fallback”, `get_futures_ticker()` = “Perpetual futures ticker price fallback”, `get_all_futures_tickers()` = “**Bulk perpetual futures last prices**”. Yet the watcher's accessor is **named** `_get_mark_price()` (`pure_futures_watcher.py:141-159`) and feeds that ticker into spread PnL (581-584), rebalance notional (322-328), margin/liq distance (421) and the close warning — with the bulk prefetch (`:488`) filling the same cache from `get_all_futures_tickers()` (last prices). The executor's `_leg_market` (`cross_venue_executor.py:178-196`) uses `get_futures_ticker()` for open/close leg prices, so **the entire paper PnL instrument runs on last/ticker prices**: ledger `long_price`/`short_price`, close `ref_price`, `mark_spread_pct`, `close_mark_spread`. **Verification deepened the finding:** on the cache-miss path `_get_mark_price()` calls `get_ticker()` — the **SPOT** price on CEX venues (the docstring itself says “futures callers should prefer get_futures_ticker()”). On small caps `last ≠ mark` materially, so a metric named mark_price is not necessarily the mark. Not proof that the 12 closes are wrong — proof that the named metric is mislabeled; it strengthens NEW-08 (the instrument measures **last-price** spread convergence).

### NEW-17 · P1 · trade_usd is NOT the notional of either leg
The executor sizes both legs with `ref_px = max(long_px, short_px)`; `base_amount = floor(trade_usd / ref_px)` (`pure_futures_executor.py:324-325`). The leg on the cheaper venue therefore carries a notional **below** trade_usd and only the higher-priced leg reaches it (after flooring, neither may). **Empirically verified on all 15 ledger rows:** one leg ≈ trade_usd, the other short by up to $3.65 (0.2–0.7 %) — never `trade_usd + trade_usd`. Consequence: funding cashflow cannot be computed as `trade_usd × funding spread`; the correct estimate is `short_notional × short_rate × periods_s − long_notional × long_rate × periods_l` — each leg its own notional, interval and rate (exactly what the R7 invariant test now computes). Distinct from NEW-08 (funding absent from paper PnL): this is the quantity-integrity requirement for estimating it at all.

### NEW-18 · P2 · ledger trade_usd is the REQUESTED notional, not the executed one
After quantity flooring and per-leg price divergence the ledger still records the original config `trade_usd` (500.0 on all rows; `pure_futures_executor.py:409-425`) — a requested-notional field in a row whose actual notionals are `qty × leg_price`. Not an execution bug; a measurement-ambiguity risk: any later PnL/funding audit dividing by `trade_usd` instead of the actual leg notionals gets the denominator wrong. Reconstruction **is** possible from the recorded fields (qty, long_price, short_price) — the invariant test exploits exactly this — but the field name invites the wrong denominator. Post-gate fix: record executed notionals per leg (or rename).

### NEW-19 · P2 · cross-interval spread is min(interval)-normalized — an edge model, not settlement cashflow
`pair_pure_futures_spread()` (`core/cross_interval_funding.py:203-238`) blends both legs to hourly rates and returns `spread_pct = (short_hourly − long_hourly) × eff_interval` with **`eff_interval = min(long_interval_h, short_interval_h)`** — for an HL-1h vs CEX-8h pair the result is a spread normalized to **one hour**, not the cash either leg pays at its next settlement. The model is deliberately sophisticated (hourly normalization, mark/index basis blend, settlement progress, venue-specific basis caps) and its own docstring admits it returns “spread_pct over eff_interval (= min interval)”. Interpretation caveat for the final report: `spread_pct × notional` is **not** the funding cashflow for cross-interval pairs — per-leg accrual is. All pairs in the current sample settle on the same 8 h interval (empirically), so the R6-style estimate and the per-leg computation coincide here; on a mixed-interval sample they would diverge. Needs mathematical certification if the project continues post-gate.

### Deliberately NOT registered (verified, false-positive prevention)
- **Funding recheck** was followed end-to-end: `recheck_funding_edge()` re-calls `pair_pure_futures_spread()` — the same cross-interval model as the scanner, not a naive `short − long`. The registered NEW-09 (spread floor, no fee term) still stands; there is **no separate funding-calculation bug** behind it, so nothing was duplicated into the register.
- **Depth units** were followed to the venue-specific conversion (OKX `ctVal` contract-size conversion, and equivalents across Binance/Bybit/Bitget/Hyperliquid/Lighter/EdgeX/dYdX): no general depth-unit bug found — registering one would have been a false positive.

### R7 mathematical invariant test (new read-only measurement, tower-only)
`src/server/economic-invariants.ts` (+ the “economic decomposition” card): for **every successfully closed position** the three evidence sources are joined — ledger row (qty, leg prices, trade_usd, timestamps) + open action's entry scanner row (per-leg rates, intervals, next-settle timestamps, leg fees) + close action's executed legs (close ref_price per leg) — and the eight invariant dimensions are verified: **A** requested notional · **B/C** actual per-leg notionals · **D** price source (futures ticker/last) · **E** funding-rate source (entry snapshot only — no rate history exists) · **F** per-leg interval · **G** settlements actually inside the hold · **H** estimated funding cashflow per leg. Then the decomposition identity is written out per close:

> economic estimate = spread PnL + funding leg long + funding leg short − fees

with every component computed from the **actual per-leg notionals** (NEW-17/NEW-18 applied), funding accrued linearly (`held_h / interval_h × entry rate`) with a **settlement-count variant** as the stricter bound (0 until a settlement lands inside the hold), and fees charged round-trip on both legs. **Result on the current sample (12 closes, 12/12 A–H complete):**

| attributable group (7 closes, $3500 requested) | Σ per-close pct of trade_usd | USD |
|---|---|---|
| paper spread PnL (the primary instrument, unchanged) | **−0.425 %** | −$2.12 |
| estimated funding component (per-leg, entry-rate, linear) | **+1.599 %** | +$7.99 |
| round-trip fees (per-leg notionals) | **−1.567 %** | −$7.83 |
| **economic estimate (diagnostic — NOT a Phase-2 PnL instrument)** | **−0.393 %** | −$1.96 |

Identity ✓ (Σspread + Σfunding − Σfees = Σeconomic built to hold on the displayed numbers); data-gap group estimated separately (5 closes, +$2.57 est. funding). **The R6 two-point estimate (+1.03 %…+1.60 %) was of the right magnitude — the rigorous per-leg computation lands on its upper bound (+1.599 % vs +1.603 %)**, because every sampled pair settles on the same 8 h interval and per-leg notionals ≈ trade_usd, so the per-leg formula reduces to the constant-rate bound on this sample. The excluded funding component is ~3.8× the measured spread PnL and opposite in sign — and fees consume nearly all of it (1.567 % of 1.599 %), which is itself a Day-5/7-relevant economic fact. Scope guard enforced in labels and note: this panel exists to prove the decomposition is **reproducibly computable** — execution measurement (spread PnL) and funding economics (estimated, not realized) stay separate reported components; it will never be used as a Phase-2 PnL instrument.

### R7 remediation placement
All four are **post-Phase-2** items: NEW-16 (mark-price source or honest rename) and NEW-18 (record executed notionals) are cheap measurement-integrity fixes that land with the NEW-04/NEW-05 experiment-integrity pair; NEW-17 needs no code change at all (the correct per-leg computation now exists in the report layer and the executor's conservative sizing is deliberate); NEW-19 rides the funding-model certification item from the R6 closure list.
