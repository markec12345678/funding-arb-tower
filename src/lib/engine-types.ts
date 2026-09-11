/**
 * quant-arb-engine artifact types — the contract between the engine's
 * research artifacts (research/artifacts/run-latest.json + sweep-latest.json,
 * written by scripts/research_sweep.py in the engine repo) and the tower's
 * read-only engine monitor (/api/engine/overview → EngineView).
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
  locked_premium_usd: number;
  locked_premium_bps: number;
  realized_minus_locked_bps: number;
  perp_alternative_apr: number | null;
  locked_premium_apr: number;
  quantity_chain_ok: boolean;
};

/** Exact pipeline run_summary dict (representative seed). */
export type RunSummary = {
  synthetic: boolean;
  seed: number;
  days: number;
  tenor_days: number;
  quotes: number;
  opportunities_gated_in: number;
  risk_rejects: number;
  positions_opened: number;
  positions_settled: number;
  positions_still_open: number;
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

/** The last gated-in opportunity of the representative run (full payload). */
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
    realized_apr: number;
    realized_sigma_apr: number;
    forward_implied_apr: number;
    gap_apr: number;
    gates: { z_gate: boolean; net_edge_gate: boolean };
    waterfall: Waterfall;
    price_sources: Record<string, string>;
  };
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
};

export type SweepParams = {
  seeds: number[];
  days: number;
  tenor_days: number;
  size_usd: number;
  quote_every_days: number;
  warmup_days: number;
  ewma_half_life_h: number;
};

export type SweepTotals = {
  quotes: number;
  quote_events: number;
  gated: number;
  risk_rejects: number;
  opened: number;
  settled: number;
  still_open: number;
};

export type PerSeed = {
  seed: number;
  quotes: number;
  gated: number;
  risk_rejects: number;
  opened: number;
  settled: number;
  still_open: number;
  realized_usd: number;
  aggregate_pct: number;
  mean_pct: number;
  realized_minus_locked_bps_mean: number | null;
};

/** research/artifacts/sweep-latest.json — multi-seed machinery validation. */
export type SweepArtifact = {
  generated_at: string;
  engine_version: string;
  params: SweepParams;
  totals: SweepTotals;
  gate_fire_rate_pct: number | null;
  gate_fire_rate_per_quote_record_pct?: number | null;
  reject_reasons: { reason: string; count: number }[];
  settled_stats: {
    n: number;
    n_skipped_perp_null?: number;
    pnl_pct_of_notional: Dist;
    realized_minus_locked_bps: Dist;
    locked_minus_perp_alt_apr_bps: Dist;
  };
  z_gate_calibration: {
    threshold_z: number;
    nominal_two_sided_pct: number;
    empirical_breach_pct: number | null;
    n_checks: number;
    n_breaches?: number;
    definition: string;
  };
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
