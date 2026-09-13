#!/usr/bin/env bash
# round.sh — the new-regime operator round, ONE command (Task 89).
#
# WHY: under tool-call reaping (2026-09-13 regime change) no daemon
# survives between tool calls — the experiment advances ONLY during
# operator rounds. This script is a round's whole duty, in the right
# ORDER: cycle first (the journal grows), push second (the snapshot
# carries the fresh row + any new analyzer reports to GitHub), then the
# two read-only planes (interim = what the experiment SAYS, recon = is
# the family HEALTHY). The order is the discipline: pushing before the
# cycle would carry a stale journal row.
#
# WHAT IT DOES:
#   1. CYCLE   — one `--once` paper cycle (the GH collector's own command;
#                foreground + timeout 240 s: the reaping-safe form)
#   2. PUSH    — push-paper-snapshot.sh (plumbing snapshot to the GitHub
#                paper-data branch). MANUAL fire — deliberately does NOT
#                touch paper_snapshot.meta.json (lane counters stay
#                automated-only; manual fires are operator actions).
#   3. INTERIM — interim.sh (the decision-grade readout; read-only)
#   4. RECON   — recon.sh (family health; runner dead + status API down
#                BETWEEN calls is the regime's honest steady state — the
#                script's DEGRADED verdict names it, this stage is
#                advisory only and never fails the round)
#
# THE DAILY-READ NOTE: the phase2-daily lane (24 h analyzer check) fires
# on any dev-server boot that finds it overdue — the analyzer then runs
# as a child of that server and must COMPLETE inside the call's uptime
# window (~1-3 min; a browser verification round naturally provides it).
# A round AFTER the analyzer completed pushes the fresh report in stage
# 2. If a day's round shows the lane still overdue in interim output,
# run a verification round (dev-server boot + browser check) and re-run
# this script.
#
# EXIT: 0 = cycle AND push both ok (reads advisory) · 1 = a duty failed.
set -uo pipefail

FARB=/home/z/funding-arb
VENV=/home/z/.venv/bin/python
RUNNER=$FARB/scripts/execution/run_pure_futures_spread.py
CONFIG=$FARB/templates/config.pure_futures.spread.json
JOURNAL=$FARB/scripts/data/pure-futures/journal.jsonl

rc_cycle=1; rc_push=1

echo "══ OPERATOR ROUND @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ══"

# ── 1. CYCLE ──────────────────────────────────────────────────────────
echo "── [1/4] paper cycle (--once, foreground) "
J_BEFORE=$(wc -l < "$JOURNAL" 2>/dev/null || echo 0)
if timeout 240 "$VENV" "$RUNNER" --config "$CONFIG" --once --verbose > /tmp/round-cycle.log 2>&1; then
  rc_cycle=0
  J_AFTER=$(wc -l < "$JOURNAL")
  LAST_TS=$(tail -1 "$JOURNAL" | jq -r '.ts' 2>/dev/null || echo '?')
  LAST_OPEN=$(tail -1 "$JOURNAL" | jq -r '.open_positions' 2>/dev/null || echo '?')
  echo "  OK · journal $J_BEFORE → $J_AFTER · last row $LAST_TS · open $LAST_OPEN"
else
  echo "  FAIL (exit $?; see /tmp/round-cycle.log):"
  tail -5 /tmp/round-cycle.log | sed 's/^/    /'
fi

# ── 2. PUSH (durability) ──────────────────────────────────────────────
echo "── [2/4] paper-data snapshot push (manual fire)"
if bash /home/z/my-project/scripts/push-paper-snapshot.sh; then
  rc_push=0
  echo "  OK · $(tail -1 "$FARB/data/snapshot.log")"
else
  echo "  FAIL (pusher exit $? — see $FARB/data/snapshot.log tail below)"
  tail -3 "$FARB/data/snapshot.log" 2>/dev/null | sed 's/^/    /'
fi

# ── 3. INTERIM (what the experiment says — read-only) ─────────────────
echo "── [3/4] interim read ──"
bash /home/z/my-project/scripts/interim.sh 2>&1 | sed 's/^/  /'

# ── 4. RECON (family health — advisory under the new regime) ───────────
echo "── [4/4] recon ──"
bash /home/z/my-project/scripts/recon.sh 2>&1 | rg -N 'LOCK|sha|branch|ERROR|VERDICT|DEGRADED|HEALTHY|runner|supervisor meta' | sed 's/^/  /' || true

# ── verdict ───────────────────────────────────────────────────────────
if [ $rc_cycle -eq 0 ] && [ $rc_push -eq 0 ]; then
  echo "══ ROUND COMPLETE — cycle ok · push ok (reads above) ══"
  exit 0
fi
echo "══ ROUND DEGRADED — cycle=$rc_cycle push=$rc_push — inspect above ══"
exit 1
