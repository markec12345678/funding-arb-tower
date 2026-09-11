# funding-arb · command center (tower)

Live operations dashboard for the [funding-arb](https://github.com/markec12345678/funding-arb)
paper-validation pipeline: backtest verdict, the paper-trading funnel, runner
health, the delivery pipeline (GitHub · Vercel · snapshots) and the phase-3
execution-safety certification — all in one page that refreshes every 10 s.

![desktop](./data-dashboard-desktop.png)

*Built with Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui.
Deployable to Vercel with zero configuration and zero environment variables.*

---

## The system it watches

This dashboard is one of three coordinated repositories:

| repo | role | state |
|---|---|---|
| [`funding-arb`](https://github.com/markec12345678/funding-arb) | the trading system — scanner, strategy, executor, gates | **locked** at `0373f5d` during Phase-2 A/B/C paper validation (539 tests, CI green) |
| [`phase3-lab`](https://github.com/markec12345678/phase3-lab) | execution-safety laboratory — 4-layer separation, formal safety gate | **certified**: 106/106 tests (foundation 80 · reconciliation 19 · risk guardian 23 · cross-layer 13), golden contract v1.1.0, PORT CANDIDATE — port blocked by Phase-2 verdict |
| **funding-arb-tower** (this repo) | command center — reads the pipeline, never trades | runs sandbox-local and/or deployed |

The validation ladder the dashboard reflects:

```
P0 hardening ✓ → 30d backtest ✓ (0 trades, fee gate) → E2E paper-flow ✓
  → Phase 2: paper validation A/B/C          [ACTIVE — day-3 interim, day-5–7 final]
  → Phase 3: execution-safety lab            [CERTIFIED — cross-layer gate green]
  → production port of the safety layer      [BLOCKED by Phase-2 A/B/C]
  → minimal real-money test                  [pending everything above]
```

## Two data modes — one payload

`GET /api/status` returns the **same payload shape** from two very different
data planes, chosen automatically:

| | `mode: "local"` (sandbox) | `mode: "remote"` (deployed) |
|---|---|---|
| funnel · positions | read directly from the `/home/z/funding-arb` checkout (sandbox runner) | **live collector cycles + positions** from `paper-data/github-actions/*` (updated every ~5 min) |
| backtest · runner log | local files | hourly lifecycle snapshot at the `paper-data` branch root |
| runner liveness | `pgrep` + pidfile + log mtime | freshness of the collector's newest cycle on the branch |
| repo commits | local `git log` | GitHub REST API |
| latency | ~50 ms | cold ~1–6 s, then cached (60 s raw / 300 s API TTL, ETag revalidation) |

The mode is shown in the UI (`sandbox live` / `github branch` badge) and can
be forced for verification — on the API or on the whole page:

```bash
curl "http://localhost:3000/api/status?source=remote"   # API payload
open "http://localhost:3000/?source=remote"              # full dashboard in remote mode
```

The GitHub API client uses ETag conditional requests — 304 responses are free
against the rate limit — and optionally picks up a PAT from the funding-arb
git remote at runtime (sandbox only). Deployed, it runs fully unauthenticated
against public data: **no environment variables, no secrets in this repo.**

### How the remote data stays fresh

```
sandbox paper runner (5-min cycles)
   └─ journal.jsonl / positions.json ── hourly snapshot push ──► paper-data/ (branch root)
github-actions collector (repository_dispatch heartbeat, every 5 min)
   └─ live cycles + positions ─────────────────────────────► paper-data/github-actions/*
funding-arb-tower (deployed)
   └─ funnel + ledger from the collector files (live),
      backtest + log from the hourly snapshot
```

### Staleness gate (why green means the data is live)

The pipeline's weakest point is that its liveness depends on *other* things
running: the sandbox runner, the github-actions collector, and — for the
[Vercel demo](https://funding-arb-dun.vercel.app) — an **external**
cron-job.org trigger. If any of them dies, every box can still look green
while serving stale data. The dashboard therefore never infers health from
process state alone:

- `freshness.data_age_s` — the age of the **newest data point** (newest
  journal cycle). A new cycle is expected every 5 min; after 15 min without
  one the whole status pill goes **RED** (`data stale · Xm old`) even while
  the runner pid still exists. No data at all → `unknown`.
- `freshness.lifecycle_age_s` (remote) — age of the hourly sandbox lifecycle
  snapshot, tracked separately.
- `pipeline.snapshot.age_s` — age of the `gh-pages` scanner snapshot that
  feeds the Vercel demo (hourly, external cron). Stale → a red
  `SNAPSHOT STALE` badge — this is the detector for a dead cron-job.org
  schedule.

Verified both ways: lowering the thresholds makes a live-runner dashboard go
red immediately; restoring them returns it to green.

## What runs where

The repo is **portable by construction** — every sandbox-only duty is guarded
by an `existsSync("/home/z/funding-arb")` check and degrades to a no-op
elsewhere:

- `src/instrumentation-node.ts` — **paper-runner supervisor** (sandbox only):
  re-spawns the Python paper runner if it dies, records supervisor state.
  On Vercel: imported, guard fails, nothing happens.
- `src/server/gh-heartbeat.ts` — fires a `repository_dispatch "paper-cycle"`
  at GitHub at most every 5 min so the stateless github-actions collector
  runs on GitHub's own runners (sandbox only).
- `src/server/paper-snapshot.ts` — hourly durability push of the lifecycle
  dataset (journal, positions, config, logs) to the `paper-data` branch via
  git plumbing — the funding-arb working tree is never touched (sandbox only).
- `src/app/api/status/route.ts` — the status API (both modes, see above).
- `src/app/page.tsx` — the dashboard (client component, 10 s polling).
- `scripts/push-paper-snapshot.sh` — the plumbing-based snapshot pusher.

## Quickstart

```bash
bun install
bun run dev        # http://localhost:3000
bun run lint       # eslint
```

Copy `.env.example` to `.env` if you want the (unused-by-this-app) Prisma
datasource wired up.

## Deploy to Vercel

1. Push this repo to GitHub (or fork it).
2. In Vercel: **Add New → Project → import the repo**.
   Framework preset **Next.js** is auto-detected; the build command is a
   plain `next build` — no environment variables needed.
3. Open the deployment: the dashboard comes up in `remote` mode
   (GitHub-branch data plane — live collector cycles) because no
   `/home/z/funding-arb` checkout exists on the serverless runtime.

That is the whole setup — the remote mode is read-only over public GitHub
data, so there is nothing to configure and nothing that can leak.

## API

### `GET /api/status[?source=remote]`

Example values below are illustrative (`12345`, `42`, …) — the real payload
carries live runtime numbers.

```jsonc
{
  "now": "…ISO…",
  "mode": "local" | "remote",
  "source": { "kind": "sandbox-live" | "github-branch", "detail": "…" },
  "freshness": {                      // the staleness gate — see above
    "data_age_s": 42,                 // age of the NEWEST journal cycle
    "expected_cycle_s": 300,
    "stale_after_s": 900,
    "stale": false,
    "status": "fresh",                // fresh | stale | unknown
    "branch_age_s": null,             // remote: paper-data tip age
    "log_age_s": 480,                 // local: runner log age
    "lifecycle_age_s": null           // remote: hourly snapshot age
  },
  "repo":   { "branch": "main", "commits": [ { "sha": "0373f5d", "message": "…" } ], "dirty": false },
  "paper": {
    "runner":  { "alive": true, "pid": 12345, "log_updated_at": "…", "log_tail": ["…"], "supervisor": { } },
    "cycles":  [ { "ts": "…", "scan_total": 2419, "candidates": 5, "opens": 1, "open_simulated": 0, "open_aborted": 1, "open_positions": 6 } ],
    "aborts":  [ { "reason": "order-book depth gate", "count": 12 } ],
    "totals":  { "cycles": 42, "scan_total": 101530, "…": "…" },
    "positions": [ { "id": "…", "base": "RVN", "long_venue": "binance", "short_venue": "bybit", "status": "open" } ]
  },
  "backtest": { "fee_gate": { "best_spread_pct": 0.0218, "…": "…" } },
  "pipeline": {
    "github":  { "repo": "markec12345678/funding-arb", "pushed_at": "…", "ci": "…" },
    "phase3":  { "latest": { "sha": "5581abc", "message": "…" }, "tests": "106/106 (…)", "status": "cross-layer CERTIFIED — port candidate BLOCKED by Phase-2 A/B/C" },
    "vercel":  { "url": "https://funding-arb-dun.vercel.app", "healthy": true },
    "snapshot":{ "source": "raw.githubusercontent.com/…/scanner-latest.json",
                 "generated_at": "…", "age_s": 1800, "expected_s": 3600,
                 "stale": false, "status": "fresh" }
  },
  "plan": [ { "step": "P0 hardening: …", "state": "done" }, { "step": "Phase 2: live paper validation A/B/C", "state": "active" } ]
}
```

## Repo layout

```
src/
  app/
    page.tsx                  # the dashboard (client, 10 s polling)
    layout.tsx                # metadata + fonts
    api/status/route.ts       # the status API — local/remote dual data plane
  server/
    gh-heartbeat.ts           # 5-min repository_dispatch heartbeat (sandbox-only)
    paper-snapshot.ts         # hourly paper-data push (sandbox-only)
  instrumentation-node.ts     # paper-runner supervisor (sandbox-only, guarded)
scripts/
  push-paper-snapshot.sh      # git-plumbing snapshot pusher
db/  prisma/                  # INERT template scaffolding — no route imports
                              # @/lib/db; delete freely (kept only because the
                              # sandbox tooling references it)
```

> **Note on Prisma:** the dashboard itself never touches a database — it is a
> read-only observer over files, git and the GitHub API. The `db/`, `prisma/`
> directories, the `@prisma/client` dependency and the `db:*` scripts are
> leftover scaffolding from the underlying Next.js template and can be
> removed without affecting anything. The "zero configuration" claim refers
> to the running app: no route reads `DATABASE_URL`.

## Status

- funding-arb: **locked at `0373f5d`**, paper validation running (Phase 2).
- phase3-lab: **cross-layer certification COMPLETE** — port candidate.
- Production port: **BLOCKED until the Phase-2 A/B/C verdict**.
- This dashboard: runs sandbox-local, deploys to Vercel unconfigured.

## Disclaimer

Educational / research tooling around funding-rate arbitrage — not financial
advice. The dashboard is strictly read-only: it observes the pipeline, it
never places, simulates or approves trades.
