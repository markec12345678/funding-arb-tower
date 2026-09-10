#!/usr/bin/env bash
# Hourly paper-data snapshot push (called from my-project paper-snapshot module).
# Preserves the sandbox collector's LIFECYCLE data (journal + positions) on the
# GitHub paper-data branch — the one dataset the stateless github-actions
# collector cannot see. Uses git plumbing on a temp index: the funding-arb
# working tree is never touched, the runner keeps running.
# Handles concurrent pushes from the github-actions bot via fetch+retry.
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
  )
  for dest in "${!FILES[@]}"; do
    src="${FILES[$dest]}"
    if [[ -f "$src" ]]; then
      BLOB=$(git hash-object -w "$src")
      GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo "100644,$BLOB,$dest"
    fi
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
