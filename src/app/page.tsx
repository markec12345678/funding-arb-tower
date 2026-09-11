"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  Github,
  Layers,
  Loader2,
  Radio,
  ShieldCheck,
  Terminal,
  TrendingDown,
  Zap,
} from "lucide-react";

type Status = {
  now: string;
  mode: "local" | "remote";
  source: { kind: string; detail: string };
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
  };
  backtest: any;
  pipeline: {
    github: any;
    phase3: {
      repo: string;
      url: string;
      latest: { sha: string; message: string; date: string | null } | null;
      summary: string;
      tests: string;
      status: string;
    } | null;
    vercel: any;
    snapshot: any;
  };
  plan: { step: string; state: string }[];
};

const fmt = (n: number | undefined | null) =>
  n === undefined || n === null ? "—" : n.toLocaleString("sl-SI");

const pct = (n: number | undefined | null, d = 4) =>
  n === undefined || n === null ? "—" : `${n.toFixed(d)}%`;

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

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

export default function Home() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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
  const totals = p?.totals ?? {};
  const lastCycle = p?.cycles?.[0];
  const funnelMax = Math.max(1, totals.scan_total || 0, totals.candidates || 0, totals.opens || 0, totals.open_simulated || 0);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
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
                P0 → backtest → paper A/B/C → phase-3 safety lab · prove the edge, then earn the port
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                {data.mode === "local" ? "sandbox live" : "github snapshot"}
              </span>
            )}
            {data && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  p?.runner?.alive
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-400"
                }`}
              >
                <Radio className={`h-3.5 w-3.5 ${p?.runner?.alive ? "animate-pulse" : ""}`} />
                {data.mode === "remote"
                  ? p?.runner?.alive
                    ? "GH collector LIVE"
                    : "collector stale"
                  : p?.runner?.alive
                    ? "paper runner LIVE"
                    : "runner down"}
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

        {!loaded && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> loading pipeline status…
          </div>
        )}
        {error && loaded && !data && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            Status API unavailable: {error}
          </div>
        )}

        {data && (
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
                <div className="mt-4 text-[11px] text-zinc-500">
                  runner pid {p?.runner?.pid ?? "—"} · log updated {timeAgo(p?.runner?.log_updated_at)} ago ·
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Github className="h-3.5 w-3.5" /> {data.pipeline.github.repo}
                      </div>
                      <div className="text-zinc-500">branch <span className="text-zinc-300 font-mono">{data.repo.branch}</span>{data.repo.dirty && <span className="text-amber-400"> (dirty)</span>}</div>
                      <div className="text-zinc-500">CI {data.pipeline.github.ci}</div>
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
                      <div className="font-mono text-[10px] text-zinc-400 break-all">
                        {data.pipeline.snapshot.source}
                      </div>
                      <div className="text-zinc-500">{data.pipeline.snapshot.refreshed_by}</div>
                      <div className="text-zinc-600 pt-1">lifecycle: {data.pipeline.snapshot.lifecycle}</div>
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
                : "deployed mode — lifecycle snapshots + 5-min github-actions cycles from the paper-data branch"}
            </p>
          </>
        )}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
          <span>funding-arb paper validation · P0 hardened · 539 + 106 phase-3 tests · atomic ledgers · fail-closed gates</span>
          <span className="font-mono">educational / research — not financial advice</span>
        </div>
      </footer>
    </div>
  );
}
