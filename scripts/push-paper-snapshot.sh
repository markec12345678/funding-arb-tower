#!/usr/bin/env bash
# Hourly paper-data snapshot push (called from my-project paper-snapshot module).
# Preserves the sandbox collector's LIFECYCLE data (journal + positions) on the
# GitHub paper-data branch — the one dataset the stateless github-actions
# collector cannot see. Uses git plumbing on a temp index: the funding-arb
# working tree is never touched, the runner keeps running.
# Handles concurrent pushes from the github-actions bot via fetch+retry.
#
# Coverage (Task 76 durability close): the branch root carries the data-plane
# contract the status route's remote mode reads (journal, positions, configs,
# logs, phase2-report-latest); paper-data/phase2-archive/ mirrors every
# timestamped analyzer report (the TREND's source data — without it the
# per-day trajectory the Day-7 A/B/C read weighs existed only on the host);
# paper-data/op-meta/ mirrors the lane/runner metas and the pusher's own log
# (the automation's evidence: run counters, timestamps, spawn history).
set -euo pipefail
REPO=/home/z/funding-arb
cd "$REPO"

MSG="paper data snapshot (auto hourly): $(date -u +'%Y-%m-%dT%H:%MZ')"

for attempt in 1 2 3; do
  git fetch origin paper-data --quiet 2>/dev/null || true
  TIP=$(git rev-parse origin/paper-data 2>/dev/null) || { echo "no paper-data branch"; exit 1; }

  IDX=$(mktemp /tmp/farb-snap-idx.XXXXXX)
  GIT_INDEX_FILE="$IDX" git read-tree "$TIP"

  declare -A FILES=(
    ["paper-data/journal.jsonl"]="scripts/data/pure-futures/journal.jsonl"
    ["paper-data/positions.json"]="scripts/data/pure-futures/positions.json"
    ["paper-data/strategy_config.json"]="scripts/data/strategy_config.json"
    ["paper-data/backtest_analysis.json"]="data/backtest_analysis.json"
    ["paper-data/backtest_30d_btc_eth_sol.json"]="data/backtest_30d_btc_eth_sol.json"
    ["paper-data/paper_runner.log"]="data/paper_runner.log"
    ["paper-data/funding_reconstruction_probe.json"]="data/funding_reconstruction_probe.json"
    # Phase-2 A/B/C discipline: the read-only analyzer's stable artifact
    # (overwritten by every daily verify-only check). Tower-owned push — the
    # funding-arb working tree and main branch stay untouched; the remote
    # data plane renders the SAME discipline state as the sandbox checkout.
    ["paper-data/phase2-report-latest.json"]="scripts/data/phase2/report-latest.json"
  )
  for dest in "${!FILES[@]}"; do
    src="${FILES[$dest]}"
    if [[ -f "$src" ]]; then
      BLOB=$(git hash-object -w "$src")
      GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo "100644,$BLOB,$dest"
    fi
  done

  # Phase-2 report ARCHIVE — the trend's source data. Globbed, so every
  # future archive row (report-YYYYMMDD-HHMM.{json,md}) rides the next
  # hourly push automatically. Recovery-only mirror: nothing remote
  # enumerates it; interim.sh keeps reading the local archive.
  for src in scripts/data/phase2/report-2*.json scripts/data/phase2/report-2*.md; do
    [[ -f "$src" ]] || continue
    BLOB=$(git hash-object -w "$src")
    GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo \
      "100644,$BLOB,paper-data/phase2-archive/$(basename "$src")"
  done

  # Operational-state mirror: every lane/runner meta (globbed — future
  # lanes ride automatically) + the pusher's and the heartbeat's own logs.
  # Tiny files; they carry the automation's evidence. paper_runner.log is
  # already at the branch root (fixed map above) — not duplicated here.
  for src in data/*.meta.json data/snapshot.log data/gh_heartbeat.log; do
    [[ -f "$src" ]] || continue
    BLOB=$(git hash-object -w "$src")
    GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo \
      "100644,$BLOB,paper-data/op-meta/$(basename "$src")"
  done

  TREE=$(GIT_INDEX_FILE="$IDX" git write-tree)
  NEW=$(printf '%s' "$MSG" | GIT_INDEX_FILE="$IDX" git commit-tree "$TREE" -p "$TIP")
  rm -f "$IDX"

  if git push origin "$NEW:paper-data" >/dev/null 2>&1; then
    echo "$(date -u +%FT%TZ) pushed $NEW" >> data/snapshot.log
    exit 0
  fi
  # non-fast-forward: the github-actions bot pushed concurrently — refetch and rebuild
  sleep $((attempt * 5))
done

echo "$(date -u +%FT%TZ) FAILED after 3 attempts" >> data/snapshot.log
exit 1
