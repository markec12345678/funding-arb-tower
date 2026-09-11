/**
 * Hourly paper-data snapshot (Node runtime).
 *
 * The irreplaceable paper-validation dataset is the SANDBOX collector's
 * lifecycle data (journal.jsonl grows every 5 min; positions evolve with
 * opens/closes). The github-actions collector cannot see it (stateless,
 * separate machine) — so between manual snapshots it exists ONLY on this
 * sandbox's disk. This module closes that durability gap: every hour it runs
 * scripts/push-paper-snapshot.sh, which pushes a plumbing-based snapshot of
 * the lifecycle files to the GitHub `paper-data` branch without touching the
 * funding-arb working tree (the paper runner keeps running undisturbed).
 *
 * Same activation pattern as gh-heartbeat: side-effect-imported by the
 * /api/status route (hot-reloads in dev — activates in a running server) and
 * by instrumentation-node.ts (activates at next server boot). globalThis
 * guard = exactly one snapshot timer per process. State is persisted to
 * funding-arb/data/paper_snapshot.meta.json (separate file — deliberately NOT
 * paper_runner.meta.json, whose writer predates this module and clobbers
 * unknown fields until the next server reboot).
 */

import { execFile } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";

const g = globalThis as any;
// Sandbox-only module: the snapshot script pushes files from the local
// funding-arb checkout. Deployed environments (Vercel) have neither the
// checkout nor the script — import there must be a no-op, not hourly bash
// failures in a setInterval.
if (!g.__fundingArbPaperSnapshot && existsSync("/home/z/funding-arb")) {
  g.__fundingArbPaperSnapshot = true;

  const SCRIPT = "/home/z/my-project/scripts/push-paper-snapshot.sh";
  const META = "/home/z/funding-arb/data/paper_snapshot.meta.json";
  const INTERVAL_MS = 3_600_000;

  const state = { runs: 0, ok: 0, last_run: 0, last_ok: 0, last_result: "" };
  try {
    if (existsSync(META)) {
      const prev = JSON.parse(readFileSync(META, "utf-8"));
      Object.assign(state, {
        runs: prev.runs ?? 0,
        ok: prev.ok ?? 0,
        last_run: prev.last_run ?? 0,
        last_ok: prev.last_ok ?? 0,
        last_result: prev.last_result ?? "",
      });
    }
  } catch {
    /* fresh start */
  }

  const persist = () => {
    try {
      writeFileSync(META, JSON.stringify(state));
    } catch {
      /* non-fatal */
    }
  };

  const runSnapshot = () => {
    state.last_run = Date.now();
    state.runs += 1;
    execFile(
      "bash",
      [SCRIPT],
      { timeout: 120_000 },
      (err: Error | null, _stdout: string, stderr: string) => {
        if (err) {
          state.last_result = `error: ${String(err.message || err).slice(0, 120)} ${stderr.slice(0, 80)}`;
        } else {
          state.ok += 1;
          state.last_ok = Date.now();
          state.last_result = "pushed";
        }
        persist();
      }
    );
  };

  const tick = () => {
    if (Date.now() - state.last_run >= INTERVAL_MS) {
      runSnapshot();
    }
  };

  // first check immediately, then every 10 min (hourly throttle inside tick)
  tick();
  setInterval(tick, 600_000);
}
