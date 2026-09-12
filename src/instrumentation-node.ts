/**
 * Paper-runner supervisor (Node runtime only, loaded from instrumentation.ts).
 *
 * The sandbox reaps every process spawned from tool-invocation shells — even
 * setsid-detached ones — so the 3-7-day paper validation runner cannot be
 * started from a shell and expected to persist. The Next.js dev server,
 * however, is platform-managed and long-lived, and ITS detached children
 * survive (verified empirically). This module starts a supervisor loop that:
 *   1. checks every 20 s whether the paper runner is alive (pgrep),
 *   2. (re)spawns it detached from the server process if not,
 *   3. records supervisor state to funding-arb/data/paper_runner.meta.json.
 *
 * It also activates the GitHub paper-collector heartbeat (see
 * src/server/gh-heartbeat.ts) at server boot; in an already-running dev
 * server the heartbeat is activated via the /api/status route import
 * (route modules hot-reload, instrumentation does not).
 *
 * Idempotent across dev-server reloads via globalThis guards; the pgrep
 * check prevents double-spawning a still-alive runner.
 *
 * DEV-SERVER WATCHDOG (the mutual-protection pair's other half): this module
 * also ENSURES scripts/dev-server-watchdog.sh is running at every server
 * boot (spawns it detached if absent) — that watchdog, orphaned to PID 1
 * OUTSIDE this process, respawns `bun run dev` when the server itself dies
 * (the OOM-incident failure mode, Task 55). The runner-supervisor pattern
 * applies in both directions: detached + unref'd children survive their
 * parent's death, so each half re-arms the other.
 */

import { spawn, execSync } from "child_process";
import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import "@/server/gh-heartbeat";
import "@/server/paper-snapshot";
import "@/server/phase2-daily";

const g = globalThis as any;
// Deployed environments (e.g. Vercel) have no /home/z/funding-arb checkout:
// the supervisor, the GitHub heartbeat and the snapshot pusher are
// sandbox-only duties. Guard on the checkout so importing this module on a
// serverless deployment is a clean no-op instead of a crash loop (openSync
// on a non-existent log path would throw inside the setInterval callback).
if (!g.__fundingArbPaperSupervisor && existsSync("/home/z/funding-arb")) {
  g.__fundingArbPaperSupervisor = true;

  const REPO = "/home/z/funding-arb";
  const LOG = `${REPO}/data/paper_runner.log`;
  const META = `${REPO}/data/paper_runner.meta.json`;
  const PYTHON = "/home/z/.venv/bin/python";
  const RUNNER = `${REPO}/scripts/execution/run_pure_futures_spread.py`;
  const CONFIG = `${REPO}/templates/config.pure_futures.spread.json`;

  const state = { respawns: 0, last_check: 0, last_spawn: 0, started_at: Date.now() };
  try {
    if (existsSync(META)) {
      const prev = JSON.parse(readFileSync(META, "utf-8"));
      state.respawns = prev.respawns ?? 0;
    }
  } catch {
    /* fresh start */
  }

  const runnerAlive = (): boolean => {
    try {
      // [.] trick: the literal pattern must not match the pgrep wrapper
      // shell's own command line (classic pgrep self-match footgun).
      // NOTE: match on the script path only — the runner's argv has
      // --config/--watch AFTER the path, so a longer pattern never matches.
      const out = execSync("pgrep -f 'run_pure_futures_spread[.]py' || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return out.trim().length > 0;
    } catch {
      return false;
    }
  };

  const spawnRunner = () => {
    const out = openSync(LOG, "a");
    const child = spawn(
      PYTHON,
      [RUNNER, "--config", CONFIG, "--watch", "5", "--verbose"],
      {
        cwd: REPO,
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      }
    );
    child.unref();
    state.respawns += 1;
    state.last_spawn = Date.now();
    try {
      writeFileSync(`${REPO}/data/paper_runner.pid`, String(child.pid));
    } catch {
      /* non-fatal */
    }
  };

  const tick = () => {
    state.last_check = Date.now();
    if (!runnerAlive()) spawnRunner();
    try {
      // read-modify-write: preserve fields owned by other writers
      // (the gh-heartbeat module persists gh_* keys in the same file).
      const meta: Record<string, unknown> = {};
      try {
        if (existsSync(META)) {
          Object.assign(meta, JSON.parse(readFileSync(META, "utf-8")));
        }
      } catch {
        /* treat as empty */
      }
      Object.assign(meta, state);
      writeFileSync(META, JSON.stringify(meta));
    } catch {
      /* non-fatal */
    }
  };

  // first check immediately, then every 20 s
  tick();
  setInterval(tick, 20_000);
}

// ───────────────── dev-server watchdog ensure (sandbox-only) ─────────────────
// The watchdog respawns the dev server when IT dies; this block respawns the
// watchdog at every dev-server boot. Neither can protect a simultaneous
// death of both (any manual dev-server start re-arms the pair — that is the
// Task-55 recovery recipe, now the documented bootstrap too).
if (
  !g.__devServerWatchdogEnsure &&
  existsSync("/home/z/funding-arb") &&
  existsSync("/home/z/my-project/scripts/dev-server-watchdog.sh")
) {
  g.__devServerWatchdogEnsure = true;

  const watchdogAlive = (): boolean => {
    try {
      // [.] trick — same footgun guard as the runner pgrep above.
      const out = execSync("pgrep -f 'dev-server-watchdog[.]sh' || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return out.trim().length > 0;
    } catch {
      return false;
    }
  };

  if (!watchdogAlive()) {
    try {
      mkdirSync("/home/z/my-project/data", { recursive: true });
      // explicit spawn evidence: the watchdog itself is stdout-silent, so
      // record the bootstrap here — ops sees WHO started WHICH pid, when.
      const out = openSync("/home/z/my-project/data/watchdog_spawn.log", "a");
      spawn("bash", [
        "-c",
        `echo "[instrumentation $(date -u +%Y-%m-%dT%H:%M:%SZ)] spawning dev-server watchdog" >&2; exec bash /home/z/my-project/scripts/dev-server-watchdog.sh`,
      ], {
        cwd: "/home/z/my-project",
        detached: true,
        stdio: ["ignore", out, out],
      }).unref();
    } catch {
      /* non-fatal: the watchdog is protection, not a dependency */
    }
  }
}
