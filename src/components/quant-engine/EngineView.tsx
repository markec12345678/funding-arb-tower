"use client";

/**
 * quant-arb-engine monitor v0.3 — the tower's READ-ONLY window into the
 * parallel research engine (repo #4, paper/research only).
 *
 * v0.3: two carry families (forward_basis_v1 = lock, perp_carry_v1 = float)
 * evaluated EVERY quote day and ranked by net executable edge; world v2 ramps
 * carry up AND collapses it; σ_level and σ_H are journaled apart with their
 * two different meanings; predictions P1/P2/P3 are scored as measured.
 *
 * Everything on this view is SYNTHETIC: the engine runs on a deterministic
 * mock RFQ world (seeded), so every number below is a machinery diagnostic,
 * never market evidence. The epistemic note travels with the data and is
 * rendered verbatim at the bottom of the view.
 *
 * Data plane: /api/engine/overview → local sandbox checkout (fresh) or
 * GitHub raw fallback (Vercel). The tower never writes to the engine.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Github,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Dist,
  EngineOverview,
  FamilyCensusEntry,
  SettledRow,
} from "@/lib/engine-types";

/* ---- formatting (financial convention: en-US, signed, mono) ---- */

const num = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const sgn = (n: number | null | undefined, d = 2, suffix = "") =>
  n === null || n === undefined
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(d)}${suffix}`;

const usd = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined
    ? "—"
    : `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })}`;

const bps = (n: number | null | undefined, d = 1) => sgn(n, d, " bps");

const aprPct = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(d)}%`;

const pct = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined ? "—" : `${n.toFixed(d)}%`;

const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/* ---- family identity helpers ---- */

const FORWARD = "forward_basis_v1";
const PERP = "perp_carry_v1";

const familyLabel = (sid: string) => (sid === FORWARD ? "forward" : sid === PERP ? "perp" : sid);

const FAMILY_COLOR = { [FORWARD]: "#2dd4bf", [PERP]: "#fb923c" } as Record<string, string>;

/* ---- small building blocks (tower style) ---- */

function Card({
  title,
  icon,
  right,
  children,
  className = "",
}: {
  title?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur p-4 sm:p-5 ${className}`}
    >
      {title && (
        <header className="mb-3 flex flex-wrap items-center gap-2 text-zinc-400">
          {icon}
          <h2 className="text-xs font-semibold uppercase tracking-widest">{title}</h2>
          {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
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

function Chip({
  children,
  tone = "default",
  title,
}: {
  children: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  title?: string;
}) {
  const cls =
    tone === "good"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : tone === "bad"
          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-zinc-700 bg-zinc-800/60 text-zinc-300";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function FlowChip({ label, sub }: { label: string; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-[11px] text-zinc-200">
      {label}
      {sub && <span className="font-mono tabular-nums text-zinc-500">{sub}</span>}
    </span>
  );
}

function BarRow({
  label,
  value,
  max,
  text,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
  tone: string;
}) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-40 shrink-0 truncate text-zinc-400" title={label}>
        {label}
      </div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <div className="w-28 shrink-0 text-right font-mono tabular-nums text-zinc-200">{text}</div>
    </div>
  );
}

function DistRow({
  name,
  dist,
  fmtValue,
  note,
  tone,
}: {
  name: string;
  dist: Dist;
  fmtValue: (n: number) => string;
  note: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>
          {dist.mean === null ? "—" : fmtValue(dist.mean)}
        </span>
        <span className="text-sm text-zinc-200">{name}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">
          p5 {dist.p5 === null ? "—" : fmtValue(dist.p5)} · p50{" "}
          {dist.p50 === null ? "—" : fmtValue(dist.p50)} · p95 {dist.p95 === null ? "—" : fmtValue(dist.p95)}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500">{note}</p>
    </div>
  );
}

const EMPTY_DIST: Dist = { mean: null, std: null, p5: null, p50: null, p95: null, min: null, max: null };

/* ---- NO-GO list (binding, travels with the engine) ---- */

const NO_GO = [
  "live trading",
  "NODE auto-trading",
  "real capital",
  "FIX production",
  "ML money decisions",
  "portfolio allocator",
];

/* ---- verdict tone helper (honest findings are amber, not red) ---- */

function verdictTone(verdict: string): "good" | "warn" | "default" {
  if (/SUPPORTED/i.test(verdict)) return "good";
  if (/REFUTED|REJECTED|NOT SUPPORTED/i.test(verdict)) return "warn";
  return "default";
}

/* ====================================================================== */

export default function EngineView() {
  const [data, setData] = useState<EngineOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/engine/overview", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as EngineOverview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const sweep = data?.sweep ?? null;
  const run = data?.latest_run ?? null;
  const opp = run?.opportunity_example ?? null;
  const wf = opp?.metadata.waterfall ?? null;

  const totalRealized = sweep?.per_seed?.reduce((a, s) => a + (s.realized_usd ?? 0), 0) ?? null;
  const rejectMax = Math.max(1, ...(sweep?.reject_reasons?.map((r) => r.count) ?? [1]));

  const ranking = sweep?.ranking ?? null;
  const predictions = sweep?.predictions ?? null;
  const fwdCensus: FamilyCensusEntry | undefined = sweep?.family_census?.[FORWARD];
  const perpCensus: FamilyCensusEntry | undefined = sweep?.family_census?.[PERP];
  const lockDist = fwdCensus?.settled_stats.realized_minus_locked_bps
    ?? sweep?.settled_stats.realized_minus_locked_bps
    ?? EMPTY_DIST;
  const accDist = perpCensus?.settled_stats.realized_minus_expected_bps ?? EMPTY_DIST;

  const carryCurve = run?.carry_curve ?? [];
  const edgeSeries = run?.family_edge_series ?? [];
  const contestedShare = sweep?.contested_share_of_selected_days_pct ?? null;

  const isPerpOpp = opp?.strategy_id === PERP;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- identity */}
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/10">
            <FlaskConical className="h-5 w-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              quant-arb-engine{" "}
              <span className="text-zinc-500">
                · research engine {data?.repo.version ? `v${data.repo.version}` : ""}
              </span>
            </h1>
            <p className="text-xs text-zinc-500">
              Two carry families — lock (forward) vs float (perp) — ranked every quote day on a
              deterministic synthetic world
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="good" title="paper/research only — binding NO-GO list below">
            <ShieldCheck className="h-3.5 w-3.5" /> paper only
          </Chip>
          <Chip tone="warn" title="every number on this view comes from the seeded mock RFQ world">
            all data synthetic
          </Chip>
          {data && (
            <Chip
              title={`${data.source.detail}${data.repo.commit ? ` · ${data.repo.commit}` : ""}${
                data.repo.dirty ? " · uncommitted changes" : ""
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              {data.mode === "local" ? "sandbox live" : "github raw"}
              {data.repo.commit ? ` · ${data.repo.commit}` : ""}
            </Chip>
          )}
          <a
            href="https://github.com/markec12345678/quant-arb-engine"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            <Github className="h-3 w-3" /> repo
          </a>
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-60"
            title="refresh engine overview"
            aria-label="refresh engine overview"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {!loaded && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> loading engine overview…
        </div>
      )}
      {error && loaded && !data && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
          Engine overview unavailable: {error}
        </div>
      )}

      {data && (
        <>
          {/* ------------------------------------------------- NO-GO strip */}
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-rose-400">
                <ShieldAlert className="h-3.5 w-3.5" /> never built (binding)
              </span>
              {NO_GO.map((item) => (
                <Chip key={item} tone="bad">
                  {item}
                </Chip>
              ))}
              <span className="ml-auto text-[11px] text-zinc-500">
                the engine explores · it never executes
              </span>
            </div>
          </div>

          {/* --------------------------------------------- pipeline strip */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              <FlowChip label="mock RFQ feed" sub={sweep ? num(sweep.totals.quotes) : undefined} />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip label="σ_level + σ_H estimators" />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip
                label="both families evaluated"
                sub={sweep ? `${num(sweep.totals.family_evals)} evals` : undefined}
              />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip
                label="ranking · higher net edge"
                sub={sweep ? `${num(sweep.totals.selected_days)} selected` : undefined}
              />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip label="ALL-IN EDGE waterfall" />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip
                label="risk caps"
                sub={sweep ? `${num(sweep.totals.risk_rejects)} rejects` : undefined}
              />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip
                label="paper book"
                sub={sweep ? `${num(sweep.totals.opened)} opened` : undefined}
              />
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              <FlowChip
                label="settlement"
                sub={
                  sweep
                    ? `${num(sweep.totals.settled)} settled · ${num(sweep.totals.still_open)} open`
                    : undefined
                }
              />
            </div>
            {data.repo.commit_msg && (
              <p className="mt-2 truncate font-mono text-[10px] text-zinc-600" title={data.repo.commit_msg}>
                {data.repo.commit} — {data.repo.commit_msg}
              </p>
            )}
          </div>

          {/* ---------------------------------------------------- KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Kpi
              label="sweep seeds"
              value={sweep ? num(sweep.params.seeds.length) : "—"}
              sub={sweep ? `${sweep.params.days} d · ${sweep.params.tenor_days} d tenor each` : undefined}
            />
            <Kpi
              label="quote events"
              value={sweep ? num(sweep.totals.quote_events) : "—"}
              sub={sweep ? `${num(sweep.totals.quotes)} quote records` : undefined}
            />
            <Kpi
              label="contested days"
              value={contestedShare != null ? pct(contestedShare) : "—"}
              sub="both families gated in — the choice is live"
            />
            <Kpi
              label="ranking hit-rate"
              value={ranking?.hit_rate_pct != null ? pct(ranking.hit_rate_pct) : "—"}
              sub={ranking ? `${num(ranking.hits)}/${num(ranking.contested_days_evaluated)} full-window contests` : undefined}
              tone="good"
            />
            <Kpi
              label="settled (paper)"
              value={sweep ? num(sweep.totals.settled) : "—"}
              sub={sweep ? `${num(sweep.totals.opened)} opened · ${num(sweep.totals.still_open)} still open` : undefined}
            />
            <Kpi
              label="Σ realized · synthetic"
              value={usd(totalRealized)}
              sub="aggregate over settled paper positions"
              tone="good"
            />
          </div>

          {/* ------------------------------------------------- main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ============================ machinery validation (full width) */}
            <Card
              title="Machinery validation — 40-seed sweep"
              icon={<TrendingUp className="h-4 w-4" />}
              className="lg:col-span-2"
              right={
                sweep ? (
                  <>
                    <Chip tone="good">n = {num(sweep.settled_stats.n)} settled</Chip>
                    <span className="font-mono text-[10px] text-zinc-600">
                      generated {ago(sweep.generated_at)} ago
                    </span>
                  </>
                ) : undefined
              }
            >
              {!sweep ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                  Sweep artifact (research/artifacts/sweep-latest.json) not present yet — run
                  <span className="font-mono"> scripts/research_sweep.py </span>
                  in the engine repo. Until then this card stays honest about being empty.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <DistRow
                      name="PnL % of notional (pooled)"
                      dist={sweep.settled_stats.pnl_pct_of_notional ?? EMPTY_DIST}
                      fmtValue={(n) => sgn(n, 2, "%")}
                      note="both families pooled — every settled paper position, % of requested notional"
                      tone="text-emerald-400"
                    />
                    <DistRow
                      name="realized − locked (bps · forward)"
                      dist={lockDist}
                      fmtValue={(n) => sgn(n, 1)}
                      note="the dated-forward lock through settlement: ≈ −(exit crossing) — well inside the pre-registered 8 bps buffer"
                      tone="text-amber-400"
                    />
                    <DistRow
                      name="accrual − expected (bps · perp)"
                      dist={accDist}
                      fmtValue={(n) => sgn(n, 1)}
                      note="floating carry vs its ex-ante EWMA estimate — positive here because funding kept ramping inside held windows"
                      tone="text-orange-300"
                    />
                  </div>

                  {/* dual σ calibration — the honest diagnostic */}
                  <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sigma className="h-3.5 w-3.5 text-zinc-500" />
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        z-gate calibration · dual σ honesty panels
                      </h3>
                      <span className="ml-auto font-mono text-sm tabular-nums text-zinc-500">
                        nominal 2σ ≈ {sweep.z_gate_calibration.nominal_two_sided_pct}%
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(
                        [
                          {
                            key: "panel_level",
                            panel: sweep.z_gate_calibration.panel_level,
                            fallback: sweep.z_gate_calibration.empirical_breach_pct,
                            title: "σ_level panel — the v0.2.0 finding, kept for audit",
                            body: "the EWMA estimator σ is an instantaneous standard error (std/√eff_n). Reading it as a 90-day horizon statement was the v0.2.0 finding — reported as-is, never tuned.",
                            tone: "text-rose-400",
                          },
                          {
                            key: "panel_horizon",
                            panel: sweep.z_gate_calibration.panel_horizon,
                            fallback: null,
                            title: "σ_H panel — the redefined diagnostic (v0.3)",
                            body: "overlapping-window horizon dispersion (deterministic). Halves the breach vs the level panel; still honestly above nominal — iid-block scaling underestimates autocorrelated regime drift. A documented limitation.",
                            tone: "text-amber-400",
                          },
                        ] as const
                      ).map((p) => {
                        const val = p.panel?.empirical_breach_pct ?? p.fallback ?? null;
                        const checks = p.panel?.n_checks ?? sweep.z_gate_calibration.n_checks ?? null;
                        const breaches = p.panel?.n_breaches ?? null;
                        return (
                          <div key={p.key} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                            <div className="flex items-baseline gap-2">
                              <span className={`font-mono text-xl font-semibold tabular-nums ${p.tone}`}>
                                {pct(val)}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                empirical breach{" "}
                                {breaches != null && checks != null ? `· ${num(breaches)}/${num(checks)}` : ""}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] font-medium text-zinc-300">{p.title}</div>
                            <p className="mt-1 text-[11px] leading-snug text-zinc-500">{p.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* scored predictions — pre-registered, then measured */}
                  {predictions && (
                    <div className="rounded-lg border border-teal-500/25 bg-teal-500/5 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-teal-400" />
                        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-teal-400/80">
                          falsifiable predictions — written in the decision record before any run
                        </h3>
                      </div>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {Object.entries(predictions).map(([pid, p]) => (
                          <div key={pid} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-teal-400">{pid}</span>
                              <Chip tone={verdictTone(p.verdict)}>{p.verdict}</Chip>
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-zinc-500" title={p.statement}>
                              {p.statement}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-snug text-zinc-600">
                        Refuted predictions are reported, never buried — P3&apos;s refutation
                        (contests are the norm, not the exception) is a finding about the world,
                        not a failure to hide.
                      </p>
                    </div>
                  )}

                  {/* reject reasons + per-seed chart */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        risk-cap rejects — the binding constraint
                      </h3>
                      {sweep.reject_reasons.length === 0 ? (
                        <p className="text-xs text-zinc-500">no rejects recorded</p>
                      ) : (
                        sweep.reject_reasons.slice(0, 6).map((r) => (
                          <BarRow
                            key={r.reason}
                            label={r.reason}
                            value={r.count}
                            max={rejectMax}
                            text={num(r.count)}
                            tone="bg-orange-500/60"
                          />
                        ))
                      )}
                      <p className="text-[11px] leading-snug text-zinc-600">
                        One reason dominates: desk concentration (max 5 open paper positions). The
                        caps are the risk layer doing its job — every day a family is selected, only
                        for the book to be full.
                      </p>
                    </div>
                    <div>
                      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        realized PnL per seed (synthetic USD)
                      </h3>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={sweep.per_seed.map((s) => ({ seed: s.seed, realized: s.realized_usd }))}
                            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                          >
                            <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
                            <XAxis
                              dataKey="seed"
                              tick={{ fill: "#71717a", fontSize: 9 }}
                              interval={4}
                              stroke="#3f3f46"
                            />
                            <YAxis
                              tick={{ fill: "#71717a", fontSize: 9 }}
                              stroke="#3f3f46"
                              tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                              width={44}
                            />
                            <Tooltip
                              cursor={{ fill: "#3f3f4644" }}
                              contentStyle={{
                                background: "#18181b",
                                border: "1px solid #3f3f46",
                                borderRadius: 8,
                                fontSize: 11,
                              }}
                              labelFormatter={(l) => `seed ${l}`}
                              formatter={(v: number) => [usd(v), "realized"]}
                            />
                            <Bar dataKey="realized" fill="#34d399" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* per-seed table */}
                  <div>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      per-seed breakdown
                    </h3>
                    <div className="custom-scroll max-h-96 overflow-y-auto rounded-lg border border-zinc-800/70">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">seed</th>
                            <th className="px-3 py-2 font-medium">contested</th>
                            <th className="px-3 py-2 font-medium">selected</th>
                            <th className="px-3 py-2 font-medium">opened</th>
                            <th className="px-3 py-2 font-medium">settled</th>
                            <th className="px-3 py-2 font-medium">still open</th>
                            <th className="px-3 py-2 text-right font-medium">realized</th>
                            <th className="px-3 py-2 text-right font-medium">aggregate</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono tabular-nums text-zinc-300">
                          {sweep.per_seed.map((s) => (
                            <tr key={s.seed} className="border-t border-zinc-800/60">
                              <td className="px-3 py-1.5 text-zinc-500">{s.seed}</td>
                              <td className="px-3 py-1.5">{num(s.contested_days)}</td>
                              <td className="px-3 py-1.5">{num(s.selected_days)}</td>
                              <td className="px-3 py-1.5">{num(s.opened)}</td>
                              <td className="px-3 py-1.5">{num(s.settled)}</td>
                              <td className="px-3 py-1.5 text-zinc-500">{num(s.still_open)}</td>
                              <td
                                className={`px-3 py-1.5 text-right ${
                                  s.realized_usd > 0
                                    ? "text-emerald-400"
                                    : s.realized_usd < 0
                                      ? "text-rose-400"
                                      : "text-zinc-600"
                                }`}
                              >
                                {usd(s.realized_usd)}
                              </td>
                              <td className="px-3 py-1.5 text-right">{sgn(s.aggregate_pct, 2, "%")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* ===================== world v2 — carry regime (half width) */}
            <Card
              title="World v2 — the synthetic regime"
              icon={<TrendingUp className="h-4 w-4" />}
              right={
                run ? (
                  <span className="font-mono text-[10px] text-zinc-600">
                    seed {run.summary.seed} · {num(run.summary.days)} d
                  </span>
                ) : undefined
              }
            >
              {carryCurve.length === 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                  carry_curve not present in run-latest.json (pre-v0.3 artifact).
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={carryCurve.map((p) => ({ day: p.day, apr: p.apr_printed * 100 }))}
                        margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
                      >
                        <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
                        <XAxis
                          dataKey="day"
                          type="number"
                          domain={[1, run?.summary.days ?? 200]}
                          tick={{ fill: "#71717a", fontSize: 9 }}
                          stroke="#3f3f46"
                          allowDecimals={false}
                        />
                        <YAxis
                          tick={{ fill: "#71717a", fontSize: 9 }}
                          stroke="#3f3f46"
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                          width={40}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#18181b",
                            border: "1px solid #3f3f46",
                            borderRadius: 8,
                            fontSize: 11,
                          }}
                          labelFormatter={(l) => `day ${l}`}
                          formatter={(v: number) => [`${v.toFixed(2)}%`, "printed funding APR"]}
                        />
                        <ReferenceArea x1={150} x2={180} fill="#fb7185" fillOpacity={0.06} />
                        <ReferenceLine x={30} stroke="#3f3f46" strokeDasharray="3 3" />
                        <ReferenceLine x={120} stroke="#3f3f46" strokeDasharray="3 3" />
                        <ReferenceLine x={150} stroke="#fb718566" strokeDasharray="3 3" />
                        <ReferenceLine x={180} stroke="#fb718566" strokeDasharray="3 3" />
                        <Line
                          type="monotone"
                          dataKey="apr"
                          stroke="#2dd4bf"
                          strokeWidth={1.6}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="good" title="days 30–120: the funding APR mean ramps up">
                      ramp 8% → 18% · d30–120
                    </Chip>
                    <Chip tone="warn" title="days 150–180: the carry COLLAPSES — the regime v0.2 lacked">
                      collapse 18% → 4% · d150–180
                    </Chip>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Daily mean <span className="text-zinc-300">printed</span> funding APR from the
                    journal&apos;s <span className="font-mono">funding_daily</span> records — the
                    observation stream the strategies actually see (print noise included, generator
                    parameters never read). v0.2&apos;s world only ramped up, so the instrument
                    question never existed; world v2 collapses carry late enough that a 30-day-lagging
                    desk still prices stale-high premiums — the regime where{" "}
                    <span className="text-zinc-300">locking</span> beats{" "}
                    <span className="text-zinc-300">floating</span>.
                  </p>
                </div>
              )}
            </Card>

            {/* ===================== ranking layer (half width) */}
            <Card
              title="Ranking layer — instrument choice"
              icon={<Layers className="h-4 w-4" />}
              right={
                ranking ? (
                  <Chip tone="good" title={ranking.definition}>
                    hit-rate {pct(ranking.hit_rate_pct)}
                  </Chip>
                ) : undefined
              }
            >
              {!ranking ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                  ranking stats not present in the artifact (pre-v0.3).
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      {
                        k: "contested · evaluated",
                        v: `${num(ranking.contested_days_evaluated)}`,
                        s: `${num(ranking.truncated_excluded)} truncated excluded`,
                      },
                      {
                        k: "hits / misses / ties",
                        v: `${num(ranking.hits)} / ${num(ranking.misses)} / ${num(ranking.ties)}`,
                        s: "selected family's ex-post carry beat the forgone one's",
                      },
                      {
                        k: "tie rule",
                        v: "→ forward",
                        s: "locked carry preferred at equal net — pre-registered",
                      },
                    ].map((x) => (
                      <div key={x.k} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{x.k}</div>
                        <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-zinc-100">
                          {x.v}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-snug text-zinc-600">{x.s}</div>
                      </div>
                    ))}
                  </div>

                  {/* selection timeline — who won each quote day */}
                  {edgeSeries.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        selection by quote day · representative seed
                      </h3>
                      <div className="h-28">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={edgeSeries.map((p) => ({
                              day: p.day,
                              fwd: p.selected === FORWARD ? 1 : 0,
                              perp: p.selected === PERP ? 1 : 0,
                            }))}
                            margin={{ top: 2, right: 4, bottom: 0, left: 4 }}
                          >
                            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 8 }} stroke="#3f3f46" />
                            <YAxis hide domain={[0, 1]} />
                            <Tooltip
                              cursor={{ fill: "#3f3f4644" }}
                              contentStyle={{
                                background: "#18181b",
                                border: "1px solid #3f3f46",
                                borderRadius: 8,
                                fontSize: 11,
                              }}
                              labelFormatter={(l) => `day ${l}`}
                              formatter={(_v: number, name: string) =>
                                name === "fwd" ? [1, "forward selected"] : [1, "perp selected"]
                              }
                            />
                            <Bar dataKey="fwd" stackId="s" fill={FAMILY_COLOR[FORWARD]} />
                            <Bar dataKey="perp" stackId="s" fill={FAMILY_COLOR[PERP]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* phase shares — the P2 visual */}
                  <div className="space-y-2">
                    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      forward family&apos;s share of contests, by phase
                    </h3>
                    <BarRow
                      label="build-up (d ≤ 150)"
                      value={ranking.forward_selection_share_ramp_pct ?? 0}
                      max={100}
                      text={pct(ranking.forward_selection_share_ramp_pct)}
                      tone="bg-teal-500/60"
                    />
                    <BarRow
                      label="collapse (d > 150)"
                      value={ranking.forward_selection_share_collapse_pct ?? 0}
                      max={100}
                      text={pct(ranking.forward_selection_share_collapse_pct)}
                      tone="bg-teal-400"
                    />
                    <p className="text-[11px] leading-snug text-zinc-600">
                      The ranking flips with the regime: while carry builds, the floating perp family
                      has the higher net edge; once carry collapses under stale-high desk premiums,
                      the dated forward wins. (Prediction P2 — supported as measured.)
                    </p>
                  </div>

                  {/* family census */}
                  {(fwdCensus || perpCensus) && (
                    <div>
                      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        family census · pooled across seeds
                      </h3>
                      <div className="overflow-x-auto custom-scroll rounded-lg border border-zinc-800/70">
                        <table className="w-full text-xs">
                          <thead className="bg-zinc-900 text-zinc-500">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">family</th>
                              <th className="px-3 py-2 font-medium">evals</th>
                              <th className="px-3 py-2 font-medium">gated in</th>
                              <th className="px-3 py-2 font-medium">selected</th>
                              <th className="px-3 py-2 font-medium">opened</th>
                              <th className="px-3 py-2 font-medium">settled</th>
                              <th className="px-3 py-2 text-right font-medium">pnl % μ</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono tabular-nums text-zinc-300">
                            {[FORWARD, PERP].map((sid) => {
                              const c = sid === FORWARD ? fwdCensus : perpCensus;
                              if (!c) return null;
                              return (
                                <tr key={sid} className="border-t border-zinc-800/60">
                                  <td className="px-3 py-1.5">
                                    <span
                                      className="inline-flex items-center gap-1.5"
                                      style={{ color: FAMILY_COLOR[sid] }}
                                    >
                                      <span
                                        className="inline-block h-2 w-2 rounded-full"
                                        style={{ background: FAMILY_COLOR[sid] }}
                                      />
                                      {familyLabel(sid)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5">{num(c.evals)}</td>
                                  <td className="px-3 py-1.5">{num(c.gated_in)}</td>
                                  <td className="px-3 py-1.5">{num(c.selected)}</td>
                                  <td className="px-3 py-1.5">{num(c.opened)}</td>
                                  <td className="px-3 py-1.5">{num(c.settled)}</td>
                                  <td className="px-3 py-1.5 text-right text-emerald-400">
                                    {sgn(c.settled_stats.pnl_pct_of_notional.mean, 2, "%")}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ================================ latest run — end-to-end */}
            <Card
              title="Latest run — end-to-end pipeline"
              icon={<ArrowRight className="h-4 w-4" />}
              right={
                run ? (
                  <span className="font-mono text-[10px] text-zinc-600">
                    run {run.run_id} · {ago(run.generated_at)} ago
                  </span>
                ) : undefined
              }
            >
              {!run ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                  run-latest.json not present yet.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[
                      { k: "quotes", v: num(run.summary.quotes) },
                      { k: "family evals", v: num(run.summary.family_evals) },
                      { k: "contested days", v: num(run.summary.contested_days) },
                      { k: "selected days", v: num(run.summary.selected_days) },
                      { k: "cap rejects", v: num(run.summary.risk_rejects) },
                      { k: "opened", v: num(run.summary.positions_opened) },
                      { k: "settled", v: num(run.summary.positions_settled) },
                      { k: "seed / tenor", v: `${run.summary.seed} / ${run.summary.tenor_days} d` },
                    ].map((x) => (
                      <div key={x.k} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{x.k}</div>
                        <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-zinc-100">
                          {x.v}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                        {usd(run.summary.realized_signed_pnl_usd)}
                      </span>
                      <span className="text-xs text-zinc-400">
                        aggregate {sgn(run.summary.aggregate_pct_of_notional, 4, "%")} of notional ·
                        mean {sgn(run.summary.mean_per_position_pct, 4, "%")} per position
                      </span>
                      {run.summary.ex_ante_net_edge_mean_pct != null && (
                        <span className="ml-auto font-mono text-[11px] text-zinc-500">
                          ex-ante net edge μ {sgn(run.summary.ex_ante_net_edge_mean_pct, 4, "%")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      Representative seed {run.summary.seed} · journal{" "}
                      <span className="font-mono">{run.journal_path}</span>
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      settled paper positions · both families
                    </h3>
                    <div className="custom-scroll max-h-96 overflow-y-auto rounded-lg border border-zinc-800/70">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">position</th>
                            <th className="px-3 py-2 font-medium">family</th>
                            <th className="px-3 py-2 font-medium">held</th>
                            <th className="px-3 py-2 text-right font-medium">carry bps</th>
                            <th className="px-3 py-2 text-right font-medium">realized</th>
                            <th className="px-3 py-2 text-right font-medium">err</th>
                            <th className="px-3 py-2 text-right font-medium">window APR</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono tabular-nums text-zinc-300">
                          {run.settled.map((s: SettledRow) => {
                            const perp = s.strategy_id === PERP;
                            const carryBps = perp ? s.funding_accrual_bps : s.locked_premium_bps;
                            const errBps = perp ? s.realized_minus_expected_bps : s.realized_minus_locked_bps;
                            return (
                              <tr key={s.position_id} className="border-t border-zinc-800/60">
                                <td className="px-3 py-1.5 text-zinc-500">{s.position_id}</td>
                                <td className="px-3 py-1.5">
                                  <span style={{ color: FAMILY_COLOR[s.strategy_id] ?? "#a1a1aa" }}>
                                    {familyLabel(s.strategy_id)}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5">{num(s.held_days)} d</td>
                                <td className="px-3 py-1.5 text-right">{sgn(carryBps, 1)}</td>
                                <td className="px-3 py-1.5 text-right text-emerald-400">
                                  {sgn(s.pnl_pct_of_notional * 100, 1)}
                                </td>
                                <td className="px-3 py-1.5 text-right text-amber-400">
                                  {sgn(errBps, 1)}
                                </td>
                                <td className="px-3 py-1.5 text-right text-zinc-500">
                                  {aprPct(s.perp_alternative_apr)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                      carry = locked premium (forward) or printed funding accrual (perp) · err =
                      realized − locked (forward) or accrual − ex-ante expected (perp) · window APR =
                      realized funding over the held window · quantity chain{" "}
                      {run.settled.every((s) => s.quantity_chain_ok) ? (
                        <CheckCircle2 className="inline h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="inline h-3 w-3 text-rose-500" />
                      )}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            {/* ================================ ALL-IN EDGE waterfall */}
            <Card title="ALL-IN EDGE waterfall — the R8 lesson as code" icon={<Sigma className="h-4 w-4" />}>
              {!opp || !wf ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90">
                  No opportunity example in the artifact yet.
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    The last executed opportunity of the representative run —{" "}
                    <span style={{ color: FAMILY_COLOR[opp.strategy_id] ?? "#a1a1aa" }}>
                      {familyLabel(opp.strategy_id)} family
                    </span>
                    {opp.metadata.ranked_over?.length ? (
                      <>
                        {" "}· ranked over{" "}
                        <span className="text-zinc-300">
                          {opp.metadata.ranked_over.map(familyLabel).join(", ")}
                        </span>
                      </>
                    ) : null}
                    . Gross edge, then every cost as an explicit line, nothing silently folded (I-4):
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { label: "gross edge", v: wf.gross_edge_bps, tone: "bg-emerald-500/70", strong: false },
                      { label: "− entry fees", v: -wf.entry_cost_bps, tone: "bg-rose-500/50", strong: false },
                      { label: "− exit fees", v: -wf.exit_cost_bps, tone: "bg-rose-500/50", strong: false },
                      {
                        label: "− carry σ buffer (k·σ·T/365)",
                        v: -wf.carry_uncertainty_buffer_bps,
                        tone: "bg-rose-500/50",
                        strong: false,
                      },
                      {
                        label: "− slippage buffer",
                        v: -wf.slippage_buffer_bps,
                        tone: "bg-rose-500/50",
                        strong: false,
                      },
                      {
                        label: "− execution risk",
                        v: -wf.execution_risk_buffer_bps,
                        tone: "bg-rose-500/50",
                        strong: false,
                      },
                      {
                        label: "= net executable edge",
                        v: wf.net_executable_edge_bps,
                        tone: "bg-emerald-400",
                        strong: true,
                      },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-3 text-xs">
                        <div className={`w-40 shrink-0 ${row.strong ? "font-semibold text-zinc-200" : "text-zinc-400"}`}>
                          {row.label}
                        </div>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-800">
                          <div
                            className={`h-full ${row.tone}`}
                            style={{
                              width: `${Math.max(2, (Math.abs(row.v) / wf.gross_edge_bps) * 100)}%`,
                            }}
                          />
                        </div>
                        <div
                          className={`w-24 shrink-0 text-right font-mono tabular-nums ${
                            row.strong ? "font-semibold text-emerald-400" : "text-zinc-300"
                          }`}
                        >
                          {sgn(row.v, 1)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {Object.entries(opp.metadata.gates).map(([gate, ok]) => (
                      <Chip key={gate} tone={ok ? "good" : "bad"}>
                        {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {gate === "z_gate"
                          ? `z ${opp.signal_z?.toFixed(2) ?? "—"} ≥ 2.0`
                          : gate === "net_edge_gate"
                            ? `net ${sgn(opp.net_executable_edge_bps, 1)} ≥ 10 bps`
                            : gate}
                      </Chip>
                    ))}
                    <Chip>confidence {(opp.confidence * 100).toFixed(0)}%</Chip>
                    <Chip>horizon {opp.horizon_days} d</Chip>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                        the signal · both sigmas
                      </div>
                      <div className="font-mono tabular-nums leading-relaxed text-zinc-300">
                        {isPerpOpp ? (
                          <>
                            expected funding APR {aprPct(opp.metadata.expected_apr)}
                            <br />
                            σ_level {aprPct(opp.metadata.sigma_level_apr)} · σ_H{" "}
                            {aprPct(opp.metadata.sigma_horizon_apr)}
                            <br />
                            z_perp = E/σ_H {opp.signal_z?.toFixed(2) ?? "—"} (horizon persistence)
                          </>
                        ) : (
                          <>
                            realized funding APR {aprPct(opp.metadata.realized_apr)} (σ_level{" "}
                            {aprPct(opp.metadata.realized_sigma_apr)})
                            <br />
                            desk implied APR {aprPct(opp.metadata.forward_implied_apr)}
                            <br />
                            gap {sgn(opp.metadata.gap_apr * 100, 2, " pts")} → z_level{" "}
                            {opp.signal_z?.toFixed(2)} (diagnostic — gate retired, C4)
                          </>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                        the paper legs · matched base qty
                      </div>
                      <div className="space-y-1 font-mono tabular-nums leading-relaxed text-zinc-300">
                        {opp.legs.map((l) => (
                          <div key={l.instrument}>
                            {l.direction > 0 ? "+" : "−"} {num(l.qty, 2)} {l.instrument} @{" "}
                            {l.px.value.toFixed(4)}
                            <span className="text-zinc-600"> ({usd(l.executed_size_usd)})</span>
                          </div>
                        ))}
                        <div className="pt-1 text-[11px] text-zinc-500">
                          {opp.carry.locked ? (
                            <>
                              <Lock className="mr-1 inline h-3 w-3 text-amber-400" />
                              carry locked: {usd(opp.carry.expected_usd)} · σ {usd(opp.carry.sigma_usd)}{" "}
                              (benchmark / early-exit only)
                            </>
                          ) : (
                            <>
                              carry floating: {usd(opp.carry.expected_usd)} expected · σ_H{" "}
                              {usd(opp.carry.sigma_usd)} (horizon window dispersion)
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* ================================ Route B kernel */}
            <Card title="Route B — the kernel, now two families" icon={<FlaskConical className="h-4 w-4" />}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                  <FlowChip label="CEX funding obs" sub="hour-normalized" />
                  <ArrowRight className="h-3 w-3 text-zinc-600" />
                  <FlowChip label="EWMA + σ_level" />
                  <ArrowRight className="h-3 w-3 text-zinc-600" />
                  <FlowChip label="σ_H (overlapping windows)" />
                  <ArrowRight className="h-3 w-3 text-zinc-600" />
                  <FlowChip label="forward: lock · perp: float" />
                  <ArrowRight className="h-3 w-3 text-zinc-600" />
                  <FlowChip label="ranking by net edge" />
                  <ArrowRight className="h-3 w-3 text-zinc-600" />
                  <FlowChip label="paper legs + settlement" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] leading-relaxed">
                  <div className="rounded-lg border border-teal-500/25 bg-teal-500/5 p-3 text-teal-200/80">
                    <span className="font-semibold" style={{ color: FAMILY_COLOR[FORWARD] }}>
                      forward_basis_v1 — lock.
                    </span>{" "}
                    Long spot at the desk ask + short the dated forward at the desk bid. Carry is
                    locked at inception: the expected carry is the priced premium itself; σ covers
                    only benchmark and early-exit mark risk.
                  </div>
                  <div className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-3 text-orange-200/80">
                    <span className="font-semibold" style={{ color: FAMILY_COLOR[PERP] }}>
                      perp_carry_v1 — float.
                    </span>{" "}
                    Long spot at the desk ask + short the CEX perp at its mark. Funding accrues per
                    settlement print; σ_H is genuine PnL risk — exactly the risk the forward family
                    pays a premium to remove. CEX fees are explicit waterfall lines.
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3 text-[11px] leading-relaxed text-zinc-500">
                  <span className="text-zinc-300">Matched base quantity on both legs</span> in every
                  family (NEW-17/R8: a true hedge, never a USD-notional match that leaves residual
                  delta). Every family is evaluated and journaled every quote day — gated or not —
                  and the ranking layer executes the higher net executable edge (tie → forward,
                  pre-registered). Why this exists: the funding-arb audit measured reality (−0.281 %
                  attributable baseline, fees dominating); the engine asks which instrument should
                  express the carry view, with paper discipline, before any W0/W1 real quote exists.
                </div>
              </div>
            </Card>

            {/* ================================ family + next steps */}
            <Card title="Where this sits · what's next" icon={<Layers className="h-4 w-4" />} className="lg:col-span-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    the four-repo family
                  </h3>
                  {[
                    {
                      name: "funding-arb",
                      meta: "@ 0373f5d · locked",
                      role: "measures reality — paper A/B/C running, day-5–7 verdict pending",
                    },
                    {
                      name: "tower",
                      meta: "this app · read-only",
                      role: "observes both systems — never writes to either",
                    },
                    {
                      name: "phase3-lab",
                      meta: "safety lab",
                      role: "hardens execution routing — 106 tests",
                    },
                    {
                      name: "quant-arb-engine",
                      meta: `v${data.repo.version ?? "—"} · paper only`,
                      role: "explores the next generation — two carry families + ranking on synthetic data",
                    },
                  ].map((r) => (
                    <div
                      key={r.name}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5 text-xs"
                    >
                      <span className="font-semibold text-zinc-100">{r.name}</span>
                      <span className="font-mono text-[10px] text-zinc-600">{r.meta}</span>
                      <span className="min-w-0 flex-1 text-zinc-500">{r.role}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    next steps
                  </h3>
                  {[
                    {
                      id: "W0",
                      owner: "user",
                      text: "NODE onboarding → capability sheet + real RFQ terms (desk minimums, spreads)",
                    },
                    {
                      id: "W1",
                      owner: "engine",
                      text: "real RFQ feed attaches behind the same feed surface — strategy code unchanged",
                    },
                    {
                      id: "verdict",
                      owner: "time",
                      text: "funding-arb Phase-2 paper verdict at day 5–7 of the A/B/C run",
                    },
                  ].map((n) => (
                    <div
                      key={n.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5 text-xs"
                    >
                      <span className="font-mono font-semibold text-teal-400">{n.id}</span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-px text-[10px] text-zinc-400">
                        owner: {n.owner}
                      </span>
                      <span className="min-w-0 flex-1 text-zinc-400">{n.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* -------------------------------------------- epistemic footer */}
          {(sweep?.notes ?? run?.summary) && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
                epistemic rule · travels with every artifact
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200/70">
                {(sweep?.notes.epistemic_note ?? run?.summary.epistemic_note) &&
                  (sweep?.notes.epistemic_note ?? run?.summary.epistemic_note)}
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                unit rule —{" "}
                {sweep?.notes.unit_rule ?? run?.summary.unit_rule}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
