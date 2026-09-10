import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";

// Side-effect imports: activate the GitHub paper-collector heartbeat and the
// hourly paper-data snapshot inside this (long-lived) dev-server process.
// Route modules hot-reload in dev, so this is the activation path for an
// already-running server; at server boot instrumentation-node.ts activates
// them as well. Both are guarded by globalThis — one instance per process.
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

function parseJournal(): { cycles: JournalCycle[]; aborts: AbortReason[]; totals: Record<string, number> } {
  if (!existsSync(JOURNAL)) return { cycles: [], aborts: [], totals: {} };
  const raw = readFileSync(JOURNAL, "utf-8").trim();
  if (!raw) return { cycles: [], aborts: [], totals: {} };
  const lines = raw.split("\n").slice(-120); // last ~10h at 5-min cycles
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
    const rows = JSON.parse(readFileSync(POSITIONS, "utf-8"));
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
  }, [] as any[]);
}

export async function GET() {
  const journal = parseJournal();
  const analysis = safe(() => JSON.parse(readFileSync(ANALYSIS, "utf-8")), null);
  const payload = {
    now: new Date().toISOString(),
    repo: repoStatus(),
    paper: {
      runner: runnerStatus(),
      cycles: journal.cycles.slice(-24).reverse(),
      aborts: journal.aborts,
      totals: journal.totals,
      positions: paperPositions(),
    },
    backtest: analysis,
    pipeline: {
      github: {
        repo: "markec12345678/funding-arb",
        url: "https://github.com/markec12345678/funding-arb",
        default_branch: "main",
        branches: ["main", "p0-hardening", "gh-pages", "feat/risk-engine-wiring", "upgrade/risk-profit-engine"],
        ci: "539 tests, matrix ubuntu+windows, dispatched green; nightly 03:07 UTC",
      },
      vercel: {
        project: "funding-arb",
        url: "https://funding-arb-dun.vercel.app",
        status: "READY (vite/web, SSO removed, own gh-pages snapshot)",
      },
      snapshot: {
        source: "raw.githubusercontent.com/markec12345678/funding-arb/gh-pages/scanner-latest.json",
        refreshed_by: "TG Funding Push workflow (dispatch / cron-job.org)",
      },
    },
    plan: [
      { step: "P0 hardening: auth, atomic persistence, fail-closed margin, pre-submit recheck, fee-aware exit", state: "done" },
      { step: "Diff + test/CI verification (535 -> 539 green; CI green on GitHub runners)", state: "done" },
      { step: "30d backtest BTC/ETH/SOL (4 CEX + HL): 0 executable trades, fee gate kills all 27,876 rows", state: "done" },
      { step: "E2E paper-flow integration test (scanner -> strategy -> recheck -> executor -> state -> watcher -> exit)", state: "done" },
      { step: "Live scanner + paper execution 3-7 days (runner live, gates active in paper mode)", state: "active" },
      { step: "Backtest vs paper comparison", state: "pending" },
      { step: "Minimal real-money test (1 pair, smallest notional, manual supervision)", state: "pending" },
    ],
  };
  return NextResponse.json(payload);
}
