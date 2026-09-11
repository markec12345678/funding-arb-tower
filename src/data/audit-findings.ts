export type FindingSeverity = "P0" | "P1" | "P2" | "P3";
export type FindingStatus = "confirmed" | "deferred";

export interface AuditFinding {
  id: string;
  severity: FindingSeverity;
  round: 1 | 2 | 3;
  area: string;
  title: string;
  detail: string;
  evidence: string;
  status: FindingStatus;
}

export const auditMeta = {
  repo: "markec12345678/funding-arb",
  commit: "0373f5d",
  locked: true,
  lockReason: "Phase-2 paper A/B/C measurement in progress",
  method: "Read-only code inspection at the locked commit",
  reference: "phase3-lab golden contract v1.1.0 (fail-closed semantics)",
  register: "docs/funding-arb-audit.md",
} as const;

export const auditFindings: AuditFinding[] = [
  {
    id: "API-01", severity: "P0", round: 1, area: "server/main.py", status: "confirmed",
    title: "Auth fail-open by default",
    detail: "FARB_API_TOKEN unset leaves all 23 /api routes unauthenticated, incl. positions/open (live orders) and wallet/connect (raw secret injection).",
    evidence: "server/main.py auth middleware",
  },
  {
    id: "API-02", severity: "P0", round: 1, area: "server/routes", status: "confirmed",
    title: "No hard live gate on the API path",
    detail: "dry_run=false plus credentials in process env is enough to trade live via API; the CLI has a FARB_LIVE-style opt-in, the API does not.",
    evidence: "server/routes/positions.py, settings.py",
  },
  {
    id: "API-03", severity: "P0", round: 1, area: "server/main.py", status: "confirmed",
    title: "Bind guard bypassable via uvicorn import",
    detail: "Loopback bind protection lives only under __main__; 'uvicorn server.main:app --host 0.0.0.0' (a launch mode the module header advertises) bypasses it entirely.",
    evidence: "server/main.py __main__ block",
  },
  {
    id: "API-04", severity: "P1", round: 1, area: "server/routes/settings.py", status: "confirmed",
    title: "wallet/connect arms live trading in one request",
    detail: "Sets DYDX_ENABLE_LIVE and injects venue keys into the process env; with auth unset, a single request enables live trading.",
    evidence: "server/routes/settings.py wallet/connect",
  },
  {
    id: "API-05", severity: "P1", round: 1, area: "credentials", status: "confirmed",
    title: "Credential leakage channels",
    detail: "FARB_ALLOW_UNAUTHENTICATED plus plaintext ~/.funding-arb/credentials.json and scripts/.env widen the exposure surface.",
    evidence: "scripts/core/credentials.py",
  },
  {
    id: "API-06", severity: "P2", round: 1, area: "server/routes/backtest.py", status: "confirmed",
    title: "Backtest path oracle",
    detail: "/api/backtest/run accepts absolute jsonl_file paths (file-existence oracle); error strings leak filesystem paths.",
    evidence: "server/routes/backtest.py",
  },
  {
    id: "API-07", severity: "P3", round: 1, area: "server/main.py", status: "confirmed",
    title: "API hygiene gaps",
    detail: "No rate limiting; /docs and /openapi.json unauthenticated; WS token passed in the query string.",
    evidence: "server/main.py",
  },
  {
    id: "W-01", severity: "P1", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Funding-data failure ends the whole cycle — silently",
    detail: "rate_fetch_error → return cycle_result aborts ALL management (PnL stops, leg checks, rebalance) for every open position. Amplified on verification: the early return bypasses both the alert sync (cycle_result['alerts'] is set only at line 737) and _append_log (line 738) — the failed cycle leaves zero persistent trace: no returned alert, no watcher.jsonl entry, no notification. Phase-3 contract: VENUE_UNAVAILABLE → BLOCK + ALERT.",
    evidence: "pure_futures_watcher.py:491-497,736-739",
  },
  {
    id: "W-02", severity: "P1", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Position-fetch failure skips leg checks",
    detail: "Fetch failure ≠ no position is correctly distinguished and a positions_fetch_failed alert is appended, but legs_checkable=false silently skips check_leg_alive with no escalation state — safe against false close, unsafe against unmanaged exposure.",
    evidence: "pure_futures_watcher.py:501-528,627-634",
  },
  {
    id: "W-03", severity: "P1", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Mark-price failure skips PnL stop-loss",
    detail: "_get_mark_price() returns 0.0 on error (cached 10 s); the PnL stop runs only when both legs price > 0, silently; the liq-distance alert path also breaks on mark <= 0. The margin check has an explicit price_unavailable reason — the PnL stop does not.",
    evidence: "pure_futures_watcher.py:141-159,581-583,421-423",
  },
  {
    id: "W-04", severity: "P1", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Fee failure degrades to fee=0",
    detail: "except → taker=0.0 inflates NET edge so positions are held longer; the docstring documents the degrade-to-raw-spread trade-off, but the Phase-3 contract prefers an explicit FEE_UNKNOWN state.",
    evidence: "pure_futures_watcher.py:65-85",
  },
  {
    id: "W-05", severity: "P2", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Funding PnL stop assumes 8 h settlements",
    detail: "interval_h = 8.0 regardless of actual settlement intervals; misestimates funding contribution for cross-interval pairs (HL 1 h vs CEX 4/8 h).",
    evidence: "pure_futures_watcher.py:592",
  },
  {
    id: "W-06", severity: "P2", round: 2, area: "pure_futures_watcher.py", status: "confirmed",
    title: "Silent qty fallback in rebalance",
    detail: "'if actual_lq:' treats actual quantity 0 as falsy so the stale pos[qty] is used; masked by check_leg_alive in the normal flow, manifests with watcherCheckLegs=false.",
    evidence: "pure_futures_watcher.py:315-320",
  },
  {
    id: "W-07", severity: "P3", round: 2, area: ".github/workflows/ci.yml", status: "confirmed",
    title: "CI comment 535 vs 539",
    detail: "ci.yml says '535-test matrix'; the known count is 539. Documentation drift, deliberately not fixed during the Phase-2 lock.",
    evidence: ".github/workflows/ci.yml:10",
  },
  {
    id: "D-01", severity: "P1", round: 1, area: "README.md", status: "deferred",
    title: "README test count + clone URL",
    detail: "'370+ tests' vs actual 539; clone URL points to counterfactual5 instead of markec12345678. Patch prepared in REVIEW-1, to be applied when the lock lifts.",
    evidence: "README.md",
  },
  {
    id: "E-01", severity: "P1", round: 3, area: "pure_futures_executor.py", status: "confirmed",
    title: "Submit-timeout ambiguity can orphan a filled leg with zero alerts",
    detail: "Order results are single-shot POST responses (ok = accepted, not filled); a network timeout after a successful submit reads as failure. Nothing reconciles order status by clientOrderId before rolling back. Worst case: parallel open, long times out but fills, short fills → rollback closes the short → naked long on the venue, ledger clean, result 'rolled_back', no notification at all.",
    evidence: "venues/binance.py:841-897, cross_venue_executor.py:241-248, pure_futures_executor.py:522-568,571-577",
  },
  {
    id: "E-02", severity: "P1", round: 3, area: "pure_futures_executor.py", status: "confirmed",
    title: "Open-path naked legs are never persisted",
    detail: "When a filled leg's rollback fails, the executor returns 'naked' with a one-shot notification but writes no ledger record — the watcher (iterating open positions from positions.json) can never see it. Close-path naked stays 'open' and watched; the open path is the blind spot.",
    evidence: "pure_futures_executor.py:522-543,612-641 (rollback branches return without _record_position)",
  },
  {
    id: "E-03", severity: "P2", round: 3, area: "pure_futures_executor.py", status: "confirmed",
    title: "Depth pre-check fails open by default in live mode",
    detail: "depthCheckFailOpen defaults to true: a depth-API error lets the open proceed without the slippage gate — inconsistent with the margin check (fail-closed default) and the live funding re-check (fail-closed default).",
    evidence: "pure_futures_executor.py:361-376",
  },
  {
    id: "E-04", severity: "P2", round: 3, area: "run_pure_futures_spread.py", status: "confirmed",
    title: "Runner treats a scanner data gap as an exit signal",
    detail: "should_close = row is None or edge <= exit_edge — a venue fetch failure in the scanner removes the row and the position is closed at market. No distinction between 'edge genuinely collapsed' and 'data unavailable' (Phase-3 contract: DATA_UNAVAILABLE → no action + alert).",
    evidence: "run_pure_futures_spread.py:127-144",
  },
  {
    id: "E-05", severity: "P2", round: 3, area: "pure_futures_executor.py", status: "confirmed",
    title: "Partial-close residual leaves the ledger",
    detail: "If the short close partially fills (status 'filled', exec_qty < qty — the single-shot response can understate the fill), the long close is sized to the understated qty and _mark_closed closes the whole position: the residual pair stays hedged on the venues but unwatched (no PnL stop, no funding accrual, no leg-alive check).",
    evidence: "pure_futures_executor.py:730-750, venues/binance.py:878-881",
  },
  {
    id: "E-06", severity: "P3", round: 3, area: "pure_futures_executor.py", status: "confirmed",
    title: "Rebalance ledger update assumes a full trim",
    detail: "After a rebalance trim, long_qty/short_qty are set to min(lq,sq) even if the trim order partially filled; the residual skew is misrecorded but self-heals next cycle because rebalance re-reads actual quantities from the venue API.",
    evidence: "pure_futures_executor.py:969-987",
  },
];
