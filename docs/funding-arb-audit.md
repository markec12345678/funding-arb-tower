# funding-arb — Read-only Audit Findings Register

| | |
|---|---|
| **Target** | [`markec12345678/funding-arb`](https://github.com/markec12345678/funding-arb) @ `0373f5d` |
| **Lock status** | LOCKED — Phase-2 paper A/B/C measurement in progress; **zero changes made** to the measured system |
| **Method** | Read-only code inspection at the locked commit (local checkout verified clean at `0373f5d`; identical to GitHub `main`) |
| **Reference standard** | phase3-lab golden contract v1.1.0 — fail-closed semantics (`VENUE_UNAVAILABLE`/`DATA_UNAVAILABLE`/`PRICE_UNAVAILABLE`/`FEE_UNKNOWN` → BLOCK + ALERT) |
| **Rounds** | R1 — API surface · R2 — watcher · R3 — executor/runner order-by-order · R4 — state-by-state failure matrix · R5 — targeted integrity audit (config/experiment/concurrency plane) |

**Register status: 33 findings — 3× P0, 16× P1, 11× P2, 3× P3 · 7 deferred to post-Phase-2 hardening (D-01, NEW-01/02/04/05/06/07).** *(R5 addition; the pre-R5 header line understated P1 by one — 13→12 at the time, sums now verified against the rendered register.)*

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

**The audit phase is CLOSED.** R4 proved the boundary of the system (a stronger result than the 539-test green matrix, which covers only designed failures); further blind bug-hunting in funding-arb is explicitly retired. The register (26 findings at closure; 33 after the R5 targeted integrity round) + matrix (21 cells) are the complete **pre-change audit trail** — which is exactly why they were recorded before touching anything. *R5 refinement of the closure scope: random bug hunting stays retired, but targeted integrity audit (experiment-validity plane) remains valid — see Round 5.*

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

### NEW-03 · P2 · paper funding re-check is fail-open (paper gate divergence)
`fail_open = fundingRecheckFailOpen or dry_run` (`pure_futures_executor.py:399`): in paper mode a funding recheck API failure lets the candidate proceed. The code documents the intent ("dry-run defaults to fail-open so paper testing is not blocked on flaky APIs"), but methodologically it means the paper runner does not simulate the same gate as live on a data failure — paper can open a signal live would reject. Notably this is the **only** fail-open gate in the paper baseline: the template explicitly sets `depthCheckFailOpen: false` and `marginCheckFailOpen: false`. Carried into the final A/B report as **PAPER GATE DIVERGENCE — fail-open funding recheck**; such opens are not divergence-free opens. (Status: confirmed behavior, documented — deliberately not fixed during Phase-2.)

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
