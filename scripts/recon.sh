#!/usr/bin/env bash
# Operator recon — the canonical round-start state check for funding-arb-tower.
#
# WHY THIS EXISTS: every operator round (human or agent) used to re-derive the
# recon commands from memory — and context-reset sessions hit the predictable
# traps: the tower repo lives at /home/z/my-project (there is NO
# /home/z/funding-arb-tower directory), the status API key is `supervisors`
# (a dict of three, not `supervisor`), the lane metas live inside the
# funding-arb repo's data/ (written by tower code, read by everyone). This
# script encodes the paths and the parsing ONCE, so every round starts
# identical, and a fresh session never guesses again.
#
# READ-ONLY GUARANTEE: queries localhost APIs, reads files, reads git state
# via `git -C`. It never writes, never spawns, never trades. Safe any time.
#
# VISIBLE FAILURE: set -uo pipefail WITHOUT -e on purpose — a recon script
# must not die at the first missing piece; each section prints its own ERROR
# line so a degraded sandbox is SEEN degraded, not silently skipped.
#
# EXIT CODE: 0 = everything green · 1 = something needs eyes (the script's
# own output says what). Built for a future watch/cron if one is ever wanted.
#
# The phase2 lane next-fire computation MIRRORS src/server/phase2-daily.ts's
# tick gate (anchor = last_ok when last_result is ok/seeded, else last_run;
# 24 h healthy interval, 1 h failed-retry). If that gate changes, update the
# mirror here in the same commit.

set -uo pipefail

TOWER=/home/z/my-project
ENGINE=/home/z/quant-arb-engine
FARB=/home/z/funding-arb
API=http://localhost:3000/api/status
# funding-arb is code-frozen @ 0373f5d until the Phase-2 A/B/C decision
# (~2026-09-17T14:36Z). After A/B/C, update or remove this expectation.
LOCK_SHA=0373f5d
PHASE2_META="$FARB/data/phase2_check.meta.json"
RUNNER_META="$FARB/data/paper_runner.meta.json"

DEGRADED=0
REASONS=()
degrade() { DEGRADED=1; REASONS+=("$1"); }
now_epoch=$(date +%s)

hr() { printf '\n── %s ──\n' "$1"; }
# countdown <target_epoch_s> <label>
countdown() {
  local target=$1 label=$2 diff
  diff=$(( target - now_epoch ))
  if [ "$diff" -le 0 ]; then
    printf '  %-22s PAST DUE by %s\n' "$label" "$(fmt_age $(( -diff )))"
    degrade "$label past due"
  else
    printf '  %-22s in %s\n' "$label" "$(fmt_age "$diff")"
  fi
}
# fmt_age <seconds> → "3d 4h" / "5h 06m" / "42m"
fmt_age() {
  local s=$1 d h m
  d=$(( s / 86400 )); s=$(( s % 86400 ))
  h=$(( s / 3600 )); m=$(( (s % 3600) / 60 ))
  if [ "$d" -gt 0 ]; then printf '%dd %dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh %02dm' "$h" "$m"
  else printf '%dm' "$m"; fi
}
# iso_to_epoch <iso8601>
iso_to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo 0; }

# ───────────────────────── clock + owned events ─────────────────────────
hr "RECON @ $(date -u '+%Y-%m-%d %H:%M:%SZ')"

# ───────────────────────── repos ─────────────────────────
hr "TOWER (this app: $TOWER)"
if git -C "$TOWER" rev-parse --git-dir >/dev/null 2>&1; then
  printf '  branch %-12s sha %s   dirty: %s file(s)\n' \
    "$(git -C "$TOWER" branch --show-current)" \
    "$(git -C "$TOWER" rev-parse --short HEAD)" \
    "$(git -C "$TOWER" status --short | wc -l)"
  git -C "$TOWER" log -1 --format='  last: %s' | cut -c1-100
else
  echo "  ERROR: no git repo at $TOWER"; degrade "tower repo missing"
fi

hr "ENGINE ($ENGINE)"
if git -C "$ENGINE" rev-parse --git-dir >/dev/null 2>&1; then
  printf '  branch %-12s sha %s   dirty: %s file(s)\n' \
    "$(git -C "$ENGINE" branch --show-current)" \
    "$(git -C "$ENGINE" rev-parse --short HEAD)" \
    "$(git -C "$ENGINE" status --short | wc -l)"
else
  echo "  ERROR: no git repo at $ENGINE"; degrade "engine repo missing"
fi

hr "FUNDING-ARB (LOCKED — expect $LOCK_SHA)"
if git -C "$FARB" rev-parse --git-dir >/dev/null 2>&1; then
  farb_sha=$(git -C "$FARB" rev-parse --short HEAD)
  if [ "$farb_sha" = "$LOCK_SHA" ]; then
    echo "  sha $farb_sha — LOCK INTACT"
  else
    echo "  sha $farb_sha — !! LOCK DRIFT (expected $LOCK_SHA) !!"; degrade "funding-arb lock drift"
  fi
  printf '  dirty: %s file(s) (data files are gitignored; >0 is notable)\n' \
    "$(git -C "$FARB" status --short | wc -l)"
else
  echo "  ERROR: no git repo at $FARB"; degrade "funding-arb repo missing"
fi

# ───────────────────────── paper runner + supervisor meta ─────────────────────────
hr "PAPER RUNNER"
runner_pids=$(pgrep -f 'run_pure_futures_spread[.]py' || true)
if [ -n "$runner_pids" ]; then
  for pid in $runner_pids; do
    printf '  alive pid %s   uptime %s\n' "$pid" \
      "$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
else
  echo "  ERROR: no runner process (supervisor should respawn within 20 s while the tower lives)"; degrade "paper runner dead"
fi
if [ -f "$RUNNER_META" ]; then
  jq -r '"  supervisor meta: respawns=\(.respawns)  last_check_age=\(((now*1000)-.last_check)/1000|floor)s  last_spawn=\(.last_spawn*0.001|todate)"' \
    "$RUNNER_META" 2>/dev/null || { echo "  ERROR: runner meta unreadable"; degrade "runner meta unreadable"; }
else
  echo "  (no $RUNNER_META yet — supervisor has not run since boot)"; degrade "runner meta absent"
fi

# ───────────────────────── status API (single fetch) ─────────────────────────
hr "STATUS API ($API)"
api_json=$(curl -s --max-time 10 "$API" || true)
if [ -z "$api_json" ] || ! printf '%s' "$api_json" | jq empty 2>/dev/null; then
  echo "  ERROR: status API unreachable/invalid — is the dev server up?"; degrade "status API unreachable"
fi

if [ -n "$api_json" ] && printf '%s' "$api_json" | jq empty 2>/dev/null; then

  hr "CI LANES (live GitHub queries, 300 s cache)"
  for lane in tower_ci engine_ci funding_ci; do
    printf '%s' "$api_json" | jq -r --arg lane "$lane" '
      .pipeline[$lane] as $l |
      (if $l.latest == null then "  \($lane): ERROR — no run data"
       elif ($l.latest.status == "completed") and ($l.latest.conclusion == "success")
       then "  \($lane): GREEN  \($l.latest.sha)  at \($l.latest.completed_at)"
       elif ($l.latest.status == "in_progress") or ($l.latest.status == "queued")
       then "  \($lane): RUNNING  \($l.latest.sha)"
       else "  \($lane): RED  \($l.latest.sha)  status=\($l.latest.status) concl=\($l.latest.conclusion)"
       end)' || { echo "  $lane: ERROR parsing"; degrade "$lane parse error"; }
    # mark red as degraded
    printf '%s' "$api_json" | jq -e --arg lane "$lane" '
      .pipeline[$lane].latest != null and
      .pipeline[$lane].latest.status == "completed" and
      .pipeline[$lane].latest.conclusion == "success"' >/dev/null 2>&1 \
      || degrade "CI lane $lane not green"
  done
  printf '%s' "$api_json" | jq -r '
    .pipeline.phase3.latest as $p3 |
    (if $p3 == null then "  phase3: ERROR — no commit data"
     else "  phase3 (static artifact): \($p3.sha)  \($p3.date)" end),
    "  vercel: \(.pipeline.vercel.status)"' || true
  printf '%s' "$api_json" | jq -e '.pipeline.vercel.healthy' >/dev/null 2>&1 \
    || degrade "vercel live check failed"

  hr "FRESHNESS"
  printf '%s' "$api_json" | jq -r '
    "  paper-data stream: \(.freshness.status)  age \(.freshness.data_age_s|floor)s / stale after \(.freshness.stale_after_s)s"' || true
  printf '%s' "$api_json" | jq -e '.freshness.stale | not' >/dev/null 2>&1 \
    || degrade "paper-data stream stale"

  hr "SUPERVISORS"
  # `reason` is a string|null explaining remote-mode absence — NOT a lane.
  # Only heartbeat/snapshot/phase2 are actual supervisor lanes.
  printf '%s' "$api_json" | jq -r '
    .supervisors.reason as $why |
    (if $why != null then "  note: \($why)" else empty end),
    (.supervisors | to_entries[] | select(.key != "reason") |
     (if .value == null then "  \(.key): ABSENT (null)"
      else "  \(.key): \(.value.healthy)  last_result=\(.value.last_result // "?" | .[0:60])"
      end))' || { echo "  ERROR: supervisors block unreadable"; degrade "supervisors unreadable"; }
  printf '%s' "$api_json" | jq -e '
    [.supervisors | to_entries[] | select(.key != "reason") | .value.healthy] | all' \
    >/dev/null 2>&1 || degrade "a supervisor lane is unhealthy/absent"

  hr "PHASE-2 EXPERIMENT"
  printf '%s' "$api_json" | jq -r '
    "  day \(.phase2.day)  stage \(.phase2.stage)  report_age \(.phase2.age_s|floor)s  overdue_check=\(.phase2.check_overdue)"' || true
  printf '%s' "$api_json" | jq -e '.phase2.check_overdue | not' >/dev/null 2>&1 \
    || degrade "phase2 check overdue"
  day3=$(printf '%s' "$api_json" | jq -r '.phase2.day3_at // empty')
  day7=$(printf '%s' "$api_json" | jq -r '.phase2.day7_at // empty')
  [ -n "$day3" ] && countdown "$(iso_to_epoch "$day3")" "Day-3 interim"
  [ -n "$day7" ] && countdown "$(iso_to_epoch "$day7")" "Day-7 / A-B-C"

  if [ -f "$PHASE2_META" ]; then
    lane_next=$(python3 - "$PHASE2_META" <<'PYEOF'
import json, sys, time
m = json.load(open(sys.argv[1]))
healthy = m.get("last_result") == "ok" or str(m.get("last_result", "")).startswith("seeded")
anchor = m.get("last_ok") if healthy else m.get("last_run")
interval = 24*3600 if healthy else 3600
print(int(anchor/1000 + interval))  # epoch s of next fire
PYEOF
    ) && countdown "$lane_next" "phase2 lane next fire" \
      || { echo "  ERROR: phase2 meta unreadable"; degrade "phase2 meta unreadable"; }
    jq -r '"  lane meta: runs=\(.runs) ok=\(.ok) last_result=\"\(.last_result)\""' "$PHASE2_META" 2>/dev/null || true
  else
    echo "  (no $PHASE2_META — lane never armed)"; degrade "phase2 meta absent"
  fi

  hr "PAPER SUMMARY"
  printf '%s' "$api_json" | jq -r '
    .paper.totals as $t |
    "  cycles \($t.cycles)  opens \($t.opens) (sim \($t.open_simulated) / abort \($t.open_aborted))  closes \($t.closes)",
    (if .paper.ledger then
       "  positions: \(.paper.ledger.total) total, \(.paper.ledger.open) open, \(.paper.ledger.closed) closed (whole ledger)"
     else
       (.paper.positions // [] | "  positions: \(length) rows shown, \([.[] | select(.status=="open")] | length) open (slice only)")
     end)' || true
  printf '%s' "$api_json" | jq -r '.phase2.totals | "  economics: price \(.price) fees \(.fees) funding \(.funding) → net \(.net)"' 2>/dev/null || true

fi

# ───────────────────────── verdict ─────────────────────────
hr "VERDICT"
if [ "$DEGRADED" -eq 0 ]; then
  echo "  ALL GREEN — recon complete, nothing needs eyes."
else
  echo "  DEGRADED — reasons:"
  for r in "${REASONS[@]}"; do echo "    · $r"; done
fi
exit "$DEGRADED"
