# funding-arb — Read-only Audit Findings Register

| | |
|---|---|
| **Target** | [`markec12345678/funding-arb`](https://github.com/markec12345678/funding-arb) @ `0373f5d` |
| **Lock status** | LOCKED — Phase-2 paper A/B/C measurement in progress; **zero changes made** to the measured system |
| **Method** | Read-only code inspection at the locked commit (local checkout verified clean at `0373f5d`; identical to GitHub `main`) |
| **Reference standard** | phase3-lab golden contract v1.1.0 — fail-closed semantics (`VENUE_UNAVAILABLE`/`DATA_UNAVAILABLE`/`PRICE_UNAVAILABLE`/`FEE_UNKNOWN` → BLOCK + ALERT) |
| **Rounds** | R1 — API surface · R2 — watcher · R3 — executor/runner order-by-order |

**Register status: 21 findings — 3× P0, 9× P1 (incl. 1 deferred), 6× P2, 3× P3.**

The dashboard renders this register live (`src/data/audit-findings.ts`); this document holds the evidence.

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

## Deferred (repo locked — patch ready)

### D-01 · P1 · funding-arb README
"370+ tests" vs actual 539; clone URL points to `counterfactual5/funding-arb` instead of `markec12345678/funding-arb`. Exact patch prepared in REVIEW-1; apply as a single commit when the lock lifts.

---

## Suggested remediation order (post-Phase-2 hardening pass)

1. **API-01/02/03** — fail-closed auth default, a server-side hard live gate, bind guard moved to app startup (all three are one deployment-safety commit).
2. **E-01** — order-status reconciliation by `clientOrderId` before any rollback/abort decision; treat submit-timeout as UNKNOWN, not FAILED.
3. **W-01** — watcher fail-safe state: `DATA_UNAVAILABLE → no new action + alert + escalation`, with the cycle still logged.
4. **E-02** — persist naked legs (`status: "naked"`) so the watcher keeps escalating until resolved.
5. **W-02/W-03/W-04** — explicit `POSITIONS_UNAVAILABLE` / `MARK_PRICE_UNAVAILABLE` / `FEE_UNKNOWN` states instead of silent skips and fee=0.
6. **E-04** — runner: `row is None` → alert + skip, not close.
7. **E-03/W-05/E-05/W-06** — depth fail-closed default, interval map for funding PnL stop, residual tracking on partial closes, truthiness fix in `check_rebalance`.

None of these are applied: the repo is locked at `0373f5d` for the Phase-2 A/B/C measurement, and this register exists precisely so the hardening pass can be executed deliberately afterwards.
