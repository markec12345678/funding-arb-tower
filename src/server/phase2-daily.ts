/**
 * Daily Phase-2 verify-only check (Node runtime).
 *
 * The Phase-2 discipline requires a DAILY read-only analyzer run
 * (funding-arb scripts/analysis/phase2_report.py — locked framework). Until
 * now that run was manual: it happened exactly when an operator session was
 * active, so the discipline had a single point of failure — a day without a
 * session meant a stale report-latest.json, an overdue flag, and a Day-3 /
 * Day-7 interim read that waited for the next session. This module closes
 * that gap the same way the other tower lanes do: it runs the analyzer at
 * most once per 24 h, from this long-lived dev-server process.
 *
 * The analyzer is read-only by construction (its own docstring: never writes
 * into the live runner state, only into its gitignored output dir
 * scripts/data/phase2/; the only remote interactions are a git fetch of the
 * paper-data branch and cached funding-history reads). Running it does not
 * touch the funding-arb lock: the working tree stays clean.
 *
 * Same activation pattern as gh-heartbeat / paper-snapshot: side-effect
 * import from the /api/status route (hot-reloads in dev — activates in a
 * running server) and from instrumentation-node.ts (next server boot).
 * globalThis guard = exactly one lane per process.
 *
 * State is persisted to funding-arb/data/phase2_check.meta.json — its OWN
 * file, deliberately not paper_runner.meta.json (the patrol writer predates
 * field-preservation discipline there) and not paper_snapshot.meta.json
 * (that lane's state). First activation seeds from the existing
 * report-latest.json mtime when one is present, so a fresh lane does not
 * immediately re-run an analyzer that a manual session already ran today.
 */

import { execFile } from "child_process";
import { writeFileSync, readFileSync, existsSync, statSync } from "fs";

const g = globalThis as any;
// Sandbox-only module: the analyzer lives in the local funding-arb checkout
// and there is no venv on a serverless deployment — importing this module
// there must be a no-op, not a daily python failure in a setInterval.
if (!g.__fundingArbPhase2Daily && existsSync("/home/z/funding-arb")) {
  g.__fundingArbPhase2Daily = true;

  const REPO = "/home/z/funding-arb";
  const PYTHON = "/home/z/.venv/bin/python";
  const SCRIPT = `${REPO}/scripts/analysis/phase2_report.py`;
  const REPORT = `${REPO}/scripts/data/phase2/report-latest.json`;
  const META = `${REPO}/data/phase2_check.meta.json`;

  const INTERVAL_MS = 24 * 3_600_000; // the discipline: one check per day
  const RETRY_MS = 3_600_000; // a failed run retries after 1 h, not 24 h
  const TICK_MS = 10 * 60_000; // re-check every 10 min (24h throttle inside)

  const state = {
    runs: 0,
    ok: 0,
    last_run: 0,
    last_ok: 0,
    last_result: "",
    seeded_at: 0,
  };

  const persist = () => {
    try {
      writeFileSync(META, JSON.stringify(state));
    } catch {
      /* non-fatal */
    }
  };

  // First activation: seed from the existing report so the lane does not
  // re-run an analyzer that a manual session already ran today.
  if (!existsSync(META)) {
    if (existsSync(REPORT)) {
      const mtimeMs = safe(() => statSync(REPORT).mtimeMs, 0);
      state.last_run = mtimeMs;
      state.last_ok = mtimeMs;
      state.last_result = "seeded (pre-automation run)";
      state.seeded_at = Date.now();
      persist();
    }
  } else {
    try {
      const prev = JSON.parse(readFileSync(META, "utf-8"));
      state.runs = prev.runs ?? 0;
      state.ok = prev.ok ?? 0;
      state.last_run = prev.last_run ?? 0;
      state.last_ok = prev.last_ok ?? 0;
      state.last_result = prev.last_result ?? "";
      state.seeded_at = prev.seeded_at ?? 0;
    } catch {
      /* fresh start */
    }
  }

  function safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  let inFlight = false;

  const runCheck = () => {
    inFlight = true;
    state.last_run = Date.now();
    state.runs += 1;
    execFile(
      PYTHON,
      [SCRIPT],
      { cwd: REPO, timeout: 900_000 },
      (err: Error | null, _stdout: string, stderr: string) => {
        inFlight = false;
        if (err) {
          state.last_result = `error: ${String(err.message || err).slice(0, 120)} ${stderr.slice(0, 80)}`.trim();
        } else {
          state.ok += 1;
          state.last_ok = Date.now();
          state.last_result = "ok";
        }
        persist();
      }
    );
  };

  const tick = () => {
    if (inFlight) return;
    const lastIsHealthyResult =
      state.last_result === "ok" || state.last_result.startsWith("seeded");
    // due = 24 h since the last successful check; a FAILED run retries after
    // 1 h (a broken lane must not go quiet for a day — it retries visibly).
    const anchor = lastIsHealthyResult ? state.last_ok : state.last_run;
    const due = lastIsHealthyResult ? INTERVAL_MS : RETRY_MS;
    if (Date.now() - anchor >= due) {
      runCheck();
    }
  };

  // first check immediately, then every 10 min
  tick();
  setInterval(tick, TICK_MS);
}
