export type MatrixVerdict = "safe" | "ambiguous" | "gap";

export type MatrixGroup = "order" | "position" | "recovery";

export interface MatrixCell {
  id: string;
  group: MatrixGroup;
  state: string;
  verdict: MatrixVerdict;
  transition: string;
  evidence: string;
  refs: string[];
}

export const matrixMeta = {
  repo: "markec12345678/funding-arb",
  commit: "0373f5d",
  round: "R4",
  method: "State-by-state failure-matrix walkthrough (read-only @ locked commit)",
  goal: "Prove that every possible ambiguity has exactly ONE safe state transition",
  register: "docs/funding-arb-audit.md",
} as const;

export const matrixGroupLabels: Record<MatrixGroup, string> = {
  order: "ORDER SUBMITTED",
  position: "POSITION",
  recovery: "RECOVERY",
};

export const matrixRootCauses: { id: string; severity: "P1" | "P2"; title: string; detail: string; blocks: string }[] = [
  {
    id: "M-01",
    severity: "P1",
    title: "Two-valued submit contract",
    detail:
      "All nine submit outcomes collapse into ok:bool. The clientOrderId is generated and sent but discarded on every error path; _filled() treats accepted as filled (order_status recorded, never gated). This one structure blocks six order-plane cells.",
    blocks: "OS-2 OS-3 OS-5 OS-9 + rollback/retry cells",
  },
  {
    id: "M-02",
    severity: "P1",
    title: "Ledger is sole truth, never reconciled inbound",
    detail:
      "Every retry/restart/duplicate decision keys off positions.json, but nothing ever cross-checks venue vs ledger: no startup diff, no order query by clientOrderId, no closed-position residual scan. Three paths corrupt the ledger silently (E-01, E-02, E-05).",
    blocks: "RC-1 RC-2 RC-3",
  },
  {
    id: "M-03",
    severity: "P1",
    title: "Corrupt-ledger quarantine ends in amnesia",
    detail:
      "Quarantine is loud (stderr + file preserved) but the aftermath is unsafe: load returns [], the runner sees zero open positions, frees slots and can open DUPLICATE pairs stacked on live venue positions.",
    blocks: "RC-1 restart (corrupt-ledger subcase)",
  },
  {
    id: "M-04",
    severity: "P2",
    title: "No terminal failure states",
    detail:
      "Failure N is indistinguishable from failure 1 — no circuit breaker, no HALT/BLOCK state, no escalation ladder. Notifications are stderr (dies with the process) plus fire-and-forget Telegram with an in-memory dedup cache that a restart clears.",
    blocks: "RC-6 + all repeated-failure loops",
  },
  {
    id: "M-05",
    severity: "P2",
    title: "Unconfirmed fill recorded as target qty",
    detail:
      "_exec_qty() falls back to the TARGET quantity when the response carries exec_qty=0 (accepted, unfilled): an unconfirmed quantity is written to the ledger as if filled. No post-submit status check exists for futures orders.",
    blocks: "OS-7 OS-8",
  },
];

export const matrixCells: MatrixCell[] = [
  // ── ORDER SUBMITTED ────────────────────────────────────────────────────────
  {
    id: "OS-1",
    group: "order",
    state: "success (accepted + filled)",
    verdict: "safe",
    transition:
      "HTTP 200 → ok=True → status 'filled' → ledger opened with actual exec_qty/prices. One nuance: ok means ACCEPTED — order_status (NEW/PARTIALLY_FILLED) is recorded but never gated.",
    evidence: "venues/binance.py:868-899, cross_venue_executor.py:241-248, pure_futures_executor.py:494-521,585-610",
    refs: [],
  },
  {
    id: "OS-2",
    group: "order",
    state: "timeout",
    verdict: "gap",
    transition:
      "urlopen timeout=15s raises → generic except → ok=False → treated as order-not-placed → other leg rolled back. Venue state UNKNOWN handled as KNOWN-FAILED; clientOrderId discarded, never queried.",
    evidence: "venues/binance.py:115,906-907; pure_futures_executor.py:522-568 (E-01)",
    refs: ["E-01", "M-01"],
  },
  {
    id: "OS-3",
    group: "order",
    state: "connection reset",
    verdict: "gap",
    transition:
      "Identical code path to timeout: any non-HTTP exception → ok=False 'failed' → rollback. Order may be live on the venue; nothing reconciles.",
    evidence: "venues/binance.py:906-907 (generic except)",
    refs: ["E-01", "M-01"],
  },
  {
    id: "OS-4",
    group: "order",
    state: "HTTP 5xx",
    verdict: "ambiguous",
    transition:
      "HTTPError → ok=False with code in the error string (auditable) → rollback. Usually genuinely not-placed (safe), but shares the path with timeout — a post-accept 5xx is indistinguishable. Nothing branches on the code.",
    evidence: "venues/binance.py:900-905",
    refs: ["E-01"],
  },
  {
    id: "OS-5",
    group: "order",
    state: "accepted-but-response-lost",
    verdict: "gap",
    transition:
      "Two variants, same outcome: response never arrives, or arrives truncated so json.loads raises INSIDE the try → generic except → ok=False. Order is live on the venue, ledger records nothing, the other leg is rolled back → naked. The worst E-01 case.",
    evidence: "venues/binance.py:114-116,906-907; pure_futures_executor.py:522-543",
    refs: ["E-01", "M-01"],
  },
  {
    id: "OS-6",
    group: "order",
    state: "duplicate retry",
    verdict: "ambiguous",
    transition:
      "Transport: POST single-shot (retries=1) — no transport duplicate. Close orders carry reduceOnly → a duplicate close is a venue-side no-op. Duplicate OPEN is possible after a crash-in-window or quarantined ledger (opens gate on ledger active_keys) → stacking on live venue positions.",
    evidence: "venues/binance.py:96-97,965-985; run_pure_futures_spread.py:147-161",
    refs: ["E-02", "M-02", "M-03"],
  },
  {
    id: "OS-7",
    group: "order",
    state: "partial fill (at response time)",
    verdict: "ambiguous",
    transition:
      "Sequential: leg B sized to leg A's ACTUAL fill — correct. Parallel: ledger records actual per-leg qtys (long_qty/short_qty) so the skew is visible; watcher flags rebalance_needed — but auto-trim needs autoRebalance=true, which defaults FALSE. If executedQty=0 comes back, _exec_qty falls back to TARGET — phantom qty recorded.",
    evidence: "pure_futures_executor.py:494-511,581-582; watcher:458,698-707; cross_venue_executor.py:245-248",
    refs: ["M-05", "E-06"],
  },
  {
    id: "OS-8",
    group: "order",
    state: "delayed fill (NEW at response)",
    verdict: "ambiguous",
    transition:
      "Accepted-as-filled: no post-submit status check exists for futures orders (_fetch_order_detail is spot-only). exec_qty=0 → target fallback; avgPrice=0 → ref_price fallback. Ledger approximate; nothing ever re-reads the order.",
    evidence: "venues/binance.py:712-721 (spot-only),880; cross_venue_executor.py:245-248",
    refs: ["M-05", "E-05"],
  },
  {
    id: "OS-9",
    group: "order",
    state: "unknown status",
    verdict: "gap",
    transition:
      "Every non-HTTP exception collapses into the same ok=False 'failed' label. The nine outcomes of this group reduce to TWO observable states — ambiguity itself is unobservable downstream.",
    evidence: "venues/binance.py:900-907",
    refs: ["M-01"],
  },

  // ── POSITION ───────────────────────────────────────────────────────────────
  {
    id: "PO-1",
    group: "position",
    state: "local open / venue closed (single leg)",
    verdict: "safe",
    transition:
      "check_leg_alive (95% tolerance) → single_leg_gone → close_pure_futures_leg on the SURVIVING leg only, reduce_only, notification, watcher.jsonl audit. Exactly one safe transition — never orders the vanished leg.",
    evidence: "pure_futures_watcher.py:349-393,634-671; pure_futures_executor.py:782-843",
    refs: [],
  },
  {
    id: "PO-2",
    group: "position",
    state: "local closed / venue open",
    verdict: "safe",
    transition:
      "Close-path failure: rollback RE-OPENS the short → ledger stays open → watched next cycle. If the re-hedge also fails: naked + notification, ledger still open → next watcher cycle emergency-closes the surviving long (self-heal). Subcase: partial close understated → _mark_closed closes the whole record → residual invisible (E-05).",
    evidence: "pure_futures_executor.py:752-779; watcher:634-671 (E-05 subcase)",
    refs: ["E-05"],
  },
  {
    id: "PO-3",
    group: "position",
    state: "partial residual",
    verdict: "gap",
    transition:
      "Nothing ever re-examines a closed position: no residual scan exists. The residual pair stays hedged on the venues but exits the ledger — no PnL stop, no funding accrual, no leg-alive check, forever.",
    evidence: "pure_futures_executor.py:730-750; no closed-position scan anywhere",
    refs: ["E-05", "M-02"],
  },
  {
    id: "PO-4",
    group: "position",
    state: "stale snapshot",
    verdict: "ambiguous",
    transition:
      "Fetch failure → venue in failed_venues → legs_checkable=false → leg check skipped, positions_fetch_failed alert appended and logged. Safe against false close, auditable — but no escalation state: can persist for hours with zero management of the exposure.",
    evidence: "pure_futures_watcher.py:501-528,627-634 (W-02)",
    refs: ["W-02"],
  },
  {
    id: "PO-5",
    group: "position",
    state: "venue unavailable",
    verdict: "ambiguous",
    transition:
      "Funding path: W-01 early return bypasses BOTH the alert sync and _append_log — the failed cycle leaves zero persistent trace (API-down vs process-dead vs never-ran is indistinguishable from the logs). Positions path: alert + skip (W-02). Mark-price path: PnL stop silently gated on >0 (W-03).",
    evidence: "pure_futures_watcher.py:491-497,736-739; 581-583; 141-159",
    refs: ["W-01", "W-02", "W-03"],
  },
  {
    id: "PO-6",
    group: "position",
    state: "external reduction (partial liq / ADL)",
    verdict: "safe",
    transition:
      "check_rebalance reads the venue snapshot → rebalance_needed alert every cycle (deterministic detection, logged). Auto-trim requires autoRebalance=true (default false — alert-only), but the executor trim itself reads actual venue qty correctly (is not None).",
    evidence: "pure_futures_watcher.py:694-734,458; pure_futures_executor.py:906-914",
    refs: ["W-06", "E-06"],
  },

  // ── RECOVERY ───────────────────────────────────────────────────────────────
  {
    id: "RC-1",
    group: "recovery",
    state: "restart",
    verdict: "ambiguous",
    transition:
      "Clean ledger: atomic writes + file lock → runner/watcher resume deterministically next cycle. Crash in the order→ledger window: NO startup reconciliation exists → naked legs invisible to every subsequent cycle. Corrupt ledger: quarantine is loud, then amnesia — [] frees slots → duplicate opens possible.",
    evidence: "pure_futures_executor.py:61-104; cross_venue_executor.py:66-94; no recover/repair/reconcil mechanism found",
    refs: ["E-02", "M-02", "M-03"],
  },
  {
    id: "RC-2",
    group: "recovery",
    state: "retry",
    verdict: "ambiguous",
    transition:
      "Runner re-evaluates next cycle; opens gated by ledger active_keys — safe IF the ledger is accurate, which is exactly what E-01/E-02 corrupt. Close retries are venue-side no-ops thanks to reduceOnly.",
    evidence: "run_pure_futures_spread.py:127-161; venues/binance.py:965-985",
    refs: ["E-01", "E-02", "M-02"],
  },
  {
    id: "RC-3",
    group: "recovery",
    state: "reconciliation",
    verdict: "gap",
    transition:
      "As a named recovery mechanism it does not exist: no order-level query by clientOrderId, no startup venue↔ledger diff, no closed-position residual scan. The only venue↔ledger comparisons are per-position and per-cycle (check_leg_alive, rebalance qty read).",
    evidence: "grep recover/repair/reconcil in execution/ + tools/ → only the quarantine docstring",
    refs: ["M-02", "E-01", "E-05"],
  },
  {
    id: "RC-4",
    group: "recovery",
    state: "rollback",
    verdict: "ambiguous",
    transition:
      "Close-path rollback keeps the position open and watched (self-heals next cycle) — good. Open-path rollback: ok → 'rolled_back' with a clean ledger (wrong under E-01 ambiguity); failed → 'naked' + one-shot notification but NO ledger record (E-02) → invisible thereafter. The asymmetry is the gap.",
    evidence: "pure_futures_executor.py:522-543,612-641,752-779",
    refs: ["E-01", "E-02"],
  },
  {
    id: "RC-5",
    group: "recovery",
    state: "emergency unwind",
    verdict: "safe",
    transition:
      "close_pure_futures_leg: surviving leg only, reduce_only, notification on failure, ledger closed on success, watcher.jsonl action logged. both_legs_gone → NO orders placed + manual_review alert — the conservative choice, exactly one safe transition.",
    evidence: "pure_futures_executor.py:782-843; watcher:642-653",
    refs: [],
  },
  {
    id: "RC-6",
    group: "recovery",
    state: "repeated failure",
    verdict: "gap",
    transition:
      "No terminal failure state anywhere: failure N looks identical to failure 1 — no max-failure circuit breaker, no HALT/BLOCK, no escalation ladder. Notifications are stderr (dies with the process) + fire-and-forget Telegram with an in-memory dedup cache a restart clears. The system can fail forever in exactly the same way.",
    evidence: "core/notify.py:38-70; no escalation state machine in watcher/executor/runner",
    refs: ["M-04", "W-01", "W-02"],
  },
];

export const matrixVerdictCounts = (
  ["safe", "ambiguous", "gap"] as const
).map((verdict) => ({
  verdict,
  count: matrixCells.filter((c) => c.verdict === verdict).length,
}));

export const matrixVerdictBadge: Record<MatrixVerdict, string> = {
  safe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ambiguous: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  gap: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

export const matrixVerdictLabel: Record<MatrixVerdict, string> = {
  safe: "ONE SAFE TRANSITION",
  ambiguous: "AMBIGUOUS",
  gap: "NO SAFE TRANSITION",
};
