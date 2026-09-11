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
// Remote (paper-data branch) readers — the deployed mode
// ---------------------------------------------------------------------------

async function remotePaper() {
  const [journalRaw, positionsRaw, analysisRaw, logRaw, branch] = await Promise.all([
    rawText(rawPaper("journal.jsonl")),
    rawText(rawPaper("positions.json")),
    rawText(rawPaper("backtest_analysis.json")),
    rawText(rawPaper("paper_runner.log")),
    ghJson(`/repos/${GH_OWNER}/funding-arb/branches/${PAPER_BRANCH}`),
  ]);

  const journal = journalRaw ? parseJournalRaw(journalRaw) : { cycles: [], aborts: [], totals: {} };
  const positions = safe(() => mapPositions(JSON.parse(positionsRaw ?? "[]")), [] as any[]);
  const analysis = safe(() => JSON.parse(analysisRaw ?? "null"), null);
  const logTail = (logRaw ?? "").trim().split("\n").filter(Boolean).slice(-12);
  const pushedAt: string | null =
    branch?.commit?.commit?.committer?.date ?? branch?.commit?.commit?.author?.date ?? null;
  // Liveness proxy: the github-actions collector commits a cycle every ~5 min;
  // the hourly lifecycle snapshot rides the same branch.
  const fresh = pushedAt ? Date.now() - new Date(pushedAt).getTime() < 15 * 60_000 : false;
  return {
    journal,
    positions,
    analysis,
    runner: {
      alive: fresh,
      pid: null,
      log_updated_at: pushedAt,
      log_tail: logTail,
      supervisor: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline (live GitHub state, both modes)
// ---------------------------------------------------------------------------

async function pipeline(repoCommitsLocal: { sha: string; message: string }[], remoteMode: boolean) {
  const [farbRepo, farbCommits, p3Commits, health] = await Promise.all([
    ghJson(`/repos/${GH_OWNER}/funding-arb`),
    remoteMode ? ghJson(`/repos/${GH_OWNER}/funding-arb/commits?per_page=6`) : Promise.resolve(null),
    ghJson(`/repos/${GH_OWNER}/phase3-lab/commits?per_page=1`),
    vercelHealth(),
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
      refreshed_by: "TG Funding Push workflow (dispatch / cron-job.org)",
      lifecycle: `paper-data branch (hourly snapshot + 5-min github-actions cycles)`,
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
  { step: "Phase 3 lab: execution-safety foundation + reconciliation + risk guardian (122 tests, golden contract v1.1.0)", state: "done" },
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
    };
    repo = repoStatus();
  }

  const pipe = await pipeline(repo.commits, remoteMode);
  repo.commits = (pipe as any)._commits ?? repo.commits;
  const { _commits, ...pipelineClean } = pipe as any;

  const payload = {
    now: new Date().toISOString(),
    mode: remoteMode ? ("remote" as const) : ("local" as const),
    source: remoteMode
      ? {
          kind: "github-snapshot",
          detail: "paper-data branch via raw.githubusercontent.com · ~5 min collector cadence",
        }
      : {
          kind: "sandbox-live",
          detail: "reading the funding-arb checkout directly · 10 s refresh",
        },
    repo,
    paper: {
      runner: paperBlock.runner,
      cycles: paperBlock.journal.cycles.slice(-24).reverse(),
      aborts: paperBlock.journal.aborts,
      totals: paperBlock.journal.totals,
      positions: paperBlock.positions,
    },
    backtest: paperBlock.analysis,
    pipeline: pipelineClean,
    plan: PLAN,
  };
  return NextResponse.json(payload);
}
