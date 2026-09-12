import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";

// Side-effect imports: activate the GitHub paper-collector heartbeat and the
// hourly paper-data snapshot inside this (long-lived) dev-server process.
// Route modules hot-reload in dev, so this is the activation path for an
// already-running server; at server boot instrumentation-node.ts activates
// them as well. Both are guarded by globalThis + an existsSync check on the
// funding-arb checkout, so on a serverless deployment (Vercel) they are
// clean no-ops.
import "@/server/gh-heartbeat";
import "@/server/paper-snapshot";
import { classifyExits, type ExitClassification } from "@/server/exit-classification";
import { decomposeEconomics, type EconomicInvariants } from "@/server/economic-invariants";

export const dynamic = "force-dynamic";

const REPO = "/home/z/funding-arb";
const JOURNAL = path.join(REPO, "scripts/data/pure-futures/journal.jsonl");
const POSITIONS = path.join(REPO, "scripts/data/pure-futures/positions.json");
const PIDFILE = path.join(REPO, "data/paper_runner.pid");
const ANALYSIS = path.join(REPO, "data/backtest_analysis.json");
const RUNNER_LOG = path.join(REPO, "data/paper_runner.log");
const SUPERVISOR_META = path.join(REPO, "data/paper_runner.meta.json");

// ---- Remote data plane (used when the sandbox checkout is absent, e.g. on
// Vercel, or when ?source=remote forces it for verification) ----
const GH_OWNER = "markec12345678";
const GH_API = "https://api.github.com";
const PAPER_BRANCH = "paper-data";
const rawPaper = (file: string) =>
  `https://raw.githubusercontent.com/${GH_OWNER}/funding-arb/${PAPER_BRANCH}/paper-data/${file}`;
const VERCEL_DEMO = "https://funding-arb-dun.vercel.app";

// ---- Freshness contract (the observability gate) ----
// "Healthy" must mean the DATA is live, not just that a process exists.
// The paper collector writes a cycle every ~5 min; if the newest cycle is
// older than 3 missed intervals the data plane is stale and the UI must go
// RED even though the runner may still be "alive". The gh-pages scanner
// snapshot (Vercel demo data source) is refreshed hourly by an EXTERNAL
// cron-job.org trigger — if that cron dies everything looks green while the
// demo serves stale data, so its age is tracked separately.
const EXPECTED_CYCLE_S = 300; // paper cycles: every 5 min
const STALE_AFTER_S = 900; // >3 missed cycles = stale
const SNAPSHOT_EXPECTED_S = 3600; // gh-pages snapshot: hourly
const SNAPSHOT_STALE_AFTER_S = 7200;
const GH_PAGES_SNAPSHOT = `https://raw.githubusercontent.com/${GH_OWNER}/funding-arb/gh-pages/scanner-latest.json`;

type JournalCycle = {
  ts: string;
  scan_total: number;
  candidates: number;
  opens: number;
  open_simulated: number;
  open_aborted: number;
  open_filled: number;
  closes: number;
  open_positions: number;
};

type AbortReason = { reason: string; count: number };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function classifyAbort(logs: string[] | undefined): string {
  const joined = (logs || []).join(" | ");
  if (joined.includes("perp price unavailable")) return "price unavailable (stale/delisted leg)";
  if (joined.includes("depth check")) return "order-book depth gate";
  if (joined.includes("funding re-check")) return "funding re-check (spread collapsed)";
  if (joined.includes("margin")) return "margin gate (fail-closed)";
  if (joined.includes("mark spread")) return "mark-spread gate";
  if (joined.includes("Quantity floored")) return "qty below minimum";
  if (joined.includes("below minimum")) return "notional below venue minimum";
  if (joined.includes("rolled_back")) return "leg failure -> rollback";
  if (joined.length === 0) return "unknown";
  return "other";
}

function parseJournalRaw(raw: string): {
  cycles: JournalCycle[];
  aborts: AbortReason[];
  totals: Record<string, number>;
} {
  const empty = { cycles: [], aborts: [], totals: {} };
  if (!raw) return empty;
  const lines = raw.trim().split("\n").slice(-120); // last ~10h at 5-min cycles
  const cycles: JournalCycle[] = [];
  const abortCounts = new Map<string, number>();
  const totals = {
    cycles: 0,
    scan_total: 0,
    candidates: 0,
    opens: 0,
    open_simulated: 0,
    open_aborted: 0,
    open_filled: 0,
    closes: 0,
  };
  for (const line of lines) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    // Skip test/dev noise: unit-test runs leak single-row cycles into the
    // shared journal; only count real scanner cycles (full universe scans).
    if ((d.scan_total ?? 0) < 50) continue;
    const actions: any[] = Array.isArray(d.actions) ? d.actions : [];
    const opens = actions.filter((a) => a.action === "open");
    const closes = actions.filter((a) => a.action === "close");
    let simulated = 0,
      aborted = 0,
      filled = 0;
    for (const a of opens) {
      const state = a.result?.state ?? "";
      if (state === "simulated") simulated++;
      else if (state === "aborted") {
        aborted++;
        const reason = classifyAbort(a.result?.logs);
        abortCounts.set(reason, (abortCounts.get(reason) ?? 0) + 1);
      } else if (state === "filled") filled++;
    }
    const cycle: JournalCycle = {
      ts: d.ts ?? "",
      scan_total: d.scan_total ?? 0,
      candidates: d.candidates_after_filter ?? 0,
      opens: opens.length,
      open_simulated: simulated,
      open_aborted: aborted,
      open_filled: filled,
      closes: closes.length,
      open_positions: d.open_positions ?? 0,
    };
    cycles.push(cycle);
    totals.cycles++;
    totals.scan_total += cycle.scan_total;
    totals.candidates += cycle.candidates;
    totals.opens += opens.length;
    totals.open_simulated += simulated;
    totals.open_aborted += aborted;
    totals.open_filled += filled;
    totals.closes += closes.length;
  }
  const aborts = [...abortCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  return { cycles, aborts, totals };
}

function mapPositions(rows: any): any[] {
  return (Array.isArray(rows) ? rows : []).slice(-20).map((p: any) => ({
    id: p.id,
    base: p.base,
    direction: p.direction,
    long_venue: p.long_venue,
    short_venue: p.short_venue,
    status: p.status,
    dry_run: p.dry_run,
    qty: p.qty,
    trade_usd: p.trade_usd,
    opened_at: p.opened_at ? new Date(p.opened_at).toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// GitHub API / raw-CDN client: TTL cache + ETag conditional requests so the
// 10-second dashboard polling never hammers the API (304 responses are free
// against the rate limit). On the sandbox the PAT is read from the
// funding-arb git remote (pushurl embeds it) — never hardcoded.
// ---------------------------------------------------------------------------

type Cached = { at: number; etag?: string; value: any };
const ghCache = new Map<string, Cached>();
const GH_TTL_MS = 300_000;
const RAW_TTL_MS = 60_000;

function ghToken(): string | null {
  return safe(
    () => {
      const url = execSync("git config --get remote.origin.pushurl", {
        cwd: REPO,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const m = url.match(/^https:\/\/([^@/]+)@github\.com/);
      return m ? m[1] : null;
    },
    null as string | null
  );
}

async function ghJson(pathname: string): Promise<any | null> {
  const url = `${GH_API}${pathname}`;
  const hit = ghCache.get(url);
  const now = Date.now();
  if (hit && now - hit.at < GH_TTL_MS) return hit.value;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "funding-arb-tower",
  };
  const tok = ghToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (hit?.etag) headers["If-None-Match"] = hit.etag;
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 304 && hit) {
      hit.at = now;
      return hit.value;
    }
    if (!res.ok) return hit?.value ?? null;
    const value = await res.json();
    ghCache.set(url, { at: now, etag: res.headers.get("etag") ?? undefined, value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

async function rawText(url: string): Promise<string | null> {
  const hit = ghCache.get(url);
  const now = Date.now();
  if (hit && now - hit.at < RAW_TTL_MS) return hit.value as string | null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      headers: { "User-Agent": "funding-arb-tower" },
    });
    if (!res.ok) return (hit?.value as string | null) ?? null;
    const value = await res.text();
    ghCache.set(url, { at: now, value });
    return value;
  } catch {
    return (hit?.value as string | null) ?? null;
  }
}

async function vercelHealth(): Promise<{ healthy: boolean; checked_at: string | null }> {
  const key = "vercel-health";
  const hit = ghCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < GH_TTL_MS) return hit.value;
  let healthy = false;
  try {
    const res = await fetch(VERCEL_DEMO, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  const value = { healthy, checked_at: new Date().toISOString() };
  ghCache.set(key, { at: now, value });
  return value;
}

// ---------------------------------------------------------------------------
// Local (sandbox) readers
// ---------------------------------------------------------------------------

function localJournal() {
  if (!existsSync(JOURNAL)) return { cycles: [], aborts: [], totals: {} };
  return safe(() => parseJournalRaw(readFileSync(JOURNAL, "utf-8")), {
    cycles: [],
    aborts: [],
    totals: {},
  });
}

function runnerStatus() {
  const pid = safe(() => parseInt(readFileSync(PIDFILE, "utf-8").trim(), 10), 0);
  let alive = false;
  if (pid > 0) alive = existsSync(`/proc/${pid}`);
  if (!alive) {
    alive = safe(() => {
      // [.] trick: avoid the pgrep wrapper shell matching its own cmdline.
      const out = execSync("pgrep -f 'run_pure_futures_spread[.]py' || true", {
        encoding: "utf-8",
      });
      return out.trim().length > 0;
    }, false);
  }
  const logMtime = safe(() => statSync(RUNNER_LOG).mtimeMs, 0);
  const logTail = safe(
    () => readFileSync(RUNNER_LOG, "utf-8").trim().split("\n").slice(-12),
    [] as string[]
  );
  return {
    alive,
    pid: pid > 0 ? pid : null,
    log_updated_at: logMtime ? new Date(logMtime).toISOString() : null,
    log_tail: logTail,
    supervisor: safe(() => JSON.parse(readFileSync(SUPERVISOR_META, "utf-8")), null),
  };
}

function repoStatus() {
  const commits = safe(
    () =>
      execSync("git -C /home/z/funding-arb log --oneline -6", { encoding: "utf-8" })
        .trim()
        .split("\n")
        .map((l) => {
          const [sha, ...rest] = l.split(" ");
          return { sha: sha.slice(0, 7), message: rest.join(" ").slice(0, 90) };
        }),
    [] as { sha: string; message: string }[]
  );
  const branch = safe(
    () => execSync("git -C /home/z/funding-arb rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim(),
    "unknown"
  );
  const dirty = safe(
    () =>
      execSync("git -C /home/z/funding-arb status --porcelain", { encoding: "utf-8" }).trim().length > 0,
    false
  );
  return { branch, commits, dirty };
}

function paperPositions() {
  return safe(() => {
    if (!existsSync(POSITIONS)) return [];
    return mapPositions(JSON.parse(readFileSync(POSITIONS, "utf-8")));
  }, [] as any[]);
}

// ---------------------------------------------------------------------------
// Phase-2 A/B/C discipline — the read-only analyzer's stable artifact,
// rendered VERBATIM. The daily verify-only check
// (funding-arb scripts/analysis/phase2_report.py — locked framework) writes
// report-latest.json into its own output dir; this block consumes it without
// ever recomputing a decision input: the numbers the A/B/C verdict reads are
// the analyzer's, by construction. Local mode reads the checkout; remote mode
// reads the copy pushed hourly to the paper-data branch by the tower-owned
// snapshot pusher (scripts/push-paper-snapshot.sh — plumbing push, the
// funding-arb working tree is never touched).
// ---------------------------------------------------------------------------

const PHASE2_LOCAL = path.join(REPO, "scripts/data/phase2/report-latest.json");
// The discipline is a DAILY check; 26h = one day + 2h grace before the tower
// calls it overdue. This makes the discipline itself verifiable: a skipped
// day is visible, not silent.
const PHASE2_DAILY_GRACE_S = 26 * 3600;

type Phase2Block = {
  available: boolean;
  source: "local-analyzer" | "paper-data-branch" | null;
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

// The analyzer stamps "2026-09-12 04:12:31Z" (space, not ISO T) — normalize.
function parseStamp(s: unknown): number {
  return typeof s === "string" ? new Date(s.replace(" ", "T")).getTime() : NaN;
}

function phase2FromReport(rep: any, source: "local-analyzer" | "paper-data-branch"): Phase2Block {
  const genMs = parseStamp(rep?.generated_at);
  const ageS = Number.isNaN(genMs) ? null : Math.max(0, (Date.now() - genMs) / 1000);
  // Display-only timeline arithmetic (baseline + 3d / + 7d) — not a decision
  // input; the decision-support numbers below are the analyzer's own.
  const baseMs = parseStamp(rep?.baseline_start);
  const c = rep?.continuity ?? {};
  const sb = c.sandbox ?? {};
  const ac = c.actions ?? {};
  const meta = c.meta ?? {};
  const files = c.branch?.files ?? {};
  const snapSb = files.sandbox_snapshots ?? {};
  const snapGh = files.github_actions ?? {};
  return {
    available: true,
    source,
    reason: null,
    generated_at: typeof rep?.generated_at === "string" ? rep.generated_at : null,
    age_s: ageS === null ? null : Math.round(ageS),
    check_overdue: ageS === null ? null : ageS > PHASE2_DAILY_GRACE_S,
    day: typeof rep?.day === "number" ? rep.day : null,
    stage: typeof rep?.stage === "string" ? rep.stage : null,
    baseline_start: typeof rep?.baseline_start === "string" ? rep.baseline_start : null,
    day3_at: Number.isNaN(baseMs) ? null : new Date(baseMs + 3 * 86400_000).toISOString(),
    day7_at: Number.isNaN(baseMs) ? null : new Date(baseMs + 7 * 86400_000).toISOString(),
    totals: rep?.totals ?? null,
    integrity: {
      parse_errors: sb.parse_errors ?? null,
      duplicate_ts: sb.duplicate_ts ?? null,
      ts_back_jumps: sb.ts_back_jumps ?? null,
      gaps_over_15min: Array.isArray(sb.gaps_over_15min) ? sb.gaps_over_15min.length : null,
      duplicate_position_ids: Array.isArray(sb.duplicate_position_ids)
        ? sb.duplicate_position_ids.length
        : null,
      open_now: sb.open_now ?? null,
      last_cycle_open_positions: sb.last_cycle_open_positions_field ?? null,
      collector_coverage_pct: ac.coverage_pct ?? null,
      collector_duplicate_ts: ac.duplicate_ts ?? null,
      collector_gaps_over_10min: Array.isArray(ac.gaps_over_10min) ? ac.gaps_over_10min.length : null,
      supervisor_alive: meta.runner?.supervisor_alive ?? null,
      snapshot_pusher_runs: meta.snapshot_pusher?.runs ?? null,
      snapshot_pusher_ok: meta.snapshot_pusher?.ok ?? null,
      sandbox_snapshot_resets: Array.isArray(snapSb.line_count_resets)
        ? snapSb.line_count_resets.length
        : null,
      gh_snapshot_resets: Array.isArray(snapGh.line_count_resets)
        ? snapGh.line_count_resets.length
        : null,
    },
  };
}

function phase2Local(): Phase2Block {
  if (!existsSync(PHASE2_LOCAL)) {
    return {
      available: false,
      source: null,
      reason:
        "report-latest.json not found — the daily verify-only check (scripts/analysis/phase2_report.py) has not run in this checkout yet",
      generated_at: null,
      age_s: null,
      check_overdue: null,
      day: null,
      stage: null,
      baseline_start: null,
      day3_at: null,
      day7_at: null,
      totals: null,
      integrity: null,
    };
  }
  const rep = safe(() => JSON.parse(readFileSync(PHASE2_LOCAL, "utf-8")), null);
  if (!rep) {
    return {
      available: false,
      source: null,
      reason: "report-latest.json present but unreadable",
      generated_at: null,
      age_s: null,
      check_overdue: null,
      day: null,
      stage: null,
      baseline_start: null,
      day3_at: null,
      day7_at: null,
      totals: null,
      integrity: null,
    };
  }
  return phase2FromReport(rep, "local-analyzer");
}

async function phase2Remote(): Promise<Phase2Block> {
  const unavailable = (reason: string): Phase2Block => ({
    available: false,
    source: null,
    reason,
    generated_at: null,
    age_s: null,
    check_overdue: null,
    day: null,
    stage: null,
    baseline_start: null,
    day3_at: null,
    day7_at: null,
    totals: null,
    integrity: null,
  });
  const raw = await rawText(rawPaper("phase2-report-latest.json"));
  if (!raw) {
    return unavailable(
      "not yet on the paper-data branch — the tower-owned hourly snapshot pusher ships it after the next run"
    );
  }
  const rep = safe(() => JSON.parse(raw), null);
  if (!rep) return unavailable("phase2-report-latest.json unreadable on the paper-data branch");
  return phase2FromReport(rep, "paper-data-branch");
}

// ---------------------------------------------------------------------------
// Remote (paper-data branch) readers — the deployed mode
// ---------------------------------------------------------------------------

async function remotePaper() {
  // Two datasets live on the paper-data branch:
  //  - github-actions/* : the stateless collector's own cycles + positions,
  //    committed every ~5 min — the LIVE data plane (funnel + ledger).
  //  - root files        : the hourly lifecycle snapshot of the sandbox
  //    runner (journal history, backtest analysis, runner log) — durable
  //    backup; its age is tracked separately as lifecycle_age_s.
  const [collectorJournalRaw, collectorPositionsRaw, sandboxJournalRaw, analysisRaw, logRaw, branch] =
    await Promise.all([
      rawText(rawPaper("github-actions/journal.jsonl")),
      rawText(rawPaper("github-actions/positions.json")),
      rawText(rawPaper("journal.jsonl")),
      rawText(rawPaper("backtest_analysis.json")),
      rawText(rawPaper("paper_runner.log")),
      ghJson(`/repos/${GH_OWNER}/funding-arb/branches/${PAPER_BRANCH}`),
    ]);

  const journal = collectorJournalRaw
    ? parseJournalRaw(collectorJournalRaw)
    : { cycles: [], aborts: [], totals: {} };
  const positions = safe(
    () => mapPositions(JSON.parse(collectorPositionsRaw ?? "[]")),
    [] as any[]
  );
  const analysis = safe(() => JSON.parse(analysisRaw ?? "null"), null);
  const logTail = (logRaw ?? "").trim().split("\n").filter(Boolean).slice(-12);

  // Hourly lifecycle snapshot age (sandbox runner's journal, pushed by
  // scripts/push-paper-snapshot.sh): informational — the live gate is the
  // collector cadence, this tells you whether the hourly durability push
  // is still landing.
  let lifecycleAgeS: number | null = null;
  if (sandboxJournalRaw) {
    const sandboxCycles = parseJournalRaw(sandboxJournalRaw).cycles;
    const lastTs = sandboxCycles.length ? sandboxCycles[sandboxCycles.length - 1].ts : "";
    const ms = lastTs && !Number.isNaN(new Date(lastTs).getTime()) ? new Date(lastTs).getTime() : null;
    lifecycleAgeS = ms !== null ? Math.max(0, (Date.now() - ms) / 1000) : null;
  }

  const pushedAt: string | null =
    branch?.commit?.commit?.committer?.date ?? branch?.commit?.commit?.author?.date ?? null;
  // Liveness proxy: the github-actions collector commits a cycle every ~5 min.
  const fresh = pushedAt ? Date.now() - new Date(pushedAt).getTime() < 15 * 60_000 : false;
  return {
    journal,
    positions,
    analysis,
    exits: classifyExits(collectorJournalRaw, collectorPositionsRaw),
    economics: decomposeEconomics(collectorJournalRaw, collectorPositionsRaw),
    runner: {
      alive: fresh,
      pid: null,
      log_updated_at: pushedAt,
      log_tail: logTail,
      supervisor: null,
    },
    lifecycle_age_s: lifecycleAgeS === null ? null : Math.round(lifecycleAgeS),
  };
}

// ---------------------------------------------------------------------------
// Pipeline (live GitHub state, both modes)
// ---------------------------------------------------------------------------

async function pipeline(repoCommitsLocal: { sha: string; message: string }[], remoteMode: boolean) {
  const [farbRepo, farbCommits, p3Commits, health, snapRaw] = await Promise.all([
    ghJson(`/repos/${GH_OWNER}/funding-arb`),
    remoteMode ? ghJson(`/repos/${GH_OWNER}/funding-arb/commits?per_page=6`) : Promise.resolve(null),
    ghJson(`/repos/${GH_OWNER}/phase3-lab/commits?per_page=1`),
    vercelHealth(),
    rawText(GH_PAGES_SNAPSHOT),
  ]);

  const commits: { sha: string; message: string }[] = remoteMode
    ? (Array.isArray(farbCommits)
        ? farbCommits.map((c: any) => ({
            sha: String(c.sha ?? "").slice(0, 7),
            message: String(c.commit?.message ?? "").split("\n")[0].slice(0, 90),
          }))
        : [])
    : repoCommitsLocal;

  const p3 = Array.isArray(p3Commits) ? p3Commits[0] : null;

  // gh-pages scanner snapshot freshness (Vercel demo data source).
  const snapMeta = safe(() => (JSON.parse(snapRaw ?? "null") || {}).meta, null as any);
  const snapGeneratedAt: string | null =
    snapMeta?.generated_at ?? snapMeta?.scan_timestamp ?? null;
  const snapAgeS =
    snapGeneratedAt && !Number.isNaN(new Date(snapGeneratedAt).getTime())
      ? Math.max(0, (Date.now() - new Date(snapGeneratedAt).getTime()) / 1000)
      : null;

  return {
    github: {
      repo: `${GH_OWNER}/funding-arb`,
      url: `https://github.com/${GH_OWNER}/funding-arb`,
      default_branch: farbRepo?.default_branch ?? "main",
      pushed_at: farbRepo?.pushed_at ?? null,
      branches: ["main", "p0-hardening", "gh-pages", "paper-data", "feat/risk-engine-wiring", "upgrade/risk-profit-engine"],
      ci: "539 tests, matrix ubuntu+windows, dispatched green; nightly 03:07 UTC",
    },
    phase3: {
      repo: `${GH_OWNER}/phase3-lab`,
      url: `https://github.com/${GH_OWNER}/phase3-lab`,
      latest: p3
        ? {
            sha: String(p3.sha ?? "").slice(0, 7),
            message: String(p3.commit?.message ?? "").split("\n")[0].slice(0, 90),
            date: p3.commit?.committer?.date ?? p3.commit?.author?.date ?? null,
          }
        : null,
      summary: "execution-safety lab — 4-layer separation, golden contract v1.1.0",
      tests: "106/106 (foundation 80 · reconciliation 19 · risk guardian 23 · cross-layer 13)",
      status: "cross-layer CERTIFIED — port candidate BLOCKED by Phase-2 A/B/C",
    },
    vercel: {
      project: "funding-arb",
      url: VERCEL_DEMO,
      status: health.healthy
        ? "READY (vite/web, SSO removed, own gh-pages snapshot) — live check OK"
        : "configured (funding-arb-dun.vercel.app) — live check FAILED",
      healthy: health.healthy,
      checked_at: health.checked_at,
    },
    snapshot: {
      source: `raw.githubusercontent.com/${GH_OWNER}/funding-arb/gh-pages/scanner-latest.json`,
      refreshed_by: "TG Funding Push workflow (external cron-job.org trigger / dispatch)",
      lifecycle: `paper-data branch (hourly snapshot + 5-min github-actions cycles)`,
      generated_at: snapGeneratedAt,
      age_s: snapAgeS === null ? null : Math.round(snapAgeS),
      expected_s: SNAPSHOT_EXPECTED_S,
      stale: snapAgeS === null ? null : snapAgeS > SNAPSHOT_STALE_AFTER_S,
      status:
        snapAgeS === null
          ? "unknown"
          : snapAgeS > SNAPSHOT_STALE_AFTER_S
            ? "stale"
            : "fresh",
    },
    _commits: commits,
  };
}

const PLAN: { step: string; state: string }[] = [
  { step: "P0 hardening: auth, atomic persistence, fail-closed margin, pre-submit recheck, fee-aware exit", state: "done" },
  { step: "Diff + test/CI verification (535 -> 539 green; CI green on GitHub runners)", state: "done" },
  { step: "30d backtest BTC/ETH/SOL (4 CEX + HL): 0 executable trades, fee gate kills all 27,876 rows", state: "done" },
  { step: "E2E paper-flow integration test (scanner -> strategy -> recheck -> executor -> state -> watcher -> exit)", state: "done" },
  { step: "Phase 2: live paper validation A/B/C (runner live, gates active; day-3 interim, day-5-7 final)", state: "active" },
  { step: "Phase 3 lab: execution-safety foundation + reconciliation + risk guardian (106 tests, golden contract v1.1.0)", state: "done" },
  { step: "Phase 3 lab: formal cross-layer safety gate — 13/13 scenarios, 135-journal retro-audit, PORT CANDIDATE", state: "done" },
  { step: "Production port of the safety layer into funding-arb (BLOCKED until Phase-2 A/B/C verdict)", state: "pending" },
  { step: "Minimal real-money test (1 pair, smallest notional, manual supervision)", state: "pending" },
];

export async function GET(req: NextRequest) {
  const forceRemote = req.nextUrl.searchParams.get("source") === "remote";
  const localAvailable = safe(() => existsSync(REPO) && statSync(REPO).isDirectory(), false);
  const remoteMode = forceRemote || !localAvailable;

  let paperBlock: {
    journal: { cycles: JournalCycle[]; aborts: AbortReason[]; totals: Record<string, number> };
    positions: any[];
    analysis: any;
    runner: any;
    lifecycle_age_s?: number | null;
    exits: ExitClassification | null;
    economics: EconomicInvariants | null;
  };
  let repo: { branch: string; commits: { sha: string; message: string }[]; dirty: boolean };

  if (remoteMode) {
    const r = await remotePaper();
    paperBlock = r;
    const info = await ghJson(`/repos/${GH_OWNER}/funding-arb`);
    repo = {
      branch: info?.default_branch ?? "main",
      commits: [],
      dirty: false,
    };
  } else {
    paperBlock = {
      journal: localJournal(),
      positions: paperPositions(),
      analysis: safe(() => JSON.parse(readFileSync(ANALYSIS, "utf-8")), null),
      runner: runnerStatus(),
      lifecycle_age_s: null,
      exits: classifyExits(
        safe(() => (existsSync(JOURNAL) ? readFileSync(JOURNAL, "utf-8") : null), null),
        safe(() => (existsSync(POSITIONS) ? readFileSync(POSITIONS, "utf-8") : null), null)
      ),
      economics: decomposeEconomics(
        safe(() => (existsSync(JOURNAL) ? readFileSync(JOURNAL, "utf-8") : null), null),
        safe(() => (existsSync(POSITIONS) ? readFileSync(POSITIONS, "utf-8") : null), null)
      ),
    };
    repo = repoStatus();
  }

  const pipe = await pipeline(repo.commits, remoteMode);
  repo.commits = (pipe as any)._commits ?? repo.commits;
  const { _commits, ...pipelineClean } = pipe as any;

  // Phase-2 discipline: read-only consumption of the analyzer's artifact.
  const phase2 = remoteMode ? await phase2Remote() : phase2Local();

  // ---- Freshness gate: the age of the NEWEST data point, not process state.
  // cycles are chronological here (newest last) — the slice/reverse happens
  // only when building the display payload below.
  const cyclesAll = paperBlock.journal.cycles;
  const lastCycleTs = cyclesAll.length ? cyclesAll[cyclesAll.length - 1].ts : "";
  const lastCycleMs =
    lastCycleTs && !Number.isNaN(new Date(lastCycleTs).getTime())
      ? new Date(lastCycleTs).getTime()
      : null;
  const dataAgeS =
    lastCycleMs !== null ? Math.max(0, (Date.now() - lastCycleMs) / 1000) : null;
  const runnerTsMs =
    paperBlock.runner.log_updated_at &&
    !Number.isNaN(new Date(paperBlock.runner.log_updated_at).getTime())
      ? new Date(paperBlock.runner.log_updated_at).getTime()
      : null;
  const auxAgeS =
    runnerTsMs !== null ? Math.max(0, (Date.now() - runnerTsMs) / 1000) : null;
  const dataStale = dataAgeS !== null ? dataAgeS > STALE_AFTER_S : null;
  const freshness = {
    data_age_s: dataAgeS === null ? null : Math.round(dataAgeS),
    expected_cycle_s: EXPECTED_CYCLE_S,
    stale_after_s: STALE_AFTER_S,
    stale: dataStale,
    status: dataAgeS === null ? "unknown" : dataStale ? "stale" : "fresh",
    checked_at: new Date().toISOString(),
    // remote: age of the paper-data branch tip; local: age of the runner log.
    branch_age_s: remoteMode ? (auxAgeS === null ? null : Math.round(auxAgeS)) : null,
    log_age_s: remoteMode ? null : auxAgeS === null ? null : Math.round(auxAgeS),
    // remote only: age of the hourly sandbox lifecycle snapshot (durability
    // push) — informational, expected hourly.
    lifecycle_age_s: remoteMode ? (paperBlock.lifecycle_age_s ?? null) : null,
  };

  const payload = {
    now: new Date().toISOString(),
    mode: remoteMode ? ("remote" as const) : ("local" as const),
    source: remoteMode
      ? {
          kind: "github-branch",
          detail:
            "paper-data branch: live collector cycles (~5 min) + hourly lifecycle snapshot",
        }
      : {
          kind: "sandbox-live",
          detail: "reading the funding-arb checkout directly · 10 s refresh",
        },
    freshness,
    repo,
    paper: {
      runner: paperBlock.runner,
      cycles: paperBlock.journal.cycles.slice(-24).reverse(),
      aborts: paperBlock.journal.aborts,
      totals: paperBlock.journal.totals,
      positions: paperBlock.positions,
      exits: paperBlock.exits,
      economics: paperBlock.economics,
    },
    backtest: paperBlock.analysis,
    phase2,
    pipeline: pipelineClean,
    plan: PLAN,
  };
  return NextResponse.json(payload);
}
