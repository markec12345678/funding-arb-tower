/**
 * GitHub paper-collector heartbeat (Node runtime).
 *
 * Fires a repository_dispatch "paper-cycle" at GitHub at most every 5 minutes,
 * which triggers the funding-arb `paper-collector` workflow on GitHub's own
 * runners and appends a journal cycle to the `paper-data` branch. This makes
 * GitHub-side collection independent of the fork's cron-schedule registration
 * (which lags on public forks) — repository_dispatch fires immediately.
 *
 * The heartbeat is a separate module (not inline in instrumentation) so it can
 * be activated in an ALREADY-RUNNING dev server: route modules hot-reload in
 * dev, and this module is side-effect-imported by the /api/status route. At
 * the next server boot, instrumentation-node.ts imports it too. The
 * globalThis guard guarantees exactly one heartbeat per server process
 * regardless of how many module copies get evaluated.
 *
 * The GitHub token is read at runtime from the funding-arb git remote
 * (pushurl embeds the PAT) — it is never hardcoded in any source file.
 */

import { execSync } from "child_process";
import { openSync, closeSync, writeFileSync, readFileSync, existsSync } from "fs";

const g = globalThis as any;
// Sandbox-only module: outside the sandbox (e.g. deployed on Vercel) there is
// no funding-arb checkout and no PAT to read — importing this module there
// must be a clean no-op, not a 20 s interval that fails forever.
if (!g.__fundingArbGhHeartbeat && existsSync("/home/z/funding-arb")) {
  g.__fundingArbGhHeartbeat = true;

  const REPO = "/home/z/funding-arb";
  const META = `${REPO}/data/paper_runner.meta.json`;
  const GH_LOG = `${REPO}/data/gh_heartbeat.log`;
  const GH_REPO_API =
    "https://api.github.com/repos/markec12345678/funding-arb/dispatches";
  const GH_INTERVAL_MS = 300_000;

  const gh: {
    dispatches: number;
    last_dispatch: number;
    last_result: string;
  } = { dispatches: 0, last_dispatch: 0, last_result: "" };
  try {
    if (existsSync(META)) {
      const prev = JSON.parse(readFileSync(META, "utf-8"));
      gh.dispatches = prev.gh_dispatches ?? 0;
      gh.last_dispatch = prev.gh_last_dispatch ?? 0;
      gh.last_result = prev.gh_last_result ?? "";
    }
  } catch {
    /* fresh start */
  }

  const readMeta = (): Record<string, unknown> => {
    try {
      if (existsSync(META)) return JSON.parse(readFileSync(META, "utf-8"));
    } catch {
      /* fall through */
    }
    return {};
  };

  const persistGh = () => {
    try {
      const meta = readMeta();
      meta.gh_dispatches = gh.dispatches;
      meta.gh_last_dispatch = gh.last_dispatch;
      meta.gh_last_result = gh.last_result;
      writeFileSync(META, JSON.stringify(meta));
    } catch {
      /* non-fatal */
    }
  };

  const logGh = (line: string) => {
    try {
      const fd = openSync(GH_LOG, "a");
      writeFileSync(fd, `${new Date().toISOString()} ${line}\n`);
      closeSync(fd);
    } catch {
      /* non-fatal */
    }
  };

  const ghToken = (): string | null => {
    try {
      const url = execSync("git config --get remote.origin.pushurl", {
        cwd: REPO,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const m = url.match(/^https:\/\/([^@/]+)@github\.com/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  };

  const dispatchGithubCycle = async () => {
    const tok = ghToken();
    if (!tok) {
      gh.last_result = "no-token";
      return;
    }
    // set optimistically BEFORE the await: a failing tick must not re-fire
    // every 20 s afterwards (5-min throttle on failures too).
    gh.last_dispatch = Date.now();
    try {
      const res = await fetch(GH_REPO_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "funding-arb-paper-heartbeat",
        },
        body: JSON.stringify({ event_type: "paper-cycle" }),
        signal: AbortSignal.timeout(20_000),
      });
      gh.dispatches += 1;
      gh.last_result = `http ${res.status}`;
      logGh(`dispatch http ${res.status}`);
    } catch (e) {
      gh.last_result = `error ${String(e).slice(0, 100)}`;
      logGh(gh.last_result);
    }
    persistGh();
  };

  const tick = () => {
    if (Date.now() - gh.last_dispatch >= GH_INTERVAL_MS) {
      void dispatchGithubCycle().catch(() => {});
    }
  };

  // first check immediately, then every 20 s
  tick();
  setInterval(tick, 20_000);
}
