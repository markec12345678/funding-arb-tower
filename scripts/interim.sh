#!/usr/bin/env bash
# interim.sh — the decision-grade experiment readout, one command.
#
# WHY THIS EXISTS: recon answers "is the system healthy?", e2e answers
# "does the user actually SEE the healthy system?" — neither answers
# "what does the experiment SAY?". The Day-3 interim read and the Day-7
# A/B/C decision need that third answer reproducibly: not an ad-hoc
# operator glance at report-latest.json, but the same one-command
# discipline the other two planes already have.
#
# WHAT IT READS (READ-ONLY — funding-arb stays LOCKED @ 0373f5d, 0-dirty):
#   · the locked analyzer's own outputs: the archived timestamped reports
#     (report-YYYYMMDD-HHMM.json — the experiment's history) + latest
#   · the phase2-daily lane meta (automation state)
#   · the live ledger (positions.json — whole-file, Task-52 discipline)
#
# WHAT IT PRINTS:
#   1. HEADER — now, experiment day (of 7), stage, decision countdowns
#   2. REPORT + LANE — report freshness, lane runs/ok/next fire
#   3. THE TREND — one row per ARCHIVED report: day, closed, W/L, net $,
#      retention %, funding $, fees $ — the trajectory a single report
#      cannot show and the A/B/C decision actually weighs. NB: the
#      earliest reports predate field standardization — null fields
#      render as "—" and are footnoted, never silently normalized.
#   4. THE CURRENT READ — the latest report's decision-support block,
#      exactly the analyzer's own locked framework (net>0/net<0 · net ·
#      retention · funding share · exits by reason) + the stage verdict.
#   5. LEDGER, BOTH COVERAGES — report-day closes vs live whole-ledger
#      counts: different coverage, both true, always labeled (Task 52).
#   6. INTEGRITY — the latest continuity verdicts + an all-archive scan
#      (has ANY report ever shown parse errors / gaps / duplicates?)
#      + archive self-consistency (totals.net vs Σ pnl per report).
#
# COVERAGE DISCIPLINE (the family rule): every number states its source
# plane. The trend is experiment-lifetime by construction (the archive IS
# the experiment's history); single-report numbers are labeled with the
# report's own timestamp; ledger numbers state live-vs-report.
#
# EXIT CODE: 0 = read produced · 1 = unreadable (no report yet).

set -uo pipefail

FARB=/home/z/funding-arb
PHASE2=$FARB/scripts/data/phase2
LATEST=$PHASE2/report-latest.json
LEDGER=$FARB/scripts/data/pure-futures/positions.json
LANE_META=$FARB/data/phase2_check.meta.json

hr()   { printf '\n── %s ──\n' "$1"; }
line() { printf '  %s\n' "$1"; }
sub()  { printf '    %s\n' "$1"; }
# fmt_delta <epoch-seconds> — "in 2d 3h" / "in 3h" / "1d 4h ago" / "now"
fmt_delta() {
  local delta=$(( $1 - NOW_EPOCH )) abs direction
  abs=$delta; direction="in"
  if [ $delta -lt 0 ]; then abs=$(( -delta )); direction="ago"; fi
  local d=$(( abs / 86400 )) h=$(( (abs % 86400) / 3600 ))
  if [ $abs -lt 60 ]; then printf 'now'; return; fi
  if [ $d -gt 0 ]; then printf '%s %sd %sh' "$direction" "$d" "$h"
  else printf '%s %sh' "$direction" "$h"; fi
}

NOW_EPOCH=$(date -u +%s)
NOW_ISO=$(date -u +"%Y-%m-%d %H:%M:%SZ")

# ─── 0. readable state? ───────────────────────────────────────────────
if ! jq empty "$LATEST" >/dev/null 2>&1; then
  echo "ERROR: no readable report at $LATEST — run the analyzer (or wait for the phase2-daily lane) first." >&2
  exit 1
fi

# ─── 1. header ─────────────────────────────────────────────────────────
BASELINE_RAW=$(jq -r '.baseline_start' "$LATEST")
BASELINE_EPOCH=$(date -u -d "${BASELINE_RAW/+00:00/Z}" +%s 2>/dev/null || \
                 date -u -d "${BASELINE_RAW// /T}" +%s 2>/dev/null || echo 0)
STAGE=$(jq -r '.stage' "$LATEST")
REPORT_TS=$(jq -r '.generated_at' "$LATEST")
REPORT_DAY=$(jq -r '.day' "$LATEST")
REPORT_EPOCH=$(date -u -d "${REPORT_TS// /T}" +%s 2>/dev/null || echo 0)
DAY3_EPOCH=$(( BASELINE_EPOCH + 3 * 86400 ))
DAY7_EPOCH=$(( BASELINE_EPOCH + 7 * 86400 ))
NOW_DAY=$(awk -v n="$NOW_EPOCH" -v b="$BASELINE_EPOCH" 'BEGIN { printf "%.3f", (n - b) / 86400 }')

hr "PHASE-2 INTERIM READ @ $NOW_ISO"
line "experiment day $NOW_DAY of 7 (baseline $BASELINE_RAW)"
line "stage: $STAGE (as of last report — day $REPORT_DAY, $REPORT_TS)"
line "Day-3 interim read: $(fmt_delta $DAY3_EPOCH)   ·   Day-7 / A-B-C: $(fmt_delta $DAY7_EPOCH)"

# ─── 2. report + lane state ────────────────────────────────────────────
hr "REPORT + LANE"
REPORT_AGE=$(( NOW_EPOCH - REPORT_EPOCH ))
line "report-latest.json: generated $REPORT_TS (age $(( REPORT_AGE / 3600 ))h $(( (REPORT_AGE % 3600) / 60 ))m)"
if [ -r "$LANE_META" ]; then
  LANE_JSON=$(cat "$LANE_META")
  LANE_RUNS=$(jq -r '.runs' <<<"$LANE_JSON")
  LANE_OK=$(jq -r '.ok' <<<"$LANE_JSON")
  LANE_RESULT=$(jq -r '.last_result' <<<"$LANE_JSON")
  LANE_LASTOK=$(jq -r '.last_ok // 0' <<<"$LANE_JSON")
  LANE_LASTRUN=$(jq -r '.last_run // 0' <<<"$LANE_JSON")
  LANE_LASTOK_S=$(awk -v ms="$LANE_LASTOK" 'BEGIN { printf "%d", ms / 1000 }')
  LANE_LASTRUN_S=$(awk -v ms="$LANE_LASTRUN" 'BEGIN { printf "%d", ms / 1000 }')
  # mirror the lane's own logic (phase2-daily.ts): healthy → 24 h since
  # last_ok; failed → retry 1 h after last_run
  case "$LANE_RESULT" in
    ok|seeded*)
      LANE_NEXT=$(( LANE_LASTOK_S + 24 * 3600 )) ;;
    *)
      LANE_NEXT=$(( LANE_LASTRUN_S + 3600 )) ;;
  esac
  line "phase2-daily lane: runs=$LANE_RUNS ok=$LANE_OK last_result=\"$LANE_RESULT\""
  line "lane next fire: $(fmt_delta $LANE_NEXT) (mirrors phase2-daily.ts: 24 h after last ok · 1 h retry on failure)"
else
  line "phase2-daily lane: meta not found at $LANE_META"
fi

# ─── 3. the trend — every archived report ─────────────────────────────
hr "THE TREND — every archived report (experiment-lifetime)"
line "ts           day     closed  W/L     net\$      ret%     fund\$    fees\$"
ARCHIVE=$(ls "$PHASE2"/report-2*.json 2>/dev/null | sort)
N_REPORTS=0
N_NULLS=0
for f in $ARCHIVE; do
  N_REPORTS=$(( N_REPORTS + 1 ))
  ts_label=$(basename "$f" .json | sed 's/^report-2026\(..\)\(..\)-\(..\)\(..\)$/\1-\2 \3:\4/')
  IFS=$'\t' read -r day closed wins net ret fund fees < <(jq -r '[
      .day,
      (.totals.closed // "null"),
      (.totals.wins // "null"),
      (.totals.net // "null"),
      (.totals.retention_avg_pct // "null"),
      (.totals.funding // "null"),
      (.totals.fees // "null")
    ] | @tsv' "$f")
  if [ "$closed" = "null" ] || [ "$wins" = "null" ]; then
    wl="—"; closed_disp=${closed/null/—}; N_NULLS=$(( N_NULLS + 1 ))
  else
    wl="$wins/$(( ${closed%.*} - ${wins%.*} ))"; closed_disp=$closed
  fi
  printf '  %s  %6s  %6s  %5s  %9s  %7s  %7s  %7s\n' \
    "$ts_label" "$day" "$closed_disp" "$wl" \
    "${net/null/—}" "${ret/null/—}" "${fund/null/—}" "${fees/null/—}"
done
if [ "$N_REPORTS" -eq 0 ]; then
  line "(no archived timestamped reports yet — the trend begins with the second analyzer run)"
fi
if [ "$N_NULLS" -gt 0 ]; then
  sub "NB: the earliest reports predate the locked analyzer's semantics — 09-10 17:14 predates"
  sub "field standardization (null closed/wins; its totals.net disagrees with its own pnl array),"
  sub "and 09-10 17:18 predates baseline-scoped gap counting (its gap list includes two"
  sub "PRE-BASELINE startup gaps). From 09-10 17:19 onward the archive is the locked"
  sub "framework's: baseline-scoped funnel, standardized totals."
fi

# ─── 4. the current read — decision support (locked framework) ────────
hr "THE CURRENT READ — decision support (report $REPORT_TS)"
CUR=$(jq -r '
  .totals as $t |
  ([.pnl[].net_usd] | add // 0) as $sum_net |
  ([.pnl[] | select(.net_usd > 0)] | length) as $w |
  ([.pnl[] | select(.net_usd < 0)] | length) as $l |
  ([.pnl[].retention_pct] | length) as $nret |
  (if ($t.funding + $t.price) != 0 then (100.0 * $t.funding / ($t.funding + $t.price)) else null end) as $fshare |
  [
    "net>0 / net<0: \($w) / \($l)",
    "total net PnL $ (closed): \($t.net)",
    "avg edge retention %: \($t.retention_avg_pct // "n/a")",
    "funding share of gross PnL %: \($fshare // "n/a" | if type == "number" then (.*10|round/10) else . end)",
    "exits by reason: \([.pnl[].exit_reason] | group_by(.) | map("\(.[0])=\(length)") | join("; "))",
    "totals self-check (Σ pnl.net − totals.net): \($sum_net - $t.net)"
  ] | .[]' "$LATEST")
while IFS= read -r ln; do line "$ln"; done <<<"$CUR"
if [ "$STAGE" = "FINAL-WINDOW" ]; then
  line "stage verdict: FINAL-WINDOW — the A/B/C decision is due."
else
  line "stage verdict: $STAGE — NO DECISION YET (indicative only; A/B/C only after Day 7)."
fi

# ─── 5. ledger — both coverages, labeled (Task-52 discipline) ──────────
hr "LEDGER — both coverages, labeled"
REPORT_CLOSED=$(jq -r '.totals.closed' "$LATEST")
if [ -r "$LEDGER" ]; then
  LED=$(jq -r '[length, ([.[] | select(.status == "open")] | length), ([.[] | select(.status == "closed")] | length)] | @tsv' "$LEDGER" 2>/dev/null)
  IFS=$'\t' read -r l_total l_open l_closed <<<"$LED"
  line "live whole-ledger (positions.json, now):       $l_total total · $l_open open · $l_closed closed"
  line "report-day closes (analyzer, $REPORT_TS):      $REPORT_CLOSED closed"
  if [ -n "${l_closed:-}" ] && [ -n "$REPORT_CLOSED" ] && [ "$REPORT_CLOSED" != "null" ]; then
    line "closes since the report (runner kept cycling): $(( ${l_closed%.*} - ${REPORT_CLOSED%.*} ))"
  fi
  sub "two true numbers, different coverage: the report is analyzer-day-stamped; the ledger is whole-file live. Never blend them."
else
  line "live ledger: not found at $LEDGER"
fi

# ─── 6. integrity ──────────────────────────────────────────────────────
hr "INTEGRITY"
INTEG=$(jq -r '
  .continuity.sandbox as $s |
  .continuity.actions as $a |
  [
    "parse_errors: \($s.parse_errors // "—") · ts_back_jumps: \($s.ts_back_jumps // "—") · duplicate_ts: \($s.duplicate_ts // "—")",
    "journal gaps > 15 min: \($s.gaps_over_15min | length) · duplicate position ids: \($s.duplicate_position_ids | length)",
    "open now vs last-cycle field: \($s.open_now // "—") vs \($s.last_cycle_open_positions_field // "—")",
    "collector coverage vs 5-min cadence: \($a.coverage_pct // "—")% (gaps > 10 min: \($a.gaps_over_10min | length))"
  ] | .[]' "$LATEST")
while IFS= read -r ln; do line "$ln"; done <<<"$INTEG"

# all-archive integrity scan: has ANY report ever shown findings?
BAD=0; INCONSISTENT=0; TOTAL_ARCHIVE=$N_REPORTS
for f in $ARCHIVE; do
  errs=$(jq -r '(.continuity.sandbox.parse_errors // 0) +
                (.continuity.sandbox.gaps_over_15min // [] | length) +
                (.continuity.sandbox.duplicate_position_ids // [] | length)' "$f" 2>/dev/null || echo 1)
  [ "${errs%.*}" -gt 0 ] 2>/dev/null && BAD=$(( BAD + 1 ))
  # archive self-consistency: totals.net vs the pnl array it carries
  inc=$(jq -r '([.pnl[].net_usd] | add // 0) - .totals.net | fabs > 0.005' "$f" 2>/dev/null || echo true)
  [ "$inc" = "true" ] && INCONSISTENT=$(( INCONSISTENT + 1 ))
done
line "all-archive scan: $BAD of $TOTAL_ARCHIVE report(s) with integrity findings (parse errors / recorded gaps / duplicate ids)"
line "archive self-consistency: totals.net == Σ pnl.net_usd in $(( TOTAL_ARCHIVE - INCONSISTENT )) of $TOTAL_ARCHIVE report(s)"
if [ "$BAD" -gt 0 ] || [ "$INCONSISTENT" -gt 0 ]; then
  sub "(the flagged report(s) are the pre-lock earliest builds — their gap lists carried"
  sub "pre-baseline startup gaps before the analyzer's baseline scoping; see the trend footnote)"
fi
line ""
line "READ COMPLETE — measurement, not interpretation: the A/B/C weighing stays with the decision owner."
exit 0
