"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Calculator,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  ExternalLink,
  FlaskConical,
  Github,
  Grid3x3,
  Layers,
  Loader2,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  auditFindings,
  auditMeta,
  type AuditFinding,
  type FindingSeverity,
} from "@/data/audit-findings";
import {
  matrixCells,
  matrixGroupLabels,
  matrixMeta,
  matrixRootCauses,
  matrixVerdictBadge,
  matrixVerdictCounts,
  matrixVerdictLabel,
  type MatrixGroup,
  type MatrixVerdict,
} from "@/data/failure-matrix";
import EngineView from "@/components/quant-engine/EngineView";

type Freshness = {
  data_age_s: number | null;
  expected_cycle_s: number;
  stale_after_s: number;
  stale: boolean | null;
  status: "fresh" | "stale" | "unknown";
  checked_at: string;
  branch_age_s: number | null;
  log_age_s: number | null;
  lifecycle_age_s: number | null;
};

type Phase2 = {
  available: boolean;
  source: string | null;
  reason: string | null;
  generated_at: string | null;
  age_s: number | null;
  check_overdue: boolean | null;
  day: number | null;
  stage: string | null;
  baseline_start: string | null;
  day3_at: string | null;
  day7_at: string | null;
  totals: {
    price: number;
    fees: number;
    funding: number;
    net: number;
    retention_avg_pct: number;
    wins: number;
    closed: number;
  } | null;
  integrity: {
    parse_errors: number | null;
    duplicate_ts: number | null;
    ts_back_jumps: number | null;
    gaps_over_15min: number | null;
    duplicate_position_ids: number | null;
    open_now: number | null;
    last_cycle_open_positions: number | null;
    collector_coverage_pct: number | null;
    collector_duplicate_ts: number | null;
    collector_gaps_over_10min: number | null;
    supervisor_alive: boolean | null;
    snapshot_pusher_runs: number | null;
    snapshot_pusher_ok: number | null;
    sandbox_snapshot_resets: number | null;
    gh_snapshot_resets: number | null;
  } | null;
};

type SupervisorLane = {
  role: string;
  expected_s: number;
  stale_after_s: number;
  last_activity_ago_s: number | null;
  last_result: string | null;
  healthy: boolean | null;
  total: number | null;
  ok: number | null;
  fails: number | null;
};

type Status = {
  now: string;
  mode: "local" | "remote";
  source: { kind: string; detail: string };
  freshness: Freshness;
  supervisors?: {
    heartbeat: SupervisorLane | null;
    snapshot: SupervisorLane | null;
    phase2: SupervisorLane | null;
    reason: string | null;
  } | null;
  phase2?: Phase2 | null;
  repo: { branch: string; commits: { sha: string; message: string }[]; dirty: boolean };
  paper: {
    runner: { alive: boolean; pid: number | null; log_updated_at: string | null; log_tail: string[] };
    cycles: {
      ts: string;
      scan_total: number;
      candidates: number;
      opens: number;
      open_simulated: number;
      open_aborted: number;
      open_filled: number;
      closes: number;
      open_positions: number;
    }[];
    aborts: { reason: string; count: number }[];
    totals: Record<string, number>;
    positions: any[];
    exits: {
      generated_at: string;
      journal_span: { from: string | null; to: string | null; cycles: number };
      categories: {
        category: string;
        count: number;
        share: number;
        avg_held_h: number | null;
        avg_pnl_pct: number | null;
        total_pnl_pct: number | null;
      }[];
      raw_baseline: { closes: number; avg_pnl_pct: number | null; total_pnl_pct: number | null };
      diagnostic_baseline: { closes: number; avg_pnl_pct: number | null; total_pnl_pct: number | null };
      e04_contamination: { closes: number; avg_pnl_pct: number | null; total_pnl_pct: number | null };
      attribution_check: {
        attributable_total_pct: number | null;
        contamination_total_pct: number | null;
        raw_total_pct: number | null;
        consistent: boolean | null;
      };
      survival: {
        opened: number | null;
        closed_normal: number;
        closed_data_gap: number;
        still_open: number | null;
      };
      per_exit: {
        position_id: string;
        base: string;
        category: string;
        edge_pct: number | null;
        held_h: number | null;
        pnl_pct: number | null;
        pnl_signed_pct: number | null;
        mis_signed: boolean | null;
        spread_crossed: boolean | null;
        closed_at: string | null;
      }[];
      signed_check: {
        closes: number;
        mis_signed: number;
        crossed: number;
        instrument: { attributable_pct: number | null; contamination_pct: number | null; raw_pct: number | null };
        signed: { attributable_pct: number | null; contamination_pct: number | null; raw_pct: number | null };
        identity_signed: boolean | null;
      };
      note: string;
    } | null;
    economics: {
      generated_at: string;
      closes: number;
      attributable: {
        rows: number;
        summed_trade_usd: number | null;
        spread_pnl_usd: number | null;
        net_funding_usd: number | null;
        fee_usd: number | null;
        economic_usd: number | null;
        spread_total_pct: number | null;
        spread_signed_total_pct: number | null;
        economic_signed_total_pct: number | null;
        net_funding_total_pct: number | null;
        fee_total_pct: number | null;
        economic_total_pct: number | null;
        economic_of_capital_pct: number | null;
        r6_upper_pct: number | null;
        r6_lower_pct: number | null;
      };
      data_gap: {
        rows: number;
        net_funding_usd: number | null;
        economic_usd: number | null;
      };
      identity_check: {
        spread_pct: number;
        funding_pct: number;
        fees_pct: number;
        economic_pct: number;
        consistent: boolean;
      } | null;
      completeness: { complete: number; incomplete: number };
      per_close: {
        position_id: string;
        base: string;
        is_data_gap: boolean;
        closed_at: string | null;
        held_h: number | null;
        requested_usd: number | null;
        long_notional_usd: number | null;
        short_notional_usd: number | null;
        long_interval_h: number | null;
        short_interval_h: number | null;
        long_settlements: number | null;
        short_settlements: number | null;
        long_leg_funding_usd: number | null;
        short_leg_funding_usd: number | null;
        net_funding_usd: number | null;
        net_funding_sc_usd: number | null;
        fee_usd: number | null;
        spread_pnl_usd: number | null;
        spread_signed_usd: number | null;
        economic_usd: number | null;
        economic_sc_usd: number | null;
        economic_signed_usd: number | null;
        r6_upper_pct: number | null;
        r6_lower_pct: number | null;
        new_estimate_pct: number | null;
        components_complete: boolean;
      }[];
      note: string;
    } | null;
  };
  backtest: any;
  pipeline: {
    github: any;
    funding_ci: {
      repo: string;
      url: string;
      latest: {
        sha: string;
        status: string;
        conclusion: string | null;
        completed_at: string | null;
      } | null;
      summary: string;
    } | null;
    tower_ci: {
      repo: string;
      url: string;
      latest: {
        sha: string;
        status: string;
        conclusion: string | null;
        completed_at: string | null;
      } | null;
      summary: string;
    } | null;
    engine_ci: {
      repo: string;
      url: string;
      latest: {
        sha: string;
        status: string;
        conclusion: string | null;
        completed_at: string | null;
      } | null;
      summary: string;
    } | null;
    phase3: {
      repo: string;
      url: string;
      latest: { sha: string; message: string; date: string | null } | null;
      summary: string;
      tests: string;
      status: string;
    } | null;
    vercel: any;
    snapshot: {
      source: string;
      refreshed_by: string;
      lifecycle: string;
      generated_at: string | null;
      age_s: number | null;
      expected_s: number;
      stale: boolean | null;
      status: string;
    } | null;
  };
  plan: { step: string; state: string }[];
};

const fmt = (n: number | undefined | null) =>
  n === undefined || n === null ? "—" : n.toLocaleString("sl-SI");

const age = (s: number | null | undefined) => {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const pct = (n: number | undefined | null, d = 4) =>
  n === undefined || n === null ? "—" : `${n.toFixed(d)}%`;

const usd = (n: number | undefined | null) =>
  n === undefined || n === null ? "—" : `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;

// Time-until formatter for the Phase-2 milestones (re-evaluated on every
// 10s status poll — good enough for hour/day-scale countdowns).
const until = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(s)) return "—";
  if (s <= 0) return "due now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/* ---- Audit findings register (static — renders without the status API) ---- */

const severityRank: Record<FindingSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

// P0 red (destructive) · P1 orange · P2 amber · P3 muted — dual-mode classes,
// the page wrapper below declares `dark` so the dark halves always apply here.
const severityBadge: Record<FindingSeverity, string> = {
  P0: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  P1: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  P2: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  P3: "border-zinc-400/50 dark:border-zinc-700 bg-zinc-400/10 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
};

const severityCounts: { severity: FindingSeverity; count: number }[] = (
  ["P0", "P1", "P2", "P3"] as const
).map((severity) => ({
  severity,
  count: auditFindings.filter((f) => f.severity === severity).length,
}));

// Register order: severity first (P0 → P3), then id.
const sortedAuditFindings: AuditFinding[] = [...auditFindings].sort(
  (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id),
);

/* ---- Failure matrix (R4 — state-by-state safe-transition proof) ---- */

const verdictRank: Record<MatrixVerdict, number> = { gap: 0, ambiguous: 1, safe: 2 };

const matrixGroups: MatrixGroup[] = ["order", "position", "recovery"];

const verdictDot: Record<MatrixVerdict, string> = {
  safe: "bg-emerald-400",
  ambiguous: "bg-amber-400",
  gap: "bg-red-400",
};

/* ---- Exit classification (passive E-04 contamination split) ---- */

const exitCategoryLabel: Record<string, string> = {
  edge_collapse: "genuine edge collapse",
  stop_loss: "PnL stop-loss (watcher)",
  funding_condition: "funding condition (watcher)",
  safety: "manual / system safety",
  data_gap: "E-04 data-gap (edge=-999)",
  other: "other (edge above threshold)",
};

const exitCategoryBadge: Record<string, string> = {
  edge_collapse: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  stop_loss: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  funding_condition: "border-teal-500/40 bg-teal-500/10 text-teal-400",
  safety: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  data_gap: "border-red-500/40 bg-red-500/10 text-red-400",
  other: "border-zinc-600/60 bg-zinc-700/30 text-zinc-400",
};

const exitCategoryDot: Record<string, string> = {
  edge_collapse: "bg-emerald-400",
  stop_loss: "bg-orange-400",
  funding_condition: "bg-teal-400",
  safety: "bg-amber-400",
  data_gap: "bg-red-400",
  other: "bg-zinc-500",
};

function Card({
  title,
  icon,
  children,
  className = "",
}: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur p-4 sm:p-5 ${className}`}
    >
      {title && (
        <header className="mb-3 flex items-center gap-2 text-zinc-400">
          {icon}
          <h2 className="text-xs font-semibold uppercase tracking-widest">{title}</h2>
        </header>
      )}
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-rose-400"
          : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function FunnelBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-44 shrink-0 truncate text-zinc-400">{label}</div>
      <div className="h-5 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <div className="w-16 shrink-0 text-right font-mono tabular-nums text-zinc-200">{fmt(value)}</div>
    </div>
  );
}

// Phase-2 integrity chip — good (emerald) / warn (amber, inspect-grade by the
// analyzer's own verdict language) / bad (rose). Non-interactive, informational.
function P2Chip({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "good" | "bad" | "warn";
}) {
  const cls =
    state === "good"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : state === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : "border-red-500/40 bg-red-500/10 text-red-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${cls}`}
      title={label}
    >
      {label} <span className="tabular-nums font-semibold">{value}</span>
    </span>
  );
}

export default function Home() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // View switch: the tower now hosts two windows — the funding-arb live
  // monitor (measurement) and the quant-arb-engine research monitor
  // (exploration, read-only, synthetic data). Both stay on the single /
  // route; the footer keeps its sticky contract either way.
  const [view, setView] = useState<"engine" | "monitor">("engine");

  const load = useCallback(async () => {
    try {
      // Propagate ?source=remote from the page URL to the API: lets the
      // sandbox UI render exactly what a deployed (Vercel) instance sees.
      const forceRemote =
        typeof window !== "undefined" && window.location.search.includes("source=remote");
      const r = await fetch(`/api/status${forceRemote ? "?source=remote" : ""}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "unknown");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const bt = data?.backtest;
  const p = data?.paper;
  const fr = data?.freshness;
  // Tower supervisor lanes (5-min dispatch + hourly lifecycle push) — local
  // mode only; remote mode returns null lanes with an honest reason.
  const sup = data?.supervisors;
  const supH = sup?.heartbeat ?? null;
  const supS = sup?.snapshot ?? null;
  const supP = sup?.phase2 ?? null;
  const ph = data?.phase2 ?? null;
  const snap = data?.pipeline?.snapshot ?? null;
  const totals = p?.totals ?? {};
  const lastCycle = p?.cycles?.[0];
  const funnelMax = Math.max(1, totals.scan_total || 0, totals.candidates || 0, totals.opens || 0, totals.open_simulated || 0);

  // The observability rule: green requires LIVE DATA, not just a live
  // process. A stale/unknown data plane is RED even while the runner pid
  // still exists — "healthy" must never degrade to "the process didn't die".
  // The pill names BOTH planes it certifies (process · data); the full
  // three-plane breakdown (process / data / log) lives in the paper card —
  // a single floating "LIVE" is ambiguous and was retired.
  const dataStale = !fr || fr.status === "stale" || fr.status === "unknown";
  const pill = dataStale
    ? {
        cls: "border-rose-500/40 bg-rose-500/10 text-rose-400",
        icon: <Activity className="h-3.5 w-3.5" />,
        text:
          fr?.status === "unknown"
            ? "no data yet"
            : `data stale · ${age(fr?.data_age_s)} old`,
      }
    : p?.runner?.alive
      ? {
          cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
          icon: <Radio className="h-3.5 w-3.5 animate-pulse" />,
          text:
            data?.mode === "remote" ? "collector live · data fresh" : "runner live · data fresh",
        }
      : {
          cls: "border-rose-500/40 bg-rose-500/10 text-rose-400",
          icon: <Radio className="h-3.5 w-3.5" />,
          text: data?.mode === "remote" ? "collector stale" : "runner down",
        };

  return (
    <div className="dark min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                funding-arb <span className="text-zinc-500">· command center</span>
              </h1>
              <p className="text-xs text-zinc-500">
                two systems, one command center — funding-arb measures reality (locked @ 0373f5d) ·
                quant-arb-engine explores the next generation (paper only)
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  data.mode === "local"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                }`}
                title={data.source.detail}
              >
                <Layers className="h-3.5 w-3.5" />
                {data.mode === "local" ? "sandbox live" : "github branch"}
              </span>
            )}
            {data && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${pill.cls}`}
                title={
                  fr
                    ? `newest cycle ${age(fr.data_age_s)} old · new cycle expected every ${Math.round(fr.expected_cycle_s / 60)} min · stale after ${Math.round(fr.stale_after_s / 60)} min`
                    : undefined
                }
              >
                {pill.icon}
                {pill.text}
              </span>
            )}
            <a
              href="https://funding-arb-dun.vercel.app"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              demo dashboard <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="https://github.com/markec12345678/funding-arb"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <Github className="h-3 w-3" /> repo
            </a>
          </div>
        </header>

        {/* View switcher — live monitor (funding-arb) vs quant engine (research, read-only) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
            <button
              type="button"
              aria-pressed={view === "engine"}
              onClick={() => setView("engine")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "engine"
                  ? "border-teal-500/40 bg-teal-500/15 text-teal-300"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              quant engine
              <span className="rounded-full border border-teal-500/40 bg-teal-500/10 px-1.5 py-px text-[9px] font-semibold uppercase text-teal-400">
                new
              </span>
            </button>
            <button
              type="button"
              aria-pressed={view === "monitor"}
              onClick={() => setView("monitor")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "monitor"
                  ? "border-zinc-400 bg-zinc-100 text-zinc-900"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              live monitor
              {view === "monitor" && data && !dataStale && (
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
          <span className="text-[11px] text-zinc-600">
            {view === "engine"
              ? "engine view · synthetic research data · read-only"
              : "monitor view · live paper-validation data"}
          </span>
        </div>

        {view === "monitor" && !loaded && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> loading pipeline status…
          </div>
        )}
        {view === "monitor" && error && loaded && !data && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            Status API unavailable: {error}
          </div>
        )}

        {view === "monitor" && data && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <Kpi label="tests" value="539+106" sub="funding-arb 539 · phase3-lab 106" tone="good" />
              <Kpi label="backtest window" value="30 d" sub="BTC·ETH·SOL · 4 CEX + HL" />
              <Kpi
                label="backtest trades"
                value="0"
                sub="fee gate > best spread 5×"
                tone="warn"
              />
              <Kpi label="paper cycles" value={fmt(totals.cycles)} sub={`last scan ${fmt(lastCycle?.scan_total)} rows`} />
              <Kpi
                label="signals → candidates"
                value={`${fmt(totals.candidates)}`}
                sub={`of ${fmt(totals.scan_total)} rows scanned`}
              />
              <Kpi
                label="paper positions"
                value={fmt(p?.positions?.filter((x: any) => x.status === "open").length ?? 0)}
                sub={`${fmt(totals.open_simulated)} simulated opens · ${fmt(totals.open_aborted)} gate rejects`}
                tone={(totals.open_simulated ?? 0) > 0 ? "good" : "default"}
              />
            </div>

            {/* Phase-2 A/B/C window — the 7-day decision process made visible.
                Consumes the locked analyzer's report-latest.json VERBATIM
                (the tower never recomputes decision inputs); the daily
                verify-only check is enforced by visibility: if the report
                ages past 26h the card says OVERDUE, not silent. */}
            <Card
              title="phase-2 A/B/C — window, discipline & decision support"
              icon={<CalendarClock className="h-4 w-4" />}
            >
              {ph && ph.available ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                      day {ph.day !== null ? ph.day.toFixed(2) : "—"}
                      <span className="text-sm font-normal text-zinc-500"> of 7</span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                        ph.stage === "FINAL-WINDOW"
                          ? "border-red-500/40 bg-red-500/10 text-red-400"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      stage {ph.stage ?? "—"}
                    </span>
                    {ph.check_overdue === true ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-400">
                        DAILY CHECK OVERDUE
                      </span>
                    ) : ph.check_overdue === false ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                        daily check fresh
                      </span>
                    ) : null}
                    <span className="text-[11px] text-zinc-500">
                      baseline {ph.baseline_start ?? "—"} · report generated{" "}
                      {ph.generated_at ?? "—"} ({age(ph.age_s)} ago) · source {ph.source}
                    </span>
                  </div>

                  <div
                    className="h-2 overflow-hidden rounded bg-zinc-800"
                    role="progressbar"
                    aria-label="Phase-2 window progress"
                    aria-valuenow={ph.day ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={7}
                  >
                    <div
                      className="h-full bg-amber-500/80"
                      style={{ width: `${Math.min(100, ((ph.day ?? 0) / 7) * 100)}%` }}
                    />
                  </div>

                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Day-3 interim read
                      </div>
                      <div className="mt-1 font-mono text-zinc-200">{ph.day3_at ?? "—"}</div>
                      <div className="mt-0.5 text-zinc-500">in {until(ph.day3_at)}</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Day-7 A/B/C decision
                      </div>
                      <div className="mt-1 font-mono text-zinc-200">{ph.day7_at ?? "—"}</div>
                      <div className="mt-0.5 text-zinc-500">in {until(ph.day7_at)}</div>
                    </div>
                  </div>

                  {ph.integrity && (
                    <div className="flex flex-wrap items-center gap-2">
                      <P2Chip
                        label="parse errors"
                        value={fmt(ph.integrity.parse_errors)}
                        state={(ph.integrity.parse_errors ?? 1) === 0 ? "good" : "bad"}
                      />
                      <P2Chip
                        label="dup ts"
                        value={fmt(ph.integrity.duplicate_ts)}
                        state={(ph.integrity.duplicate_ts ?? 1) === 0 ? "good" : "bad"}
                      />
                      <P2Chip
                        label="ts back-jumps"
                        value={fmt(ph.integrity.ts_back_jumps)}
                        state={(ph.integrity.ts_back_jumps ?? 1) === 0 ? "good" : "bad"}
                      />
                      <P2Chip
                        label="journal gaps>15m"
                        value={fmt(ph.integrity.gaps_over_15min)}
                        state={(ph.integrity.gaps_over_15min ?? 1) === 0 ? "good" : "bad"}
                      />
                      <P2Chip
                        label="dup position ids"
                        value={fmt(ph.integrity.duplicate_position_ids)}
                        state={(ph.integrity.duplicate_position_ids ?? 1) === 0 ? "good" : "bad"}
                      />
                      <P2Chip
                        label="opens = last-cycle"
                        value={`${fmt(ph.integrity.open_now)} = ${fmt(ph.integrity.last_cycle_open_positions)}`}
                        state={
                          ph.integrity.open_now !== null &&
                          ph.integrity.open_now === ph.integrity.last_cycle_open_positions
                            ? "good"
                            : "bad"
                        }
                      />
                      <P2Chip
                        label="collector coverage"
                        value={ph.integrity.collector_coverage_pct !== null ? `${ph.integrity.collector_coverage_pct.toFixed(1)}%` : "—"}
                        state={(ph.integrity.collector_coverage_pct ?? 0) >= 99.5 ? "good" : "warn"}
                      />
                      <P2Chip
                        label="collector gaps>10m (inspect)"
                        value={fmt(ph.integrity.collector_gaps_over_10min)}
                        state="warn"
                      />
                      <P2Chip
                        label="supervisor"
                        value={ph.integrity.supervisor_alive === null ? "—" : ph.integrity.supervisor_alive ? "alive" : "down"}
                        state={ph.integrity.supervisor_alive ? "good" : "bad"}
                      />
                      <P2Chip
                        label="snapshot pusher"
                        value={`${fmt(ph.integrity.snapshot_pusher_ok)}/${fmt(ph.integrity.snapshot_pusher_runs)}`}
                        state={
                          ph.integrity.snapshot_pusher_ok !== null &&
                          ph.integrity.snapshot_pusher_ok === ph.integrity.snapshot_pusher_runs
                            ? "good"
                            : "warn"
                        }
                      />
                      <P2Chip
                        label="snapshot resets (sb · gh)"
                        value={`${fmt(ph.integrity.sandbox_snapshot_resets)} · ${fmt(ph.integrity.gh_snapshot_resets)}`}
                        state={
                          (ph.integrity.sandbox_snapshot_resets ?? 1) === 0 &&
                          (ph.integrity.gh_snapshot_resets ?? 1) === 0
                            ? "good"
                            : "bad"
                        }
                      />
                    </div>
                  )}

                  {ph.totals && (
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        decision support — the analyzer&rsquo;s own totals, rendered verbatim (interim
                        = information, not verdict)
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">wins / closed</div>
                          <div className="tabular-nums text-zinc-200">
                            {fmt(ph.totals.wins)} / {fmt(ph.totals.closed)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">net PnL</div>
                          <div
                            className={`tabular-nums ${ph.totals.net < 0 ? "text-rose-400" : "text-emerald-400"}`}
                          >
                            {usd(ph.totals.net)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">price</div>
                          <div className="tabular-nums text-zinc-300">{usd(ph.totals.price)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">fees</div>
                          <div className="tabular-nums text-rose-400">{usd(ph.totals.fees)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">funding</div>
                          <div className="tabular-nums text-emerald-400">{usd(ph.totals.funding)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-zinc-600">avg retention</div>
                          <div className="tabular-nums text-zinc-300">
                            {pct(ph.totals.retention_avg_pct, 1)}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                        locked decision framework (phase2_report.py §9, quoted verbatim):{" "}
                        <span className="font-semibold text-zinc-300">A</span> — net PnL &gt; 0 across
                        enough lifecycles → minimal live ·{" "}
                        <span className="font-semibold text-zinc-300">B</span> — signal present but
                        eaten by execution friction → execution-layer changes only ·{" "}
                        <span className="font-semibold text-zinc-300">C</span> — no executable edge →
                        close strategy, stop feature development
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-600">
                        The tower never recomputes decision inputs — it renders report-latest.json
                        exactly as the locked analyzer wrote it. The verdict is rendered only after
                        Day 7; interim reads are information.
                      </p>
                    </div>
                  )}
                </div>
              ) : ph ? (
                <div className="text-sm text-zinc-500">
                  Phase-2 report unavailable — {ph.reason}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">
                  Phase-2 discipline card waiting for the status API…
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Backtest verdict */}
              <Card title="30-day backtest — verdict" icon={<TrendingDown className="h-4 w-4" />}>
                {bt ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                      <span className="font-semibold">Zero executable trades on majors.</span>{" "}
                      Best per-settlement spread{" "}
                      <span className="font-mono">{pct(bt.fee_gate.best_spread_pct)}</span> vs two-leg
                      taker fee <span className="font-mono">{pct(bt.fee_gate.round_trip_taker_pct, 2)}</span> →
                      best net edge{" "}
                      <span className="font-mono text-rose-300">{pct(bt.fee_gate.best_net_edge_pct)}</span>.
                      Spikes mean-revert within one settlement (p99 ≈ 0).
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-2">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">
                          CEX ↔ CEX (8h), {fmt(bt.spread_distribution.cex_vs_cex_8h.observations)} obs
                        </div>
                        <div className="font-mono text-zinc-200 space-y-1">
                          <div>max {pct(bt.spread_distribution.cex_vs_cex_8h.max_pct)}</div>
                          <div>p99 {pct(bt.spread_distribution.cex_vs_cex_8h.p99_pct)}</div>
                          <div>median {pct(bt.spread_distribution.cex_vs_cex_8h.median_pct)}</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">
                          HL (8h-equiv) ↔ CEX, {fmt(bt.spread_distribution.hyperliquid_8h_equiv_vs_cex.observations)} obs
                        </div>
                        <div className="font-mono text-zinc-200 space-y-1">
                          <div>max {pct(bt.spread_distribution.hyperliquid_8h_equiv_vs_cex.max_pct)}</div>
                          <div>p99 {pct(bt.spread_distribution.hyperliquid_8h_equiv_vs_cex.p99_pct)}</div>
                          <div>median {pct(bt.spread_distribution.hyperliquid_8h_equiv_vs_cex.median_pct)}</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">{bt.verdict}</p>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500">analysis unavailable</div>
                )}
              </Card>

              {/* Paper funnel */}
              <Card title="paper funnel — live (last 10h)" icon={<Activity className="h-4 w-4" />}>
                <div className="space-y-3">
                  <FunnelBar label="scanner rows" value={totals.scan_total ?? 0} max={funnelMax} tone="bg-zinc-600" />
                  <FunnelBar label="entry candidates (spread+fee gate)" value={totals.candidates ?? 0} max={funnelMax} tone="bg-amber-500" />
                  <FunnelBar label="executor attempts" value={totals.opens ?? 0} max={funnelMax} tone="bg-orange-500" />
                  <FunnelBar label="gate rejects (depth/price/recheck)" value={totals.open_aborted ?? 0} max={funnelMax} tone="bg-rose-500" />
                  <FunnelBar label="paper positions opened" value={totals.open_simulated ?? 0} max={funnelMax} tone="bg-emerald-500" />
                </div>
                {p?.aborts && p.aborts.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">rejection reasons</div>
                    {p.aborts.map((a) => (
                      <div key={a.reason} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">{a.reason}</span>
                        <span className="font-mono text-rose-300">×{a.count}</span>
                      </div>
                    ))}
                  </div>
                )}
                {fr && (
                  <div className="mt-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5 font-mono text-[11px] tabular-nums">
                    <div className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      status — three separate planes
                    </div>
                    {/* PROCESS plane — the pid/process fact on its own */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                        {data.mode === "remote" ? "collector" : "process"}
                      </span>
                      {data.mode === "remote" ? (
                        fr.branch_age_s === null ? (
                          <span className="text-zinc-500">unknown</span>
                        ) : fr.branch_age_s <= fr.stale_after_s ? (
                          <span className="font-semibold text-emerald-400">LIVE</span>
                        ) : (
                          <span className="font-semibold text-rose-400">STALE</span>
                        )
                      ) : p?.runner?.alive ? (
                        <span className="font-semibold text-emerald-400">LIVE</span>
                      ) : (
                        <span className="font-semibold text-rose-400">DOWN</span>
                      )}
                      {data.mode === "remote" ? (
                        <span className="text-zinc-500">· branch pushed {age(fr?.branch_age_s)} ago</span>
                      ) : (
                        <span className="text-zinc-500">· pid {p?.runner?.pid ?? "—"}</span>
                      )}
                    </div>
                    {/* DATA plane — the health gate */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                        data
                      </span>
                      {fr.status === "fresh" ? (
                        <span className="font-semibold text-emerald-400">FRESH</span>
                      ) : fr.status === "stale" ? (
                        <span className="font-semibold text-rose-400">STALE</span>
                      ) : (
                        <span className="text-zinc-500">unknown</span>
                      )}
                      <span className="text-zinc-500">
                        · newest cycle {age(fr.data_age_s)} old · every{" "}
                        {Math.round(fr.expected_cycle_s / 60)} min · stale after {Math.round(fr.stale_after_s / 60)} min
                      </span>
                    </div>
                    {/* LOG plane — informational only, never a health gate */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                        {data.mode === "remote" ? "snapshot" : "log"}
                      </span>
                      {data.mode === "remote" ? (
                        <span
                          className={
                            fr.lifecycle_age_s !== null && fr.lifecycle_age_s > 7200
                              ? "font-semibold text-amber-400"
                              : "text-zinc-300"
                          }
                        >
                          {fr.lifecycle_age_s === null ? "—" : `${age(fr.lifecycle_age_s)} old`}
                        </span>
                      ) : (
                        <span
                          className={
                            fr.log_age_s !== null && fr.log_age_s > 900
                              ? "font-semibold text-amber-400"
                              : "text-zinc-300"
                          }
                        >
                          {fr.log_age_s === null
                            ? "—"
                            : fr.log_age_s <= 900
                              ? `fresh · ${age(fr.log_age_s)} old`
                              : `stale · ${age(fr.log_age_s)} old`}
                        </span>
                      )}
                      <span className="text-zinc-500">
                        {data.mode === "remote"
                          ? "· hourly lifecycle push — informational"
                          : "· runner stdout flushes on events — informational, not a health gate"}
                      </span>
                    </div>
                  </div>
                )}
                {/* TOWER SUPERVISORS — the tower's own background lanes that keep
                    the REMOTE planes alive (5-min paper-collector dispatch +
                    hourly paper-data lifecycle push). Sandbox-local surface:
                    their log/meta files are not pushed to the branch, so the
                    remote mode already tracks the same lanes end-to-end via the
                    branch & lifecycle ages above. Why it matters: a dead PAT
                    turns both lanes red HERE within minutes while every other
                    local card still looks green. */}
                <div className="mt-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5 font-mono text-[11px] tabular-nums">
                  <div className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    tower supervisors — background lanes
                  </div>
                  {data.mode === "remote" ? (
                    <div className="text-zinc-500">
                      {sup?.reason ??
                        "sandbox-only surface — remote mode tracks these lanes via branch & lifecycle ages above"}
                    </div>
                  ) : (
                    <>
                      {/* heartbeat / dispatch lane */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                          dispatch
                        </span>
                        {supH?.healthy === null || supH === null ? (
                          <span className="text-zinc-500">—</span>
                        ) : supH.healthy ? (
                          <span className="font-semibold text-emerald-400">LIVE</span>
                        ) : supH.last_result && /http 2\d\d/.test(supH.last_result) ? (
                          <span className="font-semibold text-amber-400">LATE</span>
                        ) : (
                          <span className="font-semibold text-rose-400">DOWN</span>
                        )}
                        <span className="text-zinc-500">
                          · {supH?.last_result ?? "no dispatch log"} · {age(supH?.last_activity_ago_s)} ago ·
                          every 5 min · {supH?.total ?? "—"} total
                        </span>
                      </div>
                      {/* lifecycle / hourly snapshot push lane */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                          lifecycle
                        </span>
                        {supS?.healthy === null || supS === null ? (
                          <span className="text-zinc-500">—</span>
                        ) : supS.healthy ? (
                          <span className="font-semibold text-emerald-400">LIVE</span>
                        ) : supS.last_result === "pushed" ? (
                          <span className="font-semibold text-amber-400">LATE</span>
                        ) : (
                          <span className="font-semibold text-rose-400">DOWN</span>
                        )}
                        <span className="text-zinc-500">
                          · {supS?.last_result ?? "no snapshot meta"} · {age(supS?.last_activity_ago_s)} ago ·
                          every 1 h{" "}
                          {supS?.ok !== null && supS?.total !== null && supS !== null
                            ? `· ${supS.ok}/${supS.total} ok${(supS.fails ?? 0) > 0 ? ` · ${supS.fails} fail` : ""}`
                            : ""}
                        </span>
                      </div>
                      {/* phase-2 daily discipline check lane */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="w-16 shrink-0 font-sans text-[10px] uppercase tracking-wider text-zinc-500">
                          phase-2
                        </span>
                        {supP?.healthy === null || supP === null ? (
                          <span className="text-zinc-500">—</span>
                        ) : supP.healthy ? (
                          <span className="font-semibold text-emerald-400">LIVE</span>
                        ) : (supP.last_result === "ok" || (supP.last_result ?? "").startsWith("seeded")) ? (
                          <span className="font-semibold text-amber-400">LATE</span>
                        ) : (
                          <span className="font-semibold text-rose-400">DOWN</span>
                        )}
                        <span className="text-zinc-500">
                          · {supP?.last_result ?? "no check meta"} · {age(supP?.last_activity_ago_s)} ago ·
                          every 24 h{" "}
                          {supP?.ok !== null && supP?.total !== null && supP !== null
                            ? `· ${supP.ok}/${supP.total} ok${(supP.fails ?? 0) > 0 ? ` · ${supP.fails} fail` : ""}`
                            : ""}
                        </span>
                      </div>
                      <div className="mt-1 font-sans text-[10px] text-zinc-600">
                        the lanes that keep the remote planes alive + the daily discipline check — failures surface here in minutes, not at the next artifact
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  gates in paper mode: depth ✓ recheck ✓ margin (live-only)
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Paper cycles table */}
              <Card title="paper cycles" icon={<Zap className="h-4 w-4" />}>
                <div className="max-h-80 overflow-auto custom-scroll">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr className="text-left">
                        <th className="py-1.5 pr-2 font-medium">time</th>
                        <th className="py-1.5 pr-2 font-medium text-right">rows</th>
                        <th className="py-1.5 pr-2 font-medium text-right">cand.</th>
                        <th className="py-1.5 pr-2 font-medium text-right">att.</th>
                        <th className="py-1.5 pr-2 font-medium text-right">rej.</th>
                        <th className="py-1.5 pr-2 font-medium text-right">open</th>
                        <th className="py-1.5 font-medium text-right">pos</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums text-zinc-300">
                      {(p?.cycles ?? []).map((c, i) => (
                        <tr key={i} className="border-t border-zinc-800/60">
                          <td className="py-1.5 pr-2 text-zinc-500">
                            {c.ts ? new Date(c.ts).toLocaleTimeString("sl-SI") : "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-right">{fmt(c.scan_total)}</td>
                          <td className="py-1.5 pr-2 text-right text-amber-400">{fmt(c.candidates)}</td>
                          <td className="py-1.5 pr-2 text-right">{fmt(c.opens)}</td>
                          <td className="py-1.5 pr-2 text-right text-rose-400">{fmt(c.open_aborted)}</td>
                          <td className="py-1.5 pr-2 text-right text-emerald-400">{fmt(c.open_simulated)}</td>
                          <td className="py-1.5 text-right">{fmt(c.open_positions)}</td>
                        </tr>
                      ))}
                      {(!p?.cycles || p.cycles.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-zinc-600">
                            no cycles recorded yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Pipeline + plan */}
              <div className="space-y-6">
                <Card title="delivery pipeline" icon={<ShieldCheck className="h-4 w-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Github className="h-3.5 w-3.5" /> {data.pipeline.github.repo}
                      </div>
                      <div className="text-zinc-500">branch <span className="text-zinc-300 font-mono">{data.repo.branch}</span>{data.repo.dirty && <span className="text-amber-400"> (dirty)</span>}</div>
                      {data.pipeline.github.pushed_at && (
                        <div className="text-zinc-500">pushed <span className="text-zinc-300">{timeAgo(data.pipeline.github.pushed_at)}</span> ago</div>
                      )}
                      <div className="mt-2 space-y-1">
                        {data.repo.commits.slice(0, 4).map((c) => (
                          <div key={c.sha} className="flex gap-2 items-baseline">
                            <span className="font-mono text-emerald-500/80">{c.sha}</span>
                            <span className="truncate text-zinc-500">{c.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Lock className="h-3.5 w-3.5" /> funding-arb CI — locked repo
                      </div>
                      {data.pipeline.funding_ci ? (
                        <>
                          <a
                            href={data.pipeline.funding_ci.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            {data.pipeline.funding_ci.repo} <ExternalLink className="h-3 w-3" />
                          </a>
                          {data.pipeline.funding_ci.latest ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                className={
                                  data.pipeline.funding_ci.latest.status === "completed" &&
                                  data.pipeline.funding_ci.latest.conclusion === "success"
                                    ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-400"
                                    : data.pipeline.funding_ci.latest.status === "completed"
                                      ? "rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-400"
                                      : "rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400"
                                }
                              >
                                {data.pipeline.funding_ci.latest.status === "completed"
                                  ? (data.pipeline.funding_ci.latest.conclusion ?? "unknown")
                                  : (data.pipeline.funding_ci.latest.status ?? "unknown")}
                              </span>
                              <span className="font-mono text-emerald-500/80">{data.pipeline.funding_ci.latest.sha}</span>
                              {data.pipeline.funding_ci.latest.completed_at && (
                                <span className="text-zinc-500">{timeAgo(data.pipeline.funding_ci.latest.completed_at)} ago</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-zinc-600">no CI runs on main yet</div>
                          )}
                          <div className="text-zinc-500">{data.pipeline.funding_ci.summary}</div>
                          <div className="text-zinc-600">on push/PR + nightly 03:07 UTC</div>
                        </>
                      ) : (
                        <div className="text-zinc-600">gate state unavailable</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <ShieldCheck className="h-3.5 w-3.5" /> tower CI — this repo
                      </div>
                      {data.pipeline.tower_ci ? (
                        <>
                          <a
                            href={data.pipeline.tower_ci.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            {data.pipeline.tower_ci.repo} <ExternalLink className="h-3 w-3" />
                          </a>
                          {data.pipeline.tower_ci.latest ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                className={
                                  data.pipeline.tower_ci.latest.status === "completed" &&
                                  data.pipeline.tower_ci.latest.conclusion === "success"
                                    ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-400"
                                    : data.pipeline.tower_ci.latest.status === "completed"
                                      ? "rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-400"
                                      : "rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400"
                                }
                              >
                                {data.pipeline.tower_ci.latest.status === "completed"
                                  ? (data.pipeline.tower_ci.latest.conclusion ?? "unknown")
                                  : (data.pipeline.tower_ci.latest.status ?? "unknown")}
                              </span>
                              <span className="font-mono text-emerald-500/80">{data.pipeline.tower_ci.latest.sha}</span>
                              {data.pipeline.tower_ci.latest.completed_at && (
                                <span className="text-zinc-500">{timeAgo(data.pipeline.tower_ci.latest.completed_at)} ago</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-zinc-600">no CI runs on main yet</div>
                          )}
                          <div className="text-zinc-500">{data.pipeline.tower_ci.summary}</div>
                          <div className="text-zinc-600">on every push/PR to main</div>
                        </>
                      ) : (
                        <div className="text-zinc-600">unavailable</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Layers className="h-3.5 w-3.5" /> phase3-lab
                      </div>
                      {data.pipeline.phase3 ? (
                        <>
                          <a
                            href={data.pipeline.phase3.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            {data.pipeline.phase3.repo} <ExternalLink className="h-3 w-3" />
                          </a>
                          {data.pipeline.phase3.latest && (
                            <div className="flex gap-2 items-baseline">
                              <span className="font-mono text-emerald-500/80">{data.pipeline.phase3.latest.sha}</span>
                              <span className="truncate text-zinc-500">{data.pipeline.phase3.latest.message}</span>
                            </div>
                          )}
                          <div className="text-zinc-500">{data.pipeline.phase3.tests}</div>
                          <div className="text-amber-400/90 leading-snug">{data.pipeline.phase3.status}</div>
                          <div className="text-zinc-600">{data.pipeline.phase3.summary}</div>
                        </>
                      ) : (
                        <div className="text-zinc-600">unavailable</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <FlaskConical className="h-3.5 w-3.5" /> engine CI — research repo
                      </div>
                      {data.pipeline.engine_ci ? (
                        <>
                          <a
                            href={data.pipeline.engine_ci.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            {data.pipeline.engine_ci.repo} <ExternalLink className="h-3 w-3" />
                          </a>
                          {data.pipeline.engine_ci.latest ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                className={
                                  data.pipeline.engine_ci.latest.status === "completed" &&
                                  data.pipeline.engine_ci.latest.conclusion === "success"
                                    ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-400"
                                    : data.pipeline.engine_ci.latest.status === "completed"
                                      ? "rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-400"
                                      : "rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400"
                                }
                              >
                                {data.pipeline.engine_ci.latest.status === "completed"
                                  ? (data.pipeline.engine_ci.latest.conclusion ?? "unknown")
                                  : (data.pipeline.engine_ci.latest.status ?? "unknown")}
                              </span>
                              <span className="font-mono text-emerald-500/80">{data.pipeline.engine_ci.latest.sha}</span>
                              {data.pipeline.engine_ci.latest.completed_at && (
                                <span className="text-zinc-500">{timeAgo(data.pipeline.engine_ci.latest.completed_at)} ago</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-zinc-600">no CI runs on main yet</div>
                          )}
                          <div className="text-zinc-500">{data.pipeline.engine_ci.summary}</div>
                          <div className="text-zinc-600">on every push/PR to main</div>
                        </>
                      ) : (
                        <div className="text-zinc-600">unavailable</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="text-zinc-400">Vercel</div>
                      <a
                        href={data.pipeline.vercel.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                      >
                        {data.pipeline.vercel.url.replace("https://", "")} <ExternalLink className="h-3 w-3" />
                      </a>
                      <div className="text-zinc-500 leading-snug">{data.pipeline.vercel.status}</div>
                      <div className="text-zinc-500 pt-1">snapshot source</div>
                      {snap ? (
                        <>
                          <div className="font-mono text-[10px] text-zinc-400 break-all">
                            {snap.source}
                          </div>
                          <div className="text-zinc-500">{snap.refreshed_by}</div>
                          <div className="text-zinc-600 pt-1">lifecycle: {snap.lifecycle}</div>
                        </>
                      ) : (
                        <div className="text-zinc-600">unavailable</div>
                      )}
                      {snap && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {snap.status === "stale" && (
                            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-400">
                              SNAPSHOT STALE
                            </span>
                          )}
                          <span
                            className={
                              snap.status === "fresh"
                                ? "text-emerald-400"
                                : snap.status === "stale"
                                  ? "text-rose-400"
                                  : "text-zinc-500"
                            }
                          >
                            snapshot {snap.status} · {age(snap.age_s)} old
                          </span>
                          <span className="text-zinc-600">(hourly expected, external cron)</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                <Card title="validation plan" icon={<CircleDot className="h-4 w-4" />}>
                  <ol className="space-y-2">
                    {data.plan.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        {s.state === "done" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        ) : s.state === "active" ? (
                          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-400" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                        )}
                        <span className={s.state === "done" ? "text-zinc-400" : s.state === "active" ? "text-zinc-200" : "text-zinc-600"}>
                          {s.step}
                        </span>
                        {s.state === "active" && (
                          <span className="ml-1 shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-400">
                            now
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>
            </div>

            {/* Paper positions */}
            {p?.positions && p.positions.length > 0 && (
              <Card title="paper positions ledger" icon={<Terminal className="h-4 w-4" />}>
                <div className="max-h-72 overflow-auto custom-scroll">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr className="text-left">
                        <th className="py-1.5 pr-2 font-medium">id</th>
                        <th className="py-1.5 pr-2 font-medium">base</th>
                        <th className="py-1.5 pr-2 font-medium">legs</th>
                        <th className="py-1.5 pr-2 font-medium">status</th>
                        <th className="py-1.5 pr-2 font-medium text-right">qty</th>
                        <th className="py-1.5 font-medium text-right">notional</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums text-zinc-300">
                      {p.positions
                        .slice()
                        .reverse()
                        .map((x: any) => (
                          <tr key={x.id} className="border-t border-zinc-800/60">
                            <td className="py-1.5 pr-2 text-zinc-500">{x.id?.slice(0, 24)}…</td>
                            <td className="py-1.5 pr-2">{x.base}</td>
                            <td className="py-1.5 pr-2">
                              <span className="text-emerald-400">L {x.long_venue}</span>
                              <ArrowRight className="mx-1 inline h-3 w-3 text-zinc-600" />
                              <span className="text-rose-400">S {x.short_venue}</span>
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={
                                  x.status === "open"
                                    ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-400"
                                    : "rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400"
                                }
                              >
                                {x.status}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-right">{x.qty}</td>
                            <td className="py-1.5 text-right">${fmt(x.trade_usd)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Exit classification — passive E-04 contamination split (read-only) */}
            {p?.exits && (
              <Card title="exit classification — strategy-attributable vs E-04" icon={<TrendingDown className="h-4 w-4" />}>
                <div className="space-y-4">
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Passive evidence classification over {p.exits.journal_span.cycles} real cycles —
                    every close sorted by cause. The runner and the measured system are untouched;
                    PnL mirrors the watcher's spread-PnL estimate (price-spread convergence ± fees —
                    realized funding cashflow is NOT observed in paper mode). Reporting contract: the
                    strategy-attributable result is primary; raw and E-04 contamination are always
                    shown alongside — never a single blended PnL.
                  </p>

                  {/* PRIMARY — strategy-attributable (final-report view) */}
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                        strategy-attributable · paper spread pnl
                      </span>
                      <span className="rounded-full border border-zinc-600 bg-zinc-800 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                        primary
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span
                        className={`font-mono text-2xl tabular-nums ${
                          (p.exits.diagnostic_baseline.total_pnl_pct ?? 0) < 0
                            ? "text-rose-400"
                            : (p.exits.diagnostic_baseline.total_pnl_pct ?? 0) > 0
                              ? "text-emerald-400"
                              : "text-zinc-100"
                        }`}
                      >
                        {pct(p.exits.diagnostic_baseline.total_pnl_pct, 2)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                        {p.exits.diagnostic_baseline.closes} closes · avg {pct(p.exits.diagnostic_baseline.avg_pnl_pct)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                      genuine strategy exits — E-04 data-gap closes held apart ·
                      realized funding cashflow not observed in paper mode (NEW-08/NEW-15)
                    </div>
                  </div>

                  {/* SECONDARY — raw + E-04 contamination decomposition */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        raw baseline
                      </div>
                      <div className="mt-1 font-mono text-lg tabular-nums text-zinc-100">
                        {p.exits.raw_baseline.closes} closes
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                        avg {pct(p.exits.raw_baseline.avg_pnl_pct)} · total {pct(p.exits.raw_baseline.total_pnl_pct)}
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-600">what the system actually did (both groups mixed)</div>
                    </div>
                    <div
                      className={`rounded-lg border p-3 ${
                        p.exits.e04_contamination.closes > 0
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-zinc-800 bg-zinc-900/40"
                      }`}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        E-04 contamination
                      </div>
                      <div className="mt-1 font-mono text-lg tabular-nums text-zinc-100">
                        {p.exits.e04_contamination.closes} closes
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                        avg {pct(p.exits.e04_contamination.avg_pnl_pct)} · total {pct(p.exits.e04_contamination.total_pnl_pct)}
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-600">exits taken on a missing scanner row (edge=-999)</div>
                    </div>
                  </div>

                  {/* Arithmetic identity — the split must decompose the raw number */}
                  <div
                    className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 font-mono text-[11px] tabular-nums ${
                      p.exits.attribution_check.consistent === false
                        ? "border-red-500/40 bg-red-500/5 text-red-300"
                        : "border-zinc-800/70 bg-zinc-900/40 text-zinc-400"
                    }`}
                  >
                    <span className="text-[10px] font-sans font-semibold uppercase tracking-widest text-zinc-500">
                      attribution check
                    </span>
                    {p.exits.attribution_check.consistent === null ? (
                      <span className="text-zinc-500">insufficient PnL data</span>
                    ) : (
                      <>
                        <span className={(p.exits.attribution_check.attributable_total_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}>
                          {pct(p.exits.attribution_check.attributable_total_pct)}
                        </span>
                        <span className="text-zinc-600">+</span>
                        <span className={(p.exits.attribution_check.contamination_total_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}>
                          {pct(p.exits.attribution_check.contamination_total_pct)}
                        </span>
                        <span className="text-zinc-600">=</span>
                        <span className={(p.exits.attribution_check.raw_total_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}>
                          {pct(p.exits.attribution_check.raw_total_pct)}
                        </span>
                        <span
                          className={`font-sans text-[10px] font-semibold ${
                            p.exits.attribution_check.consistent ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {p.exits.attribution_check.consistent ? "✓ split decomposes raw exactly" : "✗ split does not sum to raw"}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Survival — how many opened positions reach a normal close */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-400">
                    <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      survival
                    </span>
                    {p.exits.survival.opened === null ? (
                      <span className="text-zinc-500">positions ledger unavailable</span>
                    ) : (
                      <>
                        <span className="text-zinc-200">{p.exits.survival.opened} opened</span>
                        <span className="text-zinc-600">→</span>
                        <span>
                          {p.exits.survival.closed_normal + p.exits.survival.closed_data_gap} closed
                        </span>
                        <span className="text-zinc-500">
                          ({p.exits.survival.closed_normal} genuine · {p.exits.survival.closed_data_gap} data-gap)
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-200">{p.exits.survival.still_open ?? "—"} still open</span>
                      </>
                    )}
                  </div>

                  {/* R8 sign-convention audit (NEW-20) — instrument vs signed mark-to-market */}
                  {p.exits.signed_check && p.exits.signed_check.closes > 0 && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
                          R8 sign-convention audit · NEW-20
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-zinc-400">
                          {p.exits.signed_check.mis_signed}/{p.exits.signed_check.closes} closes mis-signed ·{" "}
                          {p.exits.signed_check.crossed} spread crossings
                        </span>
                      </div>
                      <div className="mt-1.5 overflow-x-auto">
                        <table className="w-full min-w-[420px] text-[11px]">
                          <thead>
                            <tr className="text-left text-zinc-500">
                              <th className="pr-3 font-medium">reading</th>
                              <th className="pr-3 text-right font-medium">attributable</th>
                              <th className="pr-3 text-right font-medium">E-04 group</th>
                              <th className="text-right font-medium">raw</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono tabular-nums">
                            <tr className="border-t border-zinc-800/60">
                              <td className="py-1 pr-3 text-zinc-400">instrument (watcher formula — abs + direction sign)</td>
                              <td className={`py-1 pr-3 text-right ${(p.exits.signed_check.instrument.attributable_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.instrument.attributable_pct, 3)}
                              </td>
                              <td className={`py-1 pr-3 text-right ${(p.exits.signed_check.instrument.contamination_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.instrument.contamination_pct, 3)}
                              </td>
                              <td className={`py-1 text-right ${(p.exits.signed_check.instrument.raw_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.instrument.raw_pct, 3)}
                              </td>
                            </tr>
                            <tr className="border-t border-zinc-800/60">
                              <td className="py-1 pr-3 text-amber-300">
                                signed (mark-to-market — corrected){" "}
                                {p.exits.signed_check.identity_signed ? "✓" : ""}
                              </td>
                              <td className={`py-1 pr-3 text-right ${(p.exits.signed_check.signed.attributable_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.signed.attributable_pct, 3)}
                              </td>
                              <td className={`py-1 pr-3 text-right ${(p.exits.signed_check.signed.contamination_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.signed.contamination_pct, 3)}
                              </td>
                              <td className={`py-1 text-right ${(p.exits.signed_check.signed.raw_pct ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {pct(p.exits.signed_check.signed.raw_pct, 3)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                        The instrument computes sign × (|open spread| − |close spread|) × qty, but the mechanical PnL of the
                        fixed legs is (S<sub>open</sub> − S<sub>close</sub>) × qty with S = short venue price − long venue price, signed — they agree
                        only when the direction label matches the price relationship and the spread never crosses zero. On
                        this sample 5/12 closes violate (KR200, CL are pure sign inversions — hand-verified leg
                        arithmetic); the final A/B/C report carries the signed reading as the corrected spread-PnL view,
                        and the “E-04 contamination is PnL-directional” observation is largely a sign-convention artifact
                        (signed: both groups negative, raw not near zero).
                      </p>
                    </div>
                  )}

                  <ul className="space-y-1.5">
                    {p.exits.categories.map((c) => (
                      <li
                        key={c.category}
                        className={`min-w-0 rounded-lg border p-2.5 ${
                          c.category === "data_gap" && c.count > 0
                            ? "border-red-500/30 bg-red-500/5"
                            : "border-zinc-800/70 bg-zinc-900/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${exitCategoryDot[c.category] ?? "bg-zinc-500"}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={exitCategoryLabel[c.category] ?? c.category}>
                            {exitCategoryLabel[c.category] ?? c.category}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
                            n={c.count} · {(c.share * 100).toFixed(0)}%
                          </span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">
                            held {(c.avg_held_h ?? 0).toFixed(1)}h
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[11px] tabular-nums ${
                              (c.total_pnl_pct ?? 0) < 0 ? "text-rose-400" : (c.total_pnl_pct ?? 0) > 0 ? "text-emerald-400" : "text-zinc-500"
                            }`}
                          >
                            avg {pct(c.avg_pnl_pct)} · tot {pct(c.total_pnl_pct)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
                          <div
                            className={`h-full ${exitCategoryDot[c.category] ?? "bg-zinc-500"}`}
                            style={{ width: `${Math.max(c.share > 0 ? 2 : 0, c.share * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="max-h-60 overflow-y-auto custom-scroll">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                        <tr className="text-left">
                          <th className="py-1.5 pr-2 font-medium">closed</th>
                          <th className="py-1.5 pr-2 font-medium">base</th>
                          <th className="py-1.5 pr-2 font-medium">cause</th>
                          <th className="py-1.5 pr-2 font-medium text-right">edge</th>
                          <th className="py-1.5 pr-2 font-medium text-right">held</th>
                          <th className="py-1.5 pr-2 font-medium text-right">spread pnl</th>
                          <th className="py-1.5 font-medium text-right">signed</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums text-zinc-300">
                        {p.exits.per_exit.map((e) => (
                          <tr key={e.position_id} className="border-t border-zinc-800/60">
                            <td className="py-1.5 pr-2 text-zinc-500" title={e.position_id}>
                              {e.closed_at ? new Date(e.closed_at).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </td>
                            <td className="py-1.5 pr-2">{e.base || "—"}</td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={`rounded-full border px-1.5 py-px text-[10px] ${exitCategoryBadge[e.category] ?? exitCategoryBadge.other}`}
                                title={exitCategoryLabel[e.category] ?? e.category}
                              >
                                {e.category === "data_gap" ? "data-gap" : e.category}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-right text-zinc-400">
                              {e.edge_pct === null ? "—" : e.edge_pct === -999 ? "gap" : pct(e.edge_pct, 3)}
                            </td>
                            <td className="py-1.5 pr-2 text-right text-zinc-400">
                              {e.held_h === null ? "—" : `${e.held_h.toFixed(1)}h`}
                            </td>
                            <td
                              className={`py-1.5 pr-2 text-right ${(e.pnl_pct ?? 0) < 0 ? "text-rose-400" : (e.pnl_pct ?? 0) > 0 ? "text-emerald-400" : "text-zinc-500"}`}
                            >
                              {e.pnl_pct === null ? "—" : pct(e.pnl_pct, 3)}
                            </td>
                            <td
                              className={`py-1.5 text-right ${
                                e.mis_signed
                                  ? "font-semibold text-amber-400"
                                  : (e.pnl_signed_pct ?? 0) < 0
                                    ? "text-rose-400"
                                    : (e.pnl_signed_pct ?? 0) > 0
                                      ? "text-emerald-400"
                                      : "text-zinc-500"
                              }`}
                              title={
                                e.mis_signed
                                  ? "NEW-20: instrument reading differs from the signed mark-to-market (amber = mis-signed)"
                                  : "signed mark-to-market (R8) — agrees with the instrument"
                              }
                            >
                              {e.pnl_signed_pct === null ? "—" : pct(e.pnl_signed_pct, 3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="border-t border-zinc-800/60 pt-3 text-[11px] leading-relaxed text-zinc-500">
                    Naming rule (NEW-15): the primary number is strategy-attributable paper SPREAD PnL —
                    never funding-arbitrage profitability; realized funding cashflow is not observed in
                    paper mode, and the excluded funding component is material (NEW-08). E-04 (runner closes
                    on a missing scanner row) is measurably firing in this baseline and is PnL-directional
                    under the instrument reading — the R8 signed reading (NEW-20) shows both groups negative,
                    so the directionality is largely a sign-convention artifact and the final report carries
                    the signed view as the corrected spread-PnL basis. E-04 stays deliberately unfixed
                    during Phase-2 (fixing mid-sample would mix baselines); watcher-driven categories
                    (stop-loss, funding) stay in the taxonomy and count 0 while the watcher is not part
                    of the paper loop. Small sample = diagnostic signal, not a statistical verdict.
                  </p>
                </div>
              </Card>
            )}

            {/* R7 economic invariants — per-close mathematical decomposition (diagnostic) */}
            {p?.economics && p.economics.closes > 0 && (
              <Card title="economic decomposition — R7 invariant test" icon={<Calculator className="h-4 w-4" />}>
                <div className="space-y-4">
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Per-close decomposition over {p.economics.closes} closes — every component recomputed from the ACTUAL
                    per-leg notionals (NEW-17) and entry-snapshot funding rates (per-leg rate × notional × held/interval).
                    <span className="text-amber-400"> Diagnostic only — NOT a Phase-2 PnL instrument</span> (the verdict
                    stays on paper spread PnL; realized funding cashflow is not observed in paper mode — NEW-08/NEW-15).
                  </p>

                  {/* PRIMARY — the decomposition identity on the attributable group */}
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                        attributable · economic estimate = spread + funding − fees
                      </span>
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                        diagnostic · not a pnl instrument
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span
                        className={`font-mono text-2xl tabular-nums ${
                          (p.economics.attributable.economic_total_pct ?? 0) < 0
                            ? "text-rose-400"
                            : (p.economics.attributable.economic_total_pct ?? 0) > 0
                              ? "text-emerald-400"
                              : "text-zinc-100"
                        }`}
                      >
                        {pct(p.economics.attributable.economic_total_pct, 2)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                        {p.economics.attributable.rows} closes · ${fmt(p.economics.attributable.economic_usd ?? undefined)} ·{" "}
                        {pct(p.economics.attributable.economic_of_capital_pct, 3)} of capital
                      </span>
                    </div>
                    <div className="mt-2 font-mono text-[11px] tabular-nums leading-relaxed text-zinc-300">
                      <span className="text-rose-400">{pct(p.economics.attributable.spread_total_pct, 3)}</span> spread
                      <span className="mx-1 text-zinc-600">+</span>
                      <span className="text-emerald-400">{pct(p.economics.attributable.net_funding_total_pct, 3)}</span> est. funding
                      <span className="mx-1 text-zinc-600">−</span>
                      <span className="text-amber-400">{pct(p.economics.attributable.fee_total_pct, 3)}</span> fees
                      <span className="mx-1 text-zinc-600">=</span>
                      {pct(p.economics.attributable.economic_total_pct, 3)}
                      {p.economics.identity_check && (
                        <span
                          className={`ml-2 ${p.economics.identity_check.consistent ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {p.economics.identity_check.consistent ? "✓ identity holds" : "✗ identity broken"}
                        </span>
                      )}
                    </div>
                    {p.economics.attributable.spread_signed_total_pct !== null &&
                      p.economics.attributable.economic_signed_total_pct !== null && (
                        <div className="mt-1 font-mono text-[11px] tabular-nums leading-relaxed text-zinc-400">
                          <span className="text-zinc-600">signed variant (NEW-20):</span>{" "}
                          <span
                            className={
                              p.economics.attributable.spread_signed_total_pct < 0 ? "text-rose-400" : "text-emerald-400"
                            }
                          >
                            {pct(p.economics.attributable.spread_signed_total_pct, 3)}
                          </span>{" "}
                          spread +{" "}
                          <span className="text-emerald-400">
                            {pct(p.economics.attributable.net_funding_total_pct, 3)}
                          </span>{" "}
                          funding −{" "}
                          <span className="text-amber-400">
                            {pct(p.economics.attributable.fee_total_pct, 3)}
                          </span>{" "}
                          fees ={" "}
                          <span
                            className={
                              p.economics.attributable.economic_signed_total_pct < 0
                                ? "text-rose-400"
                                : "text-emerald-400"
                            }
                          >
                            {pct(p.economics.attributable.economic_signed_total_pct, 3)}
                          </span>{" "}
                          <span className="text-zinc-600">— corrected mark-to-market spread; funding/fees sign-correct per leg</span>
                        </div>
                      )}
                    <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                      Σ per-close pct of trade_usd — the same unit as the primary spread-PnL number above. Prices are
                      futures ticker/last throughout (NEW-16: the code's “mark price” is the ticker price); funding rates
                      are entry-snapshot only (no rate history exists per position).
                    </div>
                  </div>

                  {/* Funding materiality re-measured + A–H completeness */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        funding component · per-leg re-measure
                      </div>
                      <div className="mt-1 font-mono text-lg tabular-nums text-emerald-400">
                        +{p.economics.attributable.net_funding_total_pct?.toFixed(3)}%
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                        ${fmt(p.economics.attributable.net_funding_usd ?? undefined)} est. · excluded from paper PnL (NEW-08)
                      </div>
                      <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                        vs R6 two-point estimate {pct(p.economics.attributable.r6_lower_pct, 3)}…
                        {pct(p.economics.attributable.r6_upper_pct, 3)} — the per-leg computation lands on the UPPER bound
                        (all sampled pairs settle on the same 8 h interval and per-leg notionals ≈ trade_usd, so the
                        rigorous formula reduces to the constant-rate bound here). Magnitude CONFIRMED; it is 3.8× the
                        measured spread PnL and opposite in sign. Fees (~1.57%) consume nearly all of it.
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        A–H invariant join
                      </div>
                      <div className="mt-1 font-mono text-lg tabular-nums text-zinc-100">
                        {p.economics.completeness.complete}/{p.economics.closes} complete
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                        requested · per-leg notional · price source · rate source · interval · next-settle · funding est.
                      </div>
                      <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                        D: futures ticker/last (NEW-16) · E: entry snapshot only · F/G: per-leg interval + settlements
                        inside the hold · NEW-18: trade_usd stays the REQUESTED value (actual legs recomputed here).
                        Data-gap group estimated separately: {p.economics.data_gap.rows} closes · est. funding $
                        {fmt(p.economics.data_gap.net_funding_usd ?? undefined)}.
                      </div>
                    </div>
                  </div>

                  {/* Per-close decomposition table */}
                  <div className="max-h-72 overflow-y-auto custom-scroll">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                        <tr className="text-left">
                          <th className="py-1.5 pr-2 font-medium">closed</th>
                          <th className="py-1.5 pr-2 font-medium">base</th>
                          <th className="py-1.5 pr-2 font-medium text-right">held</th>
                          <th className="py-1.5 pr-2 font-medium text-right">notional l/s $</th>
                          <th className="py-1.5 pr-2 font-medium text-right">net fund $</th>
                          <th className="py-1.5 pr-2 font-medium text-right">fees $</th>
                          <th className="py-1.5 pr-2 font-medium text-right">spread $</th>
                          <th className="py-1.5 font-medium text-right">est $</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums text-zinc-300">
                        {p.economics.per_close.map((r) => {
                          const tip = [
                            `${r.position_id}`,
                            `D: futures ticker/last · E: entry snapshot`,
                            `intervals ${r.long_interval_h ?? "—"}h / ${r.short_interval_h ?? "—"}h · settlements ${r.long_settlements ?? "—"}/${r.short_settlements ?? "—"} in hold`,
                            `funding legs $${r.long_leg_funding_usd ?? "—"} (long) / $${r.short_leg_funding_usd ?? "—"} (short)`,
                            `settlement-count variant $${r.net_funding_sc_usd ?? "—"} net · est $${r.economic_sc_usd ?? "—"}`,
                            `R6 bounds ${r.r6_lower_pct ?? "—"}…${r.r6_upper_pct ?? "—"}% · per-leg ${r.new_estimate_pct ?? "—"}%`,
                          ].join("\n");
                          return (
                            <tr key={r.position_id} className="border-t border-zinc-800/60" title={tip}>
                              <td className="py-1.5 pr-2 text-zinc-500">
                                {r.closed_at ? new Date(r.closed_at).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                              </td>
                              <td className="py-1.5 pr-2">
                                {r.is_data_gap && (
                                  <span
                                    className="mr-1 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[10px] text-red-400"
                                    title="E-04 data-gap close"
                                  >
                                    gap
                                  </span>
                                )}
                                {r.base || "—"}
                              </td>
                              <td className="py-1.5 pr-2 text-right text-zinc-400">
                                {r.held_h === null ? "—" : `${r.held_h.toFixed(1)}h`}
                              </td>
                              <td className="py-1.5 pr-2 text-right text-zinc-400">
                                {r.long_notional_usd === null || r.short_notional_usd === null
                                  ? "—"
                                  : `${r.long_notional_usd.toFixed(0)} / ${r.short_notional_usd.toFixed(0)}`}
                              </td>
                              <td className={`py-1.5 pr-2 text-right ${(r.net_funding_usd ?? 0) > 0 ? "text-emerald-400" : (r.net_funding_usd ?? 0) < 0 ? "text-rose-400" : "text-zinc-500"}`}>
                                {r.net_funding_usd === null ? "—" : r.net_funding_usd.toFixed(2)}
                              </td>
                              <td className="py-1.5 pr-2 text-right text-amber-400/80">
                                {r.fee_usd === null ? "—" : r.fee_usd.toFixed(2)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right ${(r.spread_pnl_usd ?? 0) < 0 ? "text-rose-400" : (r.spread_pnl_usd ?? 0) > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                                {r.spread_pnl_usd === null ? "—" : r.spread_pnl_usd.toFixed(2)}
                              </td>
                              <td className={`py-1.5 text-right ${r.components_complete ? "text-zinc-200" : "text-zinc-500"}`}>
                                {r.economic_usd === null ? "—" : `${r.economic_usd.toFixed(2)}${r.components_complete ? " ✓" : ""}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="border-t border-zinc-800/60 pt-3 text-[11px] leading-relaxed text-zinc-500">
                    Mathematical invariant test (review round 7): for every close the eight dimensions A–H are joined and the
                    identity <span className="font-mono">estimate = spread + funding legs − fees</span> is built to hold on the
                    displayed numbers. Funding is accrued linearly (held_h / interval_h × entry rate); the settlement-count
                    variant (0 until a settlement lands inside the hold — see row tooltip) is the stricter lower bound.
                    The R6 two-point materiality estimate was of the RIGHT magnitude — the rigorous per-leg computation
                    confirms its upper bound. This panel will never be used as a Phase-2 PnL instrument: it exists to prove
                    the decomposition is reproducibly computable — execution measurement (spread PnL) and funding economics
                    (estimated, not realized) remain separate reported components. The measured system stays untouched at
                    0373f5d.
                  </p>
                </div>
              </Card>
            )}

            {/* Runner log tail */}
            <Card title="runner log (tail)" icon={<Terminal className="h-4 w-4" />}>
              <pre className="max-h-48 overflow-y-auto custom-scroll rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap">
                {(p?.runner?.log_tail ?? []).join("\n") || "waiting for output…"}
              </pre>
            </Card>

            <p className="text-[11px] text-zinc-600 text-center">
              data refreshes every 10 s · statuses {new Date(data.now).toLocaleTimeString("sl-SI")} ·{" "}
              {data.mode === "local"
                ? "sandbox session — the paper runner keeps cycling while the box is up"
                : "deployed mode — live collector cycles (~5 min) + hourly lifecycle snapshots from the paper-data branch"}
            </p>
          </>
        )}

        {/* quant-arb-engine — the parallel research engine, monitored read-only */}
        {view === "engine" && <EngineView />}

        {view === "monitor" && (<>
        {/* Audit findings register — static data, independent of the status API */}
        <Card title="Audit findings" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-zinc-300">
                funding-arb @ <span className="font-mono">{auditMeta.commit}</span> · read-only audit · repo
                locked (Phase-2 A/B/C)
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                {auditMeta.method} · {auditMeta.reference} · register:{" "}
                <span className="font-mono">{auditMeta.register}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {severityCounts.map(({ severity, count }) => (
                <span
                  key={severity}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${severityBadge[severity]}`}
                  title={`${severity} · ${count} finding${count === 1 ? "" : "s"}`}
                >
                  {severity}
                  <span className="tabular-nums">{count}</span>
                </span>
              ))}
              <span className="text-[11px] text-zinc-500">
                {auditFindings.length} findings ·{" "}
                {auditFindings.filter((f) => f.status === "deferred").length} deferred ·{" "}
                {[...new Set(auditFindings.map((f) => f.round))].sort().map((r) => `R${r}`).join(" / ")}
              </span>
            </div>

            <ul className="custom-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1" aria-label="audit findings register">
              {sortedAuditFindings.map((f) => (
                <li
                  key={f.id}
                  className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] font-semibold ${severityBadge[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-500">{f.id}</span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-zinc-100">{f.title}</span>
                    <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/80 px-1.5 py-px text-[10px] font-medium text-zinc-400">
                      R{f.round}
                    </span>
                    {f.status === "confirmed" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> confirmed
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" /> deferred
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={f.area}>
                    {f.area}
                  </div>
                  <p
                    className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                    title={`${f.detail}\n\nevidence: ${f.evidence}`}
                  >
                    {f.detail}
                  </p>
                </li>
              ))}
            </ul>

            <p className="border-t border-zinc-800/60 pt-3 text-[11px] leading-relaxed text-zinc-500">
              Repo locked during Phase-2 A/B/C — findings recorded only; zero changes to the measured
              system. Remediation happens in the post-Phase-2 hardening pass.
            </p>
          </div>
        </Card>

        {/* Failure matrix (R4) — state-by-state safe-transition proof, static data */}
        <Card title="Failure matrix" icon={<Grid3x3 className="h-4 w-4" />}>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-zinc-300">
                R4 · state-by-state walkthrough · <span className="font-mono">{matrixMeta.commit}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Goal: {matrixMeta.goal}. Every cell traced to actual code at the locked commit —
                evidence in <span className="font-mono">{matrixMeta.register}</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {matrixVerdictCounts.map(({ verdict, count }) => (
                <span
                  key={verdict}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${matrixVerdictBadge[verdict]}`}
                  title={matrixVerdictLabel[verdict]}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${verdictDot[verdict]}`} aria-hidden="true" />
                  {verdict}
                  <span className="tabular-nums">{count}</span>
                </span>
              ))}
              <span className="text-[11px] text-zinc-500">
                {matrixCells.length} ambiguity cells · {matrixGroups.length} groups
              </span>
            </div>

            <div className="custom-scroll max-h-96 space-y-4 overflow-y-auto pr-1" aria-label="failure matrix">
              {matrixGroups.map((group) => {
                const cells = matrixCells
                  .filter((c) => c.group === group)
                  .sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict] || a.id.localeCompare(b.id));
                return (
                  <div key={group}>
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      {matrixGroupLabels[group]}
                      <span className="ml-2 font-mono normal-case tracking-normal text-zinc-600">
                        {cells.filter((c) => c.verdict === "safe").length}/{cells.length} safe
                      </span>
                    </h3>
                    <ul className="space-y-1.5">
                      {cells.map((cell) => (
                        <li
                          key={cell.id}
                          className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                            <span className="shrink-0 font-mono text-[11px] text-zinc-500">{cell.id}</span>
                            <span className="min-w-0 flex-1 text-sm font-medium text-zinc-100">{cell.state}</span>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] font-semibold ${matrixVerdictBadge[cell.verdict]}`}
                              title={matrixVerdictLabel[cell.verdict]}
                            >
                              {cell.verdict === "safe" ? "1 safe" : cell.verdict}
                            </span>
                          </div>
                          <p
                            className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                            title={`${cell.transition}\n\nevidence: ${cell.evidence}\nrefs: ${cell.refs.join(" ") || "—"}\nverdict: ${matrixVerdictLabel[cell.verdict]}`}
                          >
                            {cell.transition}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {cell.refs.length > 0 ? (
                              cell.refs.map((ref) => (
                                <span
                                  key={ref}
                                  className="rounded-full border border-zinc-700 bg-zinc-800/80 px-1.5 py-px font-mono text-[10px] text-zinc-400"
                                  title={`see register finding ${ref}`}
                                >
                                  {ref}
                                </span>
                              ))
                            ) : (
                              <span className="font-mono text-[10px] text-zinc-600">no finding — passes</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-zinc-800/60 pt-3">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Cross-cutting root causes
              </h3>
              <ul className="space-y-1.5">
                {matrixRootCauses.map((rc) => (
                  <li
                    key={rc.id}
                    className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] font-semibold ${severityBadge[rc.severity as FindingSeverity]}`}
                      >
                        {rc.severity}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-500">{rc.id}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium text-zinc-100">{rc.title}</span>
                    </div>
                    <p
                      className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                      title={`${rc.detail}\n\nblocks: ${rc.blocks}`}
                    >
                      {rc.detail}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-zinc-600" title={`blocks: ${rc.blocks}`}>
                      blocks: {rc.blocks}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <p className="border-t border-zinc-800/60 pt-3 text-[11px] leading-relaxed text-zinc-500">
              The 5 passing cells are exactly the dangerous-position routing (leg-gone, emergency unwind,
              external-reduction detection): execution routing is sound. The 16 failures cluster on the
              ambiguity plane — unknown submit outcomes, recovery, repeated failure — all mapped to five
              structural root causes above.
            </p>
          </div>
        </Card>
        </>)}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
          <span>funding-arb measures (locked @ 0373f5d) · quant-arb-engine explores (synthetic · paper only) · tower observes read-only</span>
          <span className="font-mono">educational / research — not financial advice</span>
        </div>
      </footer>
    </div>
  );
}
