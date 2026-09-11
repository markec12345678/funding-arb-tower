/**
 * quant-arb-engine artifact types — the contract between the engine's
 * research artifacts (research/artifacts/run-latest.json + sweep-latest.json,
 * written by scripts/research_sweep.py in the engine repo) and the tower's
 * read-only engine monitor (/api/engine/overview → EngineView).
 *
 * v0.3.0: two strategy families + ranking layer — the artifacts carry the
 * family census, the ranking hit-rate, the dual σ calibration panels, the
 * carry curve and the scored predictions P1/P2/P3.
 *
 * The tower NEVER writes to the engine. It only reads: local sandbox checkout
 * first, GitHub raw fallback (Vercel) second. Artifacts are derived summaries
 * of SYNTHETIC paper runs — never market evidence.
 */

/** Distribution summary {mean,std,p5,p50,p95,min,max} — nulls when n = 0. */
export type Dist = {
  mean: number | null;
  std: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
};

/** One settled paper position (compact row, formulas documented in the sweep script). */
export type SettledRow = {
  position_id: string;
  strategy_id: string;
  opened_day: number;
  settle_day: number;
  held_days: number;
  signed_pnl_usd: number;
  pnl_pct_of_notional: number;
  ex_ante_net_edge_bps: number;
  ex_ante_gross_edge_bps: number;
  // forward family (locked carry) — null on perp rows
  locked_premium_usd: number | null;
  locked_premium_bps: number | null;
  realized_minus_locked_bps: number | null;
  locked_premium_apr: number | null;
  // perp family (floating carry) — null on forward rows
  funding_accrual_usd: number | null;
  funding_accrual_bps: number | null;
  realized_minus_expected_bps: number | null;
  // shared
  perp_alternative_apr: number | null;
  quantity_chain_ok: boolean;
};

/** Per-family counters inside the run summary. */
export type FamilyCounts = {
  evals: number;
  gated_in: number;
  selected: number;
  opened: number;
  settled: number;
};

/** Exact pipeline run_summary dict (representative seed). */
export type RunSummary = {
  synthetic: boolean;
  seed: number;
  days: number;
  tenor_days: number;
  quotes: number;
  quote_events: number;
  family_evals: number;
  gated_in_family_days: number;
  contested_days: number;
  selected_days: number;
  risk_rejects: number;
  positions_opened: number;
  positions_settled: number;
  positions_still_open: number;
  per_family: Record<string, FamilyCounts>;
  realized_signed_pnl_usd: number;
  aggregate_pct_of_notional: number;
  mean_per_position_pct: number;
  ex_ante_net_edge_mean_pct: number | null;
  unit_rule: string;
  epistemic_note: string;
};

/** ALL-IN EDGE waterfall — every subtraction an explicit line (I-4). */
export type Waterfall = {
  gross_edge_bps: number;
  entry_cost_bps: number;
  exit_cost_bps: number;
  carry_uncertainty_buffer_bps: number;
  slippage_buffer_bps: number;
  execution_risk_buffer_bps: number;
  net_executable_edge_bps: number;
};

export type OpportunityLeg = {
  instrument: string;
  kind: string;
  venue: string;
  direction: number;
  qty: number;
  px: { value: number; source: string; ts: number };
  requested_size_usd: number;
  executed_size_usd: number;
};

/** The last executed opportunity of the representative run (family-dependent metadata). */
export type OpportunityExample = {
  strategy_id: string;
  ts: number;
  legs: OpportunityLeg[];
  carry: {
    locked: boolean;
    expected_usd: number;
    sigma_usd: number;
    description: string;
  };
  gross_edge_bps: number;
  net_executable_edge_bps: number;
  horizon_days: number;
  signal_z: number | null;
  confidence: number;
  requested_notional_usd: number;
  metadata: {
    realized_apr?: number;
    realized_sigma_apr?: number;
    expected_apr?: number;
    sigma_level_apr?: number;
    sigma_horizon_apr?: number;
    forward_implied_apr?: number;
    gap_apr?: number;
    signal_z_level?: number;
    ref_mid?: number;
    ranked_over?: string[];
    gates: Record<string, boolean>;
    waterfall: Waterfall;
    price_sources: Record<string, string>;
  };
};

/** Daily printed funding APR — the observation stream, journaled. */
export type CarryCurvePoint = { day: number; apr_printed: number };

/** Per-quote-day net edges of both families + who won the ranking. */
export type FamilyEdgePoint = {
  day: number;
  forward_net_edge_bps: number | null;
  perp_net_edge_bps: number | null;
  selected: string | null;
};

/** research/artifacts/run-latest.json — stable filename, overwritten per sweep. */
export type RunLatest = {
  generated_at: string;
  engine_version: string;
  run_id: string;
  journal_path: string;
  summary: RunSummary;
  settled: SettledRow[];
  opportunity_example: OpportunityExample;
  carry_curve?: CarryCurvePoint[];
  family_edge_series?: FamilyEdgePoint[];
};

export type SweepParams = {
  seeds: number[];
  days: number;
  tenor_days: number;
  size_usd: number;
  quote_every_days: number;
  warmup_days: number;
  ewma_half_life_h: number;
  world?: string;
};

export type SweepTotals = {
  quotes: number;
  quote_events: number;
  family_evals: number;
  gated_in_family_days?: number;
  contested_days: number;
  selected_days: number;
  risk_rejects: number;
  opened: number;
  settled: number;
  still_open: number;
  // v0.2 compat (optional in v0.3 artifacts)
  gated?: number;
};

export type PerSeed = {
  seed: number;
  quotes: number;
  family_evals: number;
  contested_days: number;
  selected_days: number;
  risk_rejects: number;
  opened: number;
  settled: number;
  still_open: number;
  realized_usd: number;
  aggregate_pct: number;
  mean_pct: number;
};

/** Ranking layer stats (decision record C5/C6). */
export type RankingStats = {
  contested_days_total?: number;
  contested_days_evaluated: number;
  truncated_excluded: number;
  hits: number;
  misses: number;
  ties: number;
  hit_rate_pct: number | null;
  forward_selection_share_ramp_pct: number | null;
  forward_selection_share_collapse_pct: number | null;
  contests_ramp_phase: number;
  contests_collapse_phase: number;
  definition: string;
};

/** One calibration panel (σ_level = the v0.2 finding kept for audit; horizon = σ_H). */
export type CalibrationPanel = {
  sigma: string;
  n_checks: number;
  n_breaches: number;
  empirical_breach_pct: number | null;
};

/** Falsifiable predictions from the decision record, scored by the sweep. */
export type Prediction = {
  statement: string;
  verdict: string;
};

/** Per-family census entry in the sweep artifact. */
export type FamilyCensusEntry = {
  evals: number;
  gated_in: number;
  selected: number;
  opened: number;
  settled: number;
  settled_stats: {
    n: number;
    pnl_pct_of_notional: Dist;
    realized_minus_locked_bps?: Dist;
    funding_accrual_bps?: Dist;
    realized_minus_expected_bps?: Dist;
  };
};

/** research/artifacts/sweep-latest.json — multi-seed machinery validation. */
export type SweepArtifact = {
  generated_at: string;
  engine_version: string;
  params: SweepParams;
  totals: SweepTotals;
  selection_rate_pct?: number | null;
  contested_share_of_selected_days_pct?: number | null;
  gate_fire_rate_pct?: number | null; // v0.2 compat
  reject_reasons: { reason: string; count: number }[];
  family_census?: Record<string, FamilyCensusEntry>;
  ranking?: RankingStats;
  settled_stats: {
    n: number;
    pnl_pct_of_notional: Dist;
    realized_minus_locked_bps?: Dist;
    locked_minus_perp_alt_apr_bps?: Dist;
    n_skipped_perp_null?: number;
  };
  z_gate_calibration: {
    threshold_z: number;
    nominal_two_sided_pct: number;
    empirical_breach_pct?: number | null; // v0.2 compat
    n_checks?: number;
    n_breaches?: number;
    panel_level?: CalibrationPanel;
    panel_horizon?: CalibrationPanel;
    definition: string;
  };
  predictions?: Record<string, Prediction>;
  per_seed: PerSeed[];
  notes: {
    synthetic: boolean;
    epistemic_note: string;
    unit_rule: string;
  };
};

/** /api/engine/overview response. */
export type EngineOverview = {
  now: string;
  mode: "local" | "remote";
  source: { kind: string; detail: string };
  repo: {
    url: string;
    branch: string;
    commit: string | null;
    commit_msg: string | null;
    commit_date: string | null;
    dirty: boolean | null;
    version: string | null;
  };
  latest_run: RunLatest | null;
  sweep: SweepArtifact | null;
  artifacts: {
    run_latest: boolean;
    sweep_latest: boolean;
    run_age_s: number | null;
    sweep_age_s: number | null;
  };
};
