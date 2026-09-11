import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import type { EngineOverview } from "@/lib/engine-types";

// quant-arb-engine monitor — READ-ONLY.
// The tower observes the engine exactly the way it observes funding-arb: it
// never writes, never triggers runs, never holds engine state. Data plane:
// local sandbox checkout first (fresh, includes uncommitted sweeps), GitHub
// raw fallback second (Vercel / demo mode). Artifacts are SYNTHETIC paper
// diagnostics — the response always carries that context via the artifacts
// themselves (notes.epistemic_note).
export const dynamic = "force-dynamic";

const ENGINE_DIR = "/home/z/quant-arb-engine";
const ARTIFACTS = path.join(ENGINE_DIR, "research", "artifacts");

const GH_OWNER = "markec12345678";
const GH_REPO = "quant-arb-engine";
const GH_BRANCH = "main";
const GH_RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/research/artifacts`;
const GH_REPO_URL = `https://github.com/${GH_OWNER}/${GH_REPO}`;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readJsonSafe(p: string): unknown {
  return safe(() => JSON.parse(readFileSync(p, "utf8")) as unknown, null);
}

function git(args: string): string | null {
  return safe(
    () => execSync(`git -C ${ENGINE_DIR} ${args}`, { encoding: "utf8", timeout: 5000 }).trim(),
    null,
  );
}

// ---- remote mode: local-memory cache (60 s), the tower's caching policy ----
const REMOTE_TTL_MS = 60_000;
let remoteCache: { at: number; data: EngineOverview } | null = null;

async function fetchRemoteJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as unknown;
  } catch {
    return null;
  }
}

async function remoteOverview(): Promise<EngineOverview> {
  const [sweep, latestRun, commit] = await Promise.all([
    fetchRemoteJson(`${GH_RAW}/sweep-latest.json`),
    fetchRemoteJson(`${GH_RAW}/run-latest.json`),
    fetchRemoteJson(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/commits/${GH_BRANCH}`),
  ]);
  const c = commit as { sha?: string; commit?: { message?: string; author?: { date?: string } } } | null;
  const version =
    ((sweep as { engine_version?: string } | null)?.engine_version ??
      (latestRun as { engine_version?: string } | null)?.engine_version) ??
    null;
  return {
    now: new Date().toISOString(),
    mode: "remote",
    source: {
      kind: "github-raw",
      detail: `raw.githubusercontent.com · ${GH_OWNER}/${GH_REPO}@${GH_BRANCH} (60 s cache)`,
    },
    repo: {
      url: GH_REPO_URL,
      branch: GH_BRANCH,
      commit: c?.sha ? c.sha.slice(0, 7) : null,
      commit_msg: c?.commit?.message?.split("\n")[0] ?? null,
      commit_date: c?.commit?.author?.date ?? null,
      dirty: null,
      version,
    },
    latest_run: (latestRun as EngineOverview["latest_run"]) ?? null,
    sweep: (sweep as EngineOverview["sweep"]) ?? null,
    artifacts: {
      run_latest: latestRun !== null,
      sweep_latest: sweep !== null,
      run_age_s: null,
      sweep_age_s: null,
    },
  };
}

export async function GET() {
  const isLocal = safe(() => existsSync(path.join(ENGINE_DIR, ".git")), false);

  if (!isLocal) {
    if (remoteCache && Date.now() - remoteCache.at < REMOTE_TTL_MS) {
      return NextResponse.json(remoteCache.data);
    }
    const data = await remoteOverview();
    remoteCache = { at: Date.now(), data };
    return NextResponse.json(data);
  }

  // ---- local mode: fresh read of the sandbox checkout ----
  const runPath = path.join(ARTIFACTS, "run-latest.json");
  const sweepPath = path.join(ARTIFACTS, "sweep-latest.json");
  const latestRun = readJsonSafe(runPath);
  const sweep = readJsonSafe(sweepPath);
  const ageOf = (p: string): number | null =>
    safe(() => (Date.now() - statSync(p).mtimeMs) / 1000, null);
  const version = safe(() => {
    const toml = readFileSync(path.join(ENGINE_DIR, "pyproject.toml"), "utf8");
    const m = toml.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  }, null);

  const data: EngineOverview = {
    now: new Date().toISOString(),
    mode: "local",
    source: {
      kind: "sandbox-checkout",
      detail: `${ENGINE_DIR} · research/artifacts read directly (read-only)`,
    },
    repo: {
      url: GH_REPO_URL,
      branch: safe(() => git("rev-parse --abbrev-ref HEAD"), null) ?? "main",
      commit: git("rev-parse --short HEAD"),
      commit_msg: git("log -1 --pretty=%s"),
      commit_date: git("log -1 --pretty=%cI"),
      dirty: safe(() => (git("status --porcelain") ?? "").length > 0, false),
      version,
    },
    latest_run: (latestRun as EngineOverview["latest_run"]) ?? null,
    sweep: (sweep as EngineOverview["sweep"]) ?? null,
    artifacts: {
      run_latest: latestRun !== null,
      sweep_latest: sweep !== null,
      run_age_s: ageOf(runPath),
      sweep_age_s: ageOf(sweepPath),
    },
  };
  return NextResponse.json(data);
}
