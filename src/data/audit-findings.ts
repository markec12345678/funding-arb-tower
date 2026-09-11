export type FindingSeverity = "P0" | "P1" | "P2" | "P3";
export type FindingStatus = "confirmed" | "deferred";

export interface AuditFinding {
  id: string;
  severity: FindingSeverity;
  round: 1 | 2 | 3 | 4 | 5 | 6;
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
    detail: "should_close = row is None or edge <= exit_edge — a venue fetch failure in the scanner removes the row and the position is closed at market. No distinction between 'edge genuinely collapsed' and 'data unavailable' (Phase-3 contract: DATA_UNAVAILABLE → no action + alert). R6 re-confirmation: E-04 is an execution POLICY — missing observation → exit decision — not merely a reporting anomaly; the data-gap exit group in the running baseline (5 closes, +0.465%) are exits taken on missing data.",
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
  {
    id: "M-01", severity: "P1", round: 4, area: "venues/binance.py", status: "confirmed",
    title: "Two-valued submit contract (matrix root cause)",
    detail: "All nine submit outcomes (timeout, connection reset, HTTP 5xx, accepted-but-response-lost incl. unparseable body, unknown) collapse into ok:bool. The clientOrderId is generated and sent but discarded on every error path; _filled() treats accepted as filled — order_status is recorded but never gated. Blocks six order-plane matrix cells: the disambiguation mechanism exists in the codebase yet is never used for reconciliation.",
    evidence: "venues/binance.py:850,863,900-907; cross_venue_executor.py:241-248",
  },
  {
    id: "M-02", severity: "P1", round: 4, area: "execution/*", status: "confirmed",
    title: "Ledger is sole truth, never reconciled inbound (matrix root cause)",
    detail: "Every retry, restart and duplicate-open decision keys off positions.json, but nothing ever cross-checks the venue against the ledger: no startup diff, no order query by clientOrderId, no closed-position residual scan. Three paths corrupt the ledger silently (E-01, E-02, E-05) and no mechanism ever detects the drift. Verified: grep for recover/repair/reconcil across execution/ and tools/ finds only the quarantine docstring.",
    evidence: "run_pure_futures_spread.py:147-161; no reconciliation mechanism exists",
  },
  {
    id: "M-03", severity: "P1", round: 4, area: "cross_venue_executor.py", status: "confirmed",
    title: "Corrupt-ledger quarantine ends in amnesia (matrix root cause)",
    detail: "Quarantine on a corrupt ledger is loud (stderr + file preserved) but the aftermath is unsafe: load returns [], the runner sees zero open positions, frees all slots and can open DUPLICATE pairs stacked on top of live venue positions. Loud detection with no safe post-detection transition.",
    evidence: "cross_venue_executor.py:66-107; run_pure_futures_spread.py:147-161",
  },
  {
    id: "M-04", severity: "P2", round: 4, area: "core/notify.py", status: "confirmed",
    title: "No terminal failure states (matrix root cause)",
    detail: "Failure N is indistinguishable from failure 1: no max-failure circuit breaker, no HALT/BLOCK state, no escalation ladder anywhere in watcher/executor/runner. Notifications are stderr (dies with the process) plus fire-and-forget Telegram with an in-memory dedup cache that a restart clears — a failed Telegram send is lost entirely. The system can fail forever in exactly the same way.",
    evidence: "core/notify.py:38-70; no escalation state machine anywhere",
  },
  {
    id: "M-05", severity: "P2", round: 4, area: "cross_venue_executor.py", status: "confirmed",
    title: "Unconfirmed fill recorded as target qty (matrix root cause)",
    detail: "_exec_qty() falls back to the TARGET quantity when the POST response carries exec_qty=0 (order accepted, not yet filled): an unconfirmed quantity is written to the ledger as if filled. No post-submit status check exists for futures orders — _fetch_order_detail queries the spot endpoint only.",
    evidence: "cross_venue_executor.py:245-248; venues/binance.py:712-721 (spot-only),878-881",
  },
  {
    id: "NEW-01", severity: "P1", round: 5, area: "cli/orchestrate_funding.py", status: "deferred",
    title: "Orchestrator opens duplicates — no active-position gate",
    detail: "The paper runner gates opens on active_positions / active_keys / maxConcurrentPairs (run_pure_futures_spread.py:148-159); the orchestrator's --pure-futures --run-executor path does NOT: candidates → sort → candidates[:max_pairs] → open_pure_futures_pair() with no ledger query, no active_keys, and no dedup inside the executor itself. A second invocation / restart can re-see the same candidate and open a duplicate pair stacked on the live position. Compounds M-02/M-03 (ledger never reconciled inbound). Not active in the current single-PID paper baseline — latent for the live/orchestrator path.",
    evidence: "cli/orchestrate_funding.py:465,509-517 (no active query); contrast run_pure_futures_spread.py:147-161",
  },
  {
    id: "NEW-02", severity: "P1", round: 5, area: "cli/orchestrate_funding.py", status: "deferred",
    title: "Auto-spawned watcher can run a DIFFERENT config than the runner",
    detail: "_run_pure_futures_mode() builds its own cfg via load_strategy_config() + apply_strategy_to_pure_futures_cfg() (lines 436,449), but the --auto-spread-watch watcher is launched with watcher_cfg = args.config or the raw template path (line 549) — the STRATEGY OVERLAY IS NOT PASSED. Runner and watcher can disagree on trade_usd, thresholds, max_positions: a config split where two processes believe they execute the same experiment while they do not. Not active in the current paper loop (watcher not spawned); latent for the orchestrator/live path.",
    evidence: "cli/orchestrate_funding.py:424-449 vs 549-561",
  },
  {
    id: "NEW-03", severity: "P3", round: 5, area: "pure_futures_executor.py", status: "confirmed",
    title: "Fail-open funding-recheck CODE DEFAULT (template overrides — capability, not active)",
    detail: "AMENDED in R6 (full template re-read): the locked paper template sets fundingRecheckFailOpen=false, so the ACTIVE Phase-2 baseline is fail-closed on ALL three pre-open gates (depth, margin, funding recheck) — the original R5 claim of an active paper-gate divergence was wrong (truncated template read; cfg_lookup checks the pureFuturesArbitrage block first and finds the override). What remains is a capability risk: fail_open = fundingRecheckFailOpen OR dry_run means any config that omits the key silently re-enables fail-open in paper mode. Capability vs active-configuration distinction; no divergence in the current sample — the final A/B/C report needs no PAPER GATE DIVERGENCE label for this baseline.",
    evidence: "pure_futures_executor.py:399; funding_recheck.py:40-56 (cfg_lookup); templates/config.pure_futures.spread.json (fundingRecheckFailOpen:false)",
  },
  {
    id: "NEW-04", severity: "P1", round: 5, area: "core/strategy_config.py", status: "deferred",
    title: "Corrupt strategy config silently becomes DEFAULT config",
    detail: "load_strategy_config() wraps the read in try/except Exception: pass and returns DEFAULT_STRATEGY on any unreadable/invalid JSON — trade_usd 5000, 4-CEX scans, default thresholds. A configuration error changes the experimental parameters with no crash and no alarm. For Phase-2 the config is effectively part of the immutable experimental baseline; a silent default swap would be contamination. P1 for validation integrity, P2 for execution. Post-Phase-2 fix: fail loud.",
    evidence: "core/strategy_config.py:35-46 (except Exception: pass)",
  },
  {
    id: "NEW-05", severity: "P1", round: 5, area: "experiment integrity", status: "deferred",
    title: "Strategy config not locked/hashed into the experiment record",
    detail: "Every journal cycle records thresholds, but the strategy config is an external mutable file — nothing pins the full config (strategy_config_hash / config_version / locked manifest) to the sample. Mid-experiment changes would mix two experiments in one journal. IMPORTANT LABELING: no evidence of actual config mutation — invariant currently UNENFORCED, contamination possibility, not contamination. Empirical corroboration (read-only, 261 real cycles): every cycle carries ONE identical thresholds variant; trade_usd = 500.0 on all 14 positions (never the default 5000 — the silent-default signature is absent); journal thresholds differ from template defaults (overlay values) and never changed. For all recorded dimensions the sample IS one experiment — verified. Day-5/7 verdict additionally checks config continuity; post-Phase-2 fix: hash the config into every cycle snapshot.",
    evidence: "journal.jsonl thresholds x261 identical; positions.json trade_usd=500 x14; contrast core/strategy_config.py DEFAULT_STRATEGY trade_usd=5000",
  },
  {
    id: "NEW-06", severity: "P2", round: 5, area: "pure_futures_executor.py", status: "deferred",
    title: "Atomic write is not durable (no fsync before rename)",
    detail: "_save_positions() writes temp + flush() + os.replace() without fsync() — application crash is covered, OS/power failure is not ('atomic' ≠ 'durable'). Lesser than M-02/M-03 but the ledger's durability guarantee is weaker than it reads. Post-hardening item.",
    evidence: "pure_futures_executor.py:61-80 (flush, no fsync, then os.replace)",
  },
  {
    id: "NEW-07", severity: "P2", round: 5, area: "run_pure_futures_spread.py", status: "deferred",
    title: "Multi-process TOCTOU on the open decision",
    detail: "The file lock covers ledger WRITES only. The open decision spans load positions → compute slots → choose candidate → place orders → record — unlocked throughout. Two concurrent runners both see 2/3 slots, both open, both record: capacity exceeded and potential same-pair duplicates. Distinct from M-02/M-03 (corrupt ledger) — this is a race on a healthy ledger. Not proven active with the current single PID (12976); real for production. P2 now, P1 for the live path.",
    evidence: "run_pure_futures_spread.py:147-199 (read → decide → open → later save; lock only inside _save_positions)",
  },
  {
    id: "NEW-08", severity: "P1", round: 6, area: "measurement instrument", status: "deferred",
    title: "Paper PnL does not measure actual funding cashflow",
    detail: "estimate_spread_pnl() computes price-spread convergence only (open price spread − close price spread, scaled by qty; its own docstring says 'Price P&L = inter-venue spread at open - inter-venue spread now'). Funding appears only as a stop-loss ESTIMATE (current spread × elapsed periods, fixed interval_h=8.0), never as realized cashflow — in paper mode actual funding does not exist. So paper result = spread convergence ± fees, NOT the strategy's economics (price convergence + realized funding received/paid − fees). Phase-2 can validate execution/funnel/price-convergence behavior but cannot by itself prove funding-cashflow ROI. MATERIALITY (read-only, 2-point estimate over the classified closes): the excluded funding component for the 7 strategy-attributable closes is ≈ +1.03% (linear decay open→close) to +1.60% (spread constant) — 2–4× the magnitude of the measured −0.424% spread PnL and OPPOSITE IN SIGN. The excluded component dominates the measured one: the paper instrument cannot decide the strategy's economics.",
    evidence: "pure_futures_watcher.py:247-272 (formula), 592 (interval_h=8.0); rough estimate: open candidate spread_pct × settlements=held_h/8, linear & constant bounds",
  },
  {
    id: "NEW-09", severity: "P2", round: 6, area: "execution/funding_recheck.py", status: "deferred",
    title: "Funding recheck verifies RAW spread, not net executable edge",
    detail: "recheck_funding_edge() re-fetches both legs and checks spread_pct >= fundingRecheckMinSpreadPct (0.02 in the template) — the RAW funding spread only, no fee subtraction. The scanner entry gate required net_edge >= 0.02 (i.e. spread >= fees + 0.02 ≈ 0.13 with 0.11 fees). Example: funding spread 0.06% + fees 0.11% → net edge −0.05%, yet the recheck says OK. It is the LAST economic gate before submit in paper mode (margin is live-only, depth is non-economic), so a spread collapse into [0.02, fees+0.02) can open at negative net edge — bounded by the exit logic closing it on the next cycle (net edge ≤ exit threshold). Architecturally: the recheck is weaker than the original economic decision it is supposed to re-verify.",
    evidence: "funding_recheck.py:139-176 (ok = spread_pct >= floor, no fee term); pure_futures_executor.py:388-402 (call site); template fundingRecheckMinSpreadPct=0.02 vs journal thresholds minNetEdgePct=0.02",
  },
  {
    id: "NEW-10", severity: "P2", round: 6, area: "measurement instrument", status: "deferred",
    title: "Exit decision is funding-based, PnL attribution is price-based",
    detail: "The close signal and the PnL attributed to that close are different economic components: runner exit = net FUNDING spread ≤ exit threshold; watcher check_exit = FUNDING spread − fees ≤ exit threshold (feeAwareExit); but the recorded/attributed PnL = PRICE spread convergence (estimate_spread_pnl). Deliberate design, but it means the signal triggering a close and the result booked to it are not the same quantity — an attribution-integrity caveat that must accompany any per-exit PnL reading (including the strategy-attributable primary view).",
    evidence: "run_pure_futures_spread.py:127-144 (funding edge exit); pure_futures_watcher.py:206-236 (check_exit, funding−fee); estimate_spread_pnl price formula 247-272",
  },
  {
    id: "NEW-13", severity: "P2", round: 6, area: "pure_futures_watcher.py", status: "deferred",
    title: "Failed mark price is CACHED as 0.0 for the TTL",
    detail: "On API failure _get_mark_price() sets price = 0.0 and then writes it into _mark_price_cache — a transient failure becomes a cached 'unavailable price' for the whole TTL window (10 s), unlike the usual failure → don't-cache pattern. Downstream, the PnL stop runs only when both legs' prices > 0, so a short data failure silently extends the PnL-stop outage beyond the failing call. Data-quality/watcher behavior; harmless for the current paper baseline, real for a live watcher. (Related mechanism already recorded in W-03 — the skip; this registers the failure-caching that extends it.)",
    evidence: "pure_futures_watcher.py:141-159 (except → price=0.0 → cache write)",
  },
  {
    id: "NEW-15", severity: "P1", round: 6, area: "experiment methodology", status: "confirmed",
    title: "Four different economic truths — 'paper PnL' must never be named 'funding PnL'",
    detail: "The paper experiment carries four distinct metrics that are not one quantity: entry edge = funding spread − fees; exit edge = funding spread − fees; PnL = price-spread convergence; funding = estimated only (never realized — it does not exist in paper mode). Consequence (naming rule, enforced in the tower labels): the primary result is reported as STRATEGY-ATTRIBUTABLE PAPER SPREAD PnL, with the explicit limitation 'realized funding cashflow = not observed in paper mode' — never as funding-arbitrage profitability. Validation limitation, not a reason to stop Phase-2; recorded for the final A/B/C report. Post-gate fix if the project continues: realized-funding accounting in the paper instrument.",
    evidence: "scanner pair model + check_exit (funding) vs estimate_spread_pnl (price) vs estimated-only funding stop; naming rule applied in tower exit-classification card",
  },
];
