#!/usr/bin/env bash
# dev-server watchdog — the outer ring of the mutual-protection pair.
#
# WHY THIS EXISTS: the entire autonomous stack (paper-runner supervisor,
# gh-heartbeat, snapshot pusher, phase2-daily lane) lives INSIDE the Next.js
# dev server — and nothing supervises the dev server itself. The OOM incident
# (2026-09-12, Task 55) proved the failure mode real: the kernel killed
# next-server and the UI stayed dark until an operator manually re-ran the
# recovery recipe. If that had happened the night before a lane fire, the
# fire would never have happened.
#
# THE PAIR (mutual protection):
#   - THIS script (orphaned to PID 1, outside next-server) probes port 3000
#     and respawns `bun run dev` with the Task-55 recipe when it is dead.
#   - src/instrumentation-node.ts ENSURES this watchdog exists at every
#     dev-server boot (spawns it detached if no instance is running) — so a
#     dead watchdog is re-created by the next server boot.
#   Both directions use the runner-supervisor pattern (detached + unref'd
#   child of a long-lived parent survives the parent's death — verified
#   empirically during the OOM incident: the runner never noticed).
#
# HONEST SCOPE: this guards the PROVEN failure mode (process death: OOM kill,
# crash). A hung-but-alive server (port answering nothing / answering 5xx
# forever) is a different failure mode and stays manual. A full sandbox reboot
# kills the watchdog too — the platform owns boot; any dev-server start
# re-arms the watchdog via instrumentation.
#
# FAILURE SEMANTICS: never storms, never gives up. A respawn that dies within
# the storm window counts as a consecutive failure; ≥5 consecutive failures
# stretch the retry to 10 min. Everything is visible in the meta file
# (data/dev_server_watchdog.meta.json), surfaced by scripts/recon.sh.
#
# READ-ONLY toward the repos: writes only its own meta + log under
# data/ (gitignored). Never touches funding-arb, the engine, or the ledger.

set -uo pipefail   # NO -e: a failed probe must not kill the loop

PROJ=/home/z/my-project
META="$PROJ/data/dev_server_watchdog.meta.json"
WLOG="$PROJ/data/watchdog.log"      # canonical watchdog action log
DEVLOG="$PROJ/dev.log"              # bun's own output (Task-55 recipe sink)
BUN=/usr/local/bin/bun
PROBE_URL=http://127.0.0.1:3000/
INTERVAL=15          # s between probes
DEAD_THRESHOLD=3     # consecutive failed probes before declaring dead
BOOT_GRACE=90        # s after a respawn before misses count again (dev boot
                     # can legitimately take ~30-60 s to bind — killing a
                     # healthy boot mid-flight would be worse than the outage)
STORM_WINDOW=300     # s after a respawn: dying inside it = consecutive failure
STORM_SLEEP=120      # backoff from the SECOND consecutive failure on
FAIL5_SLEEP=600      # backoff once consecutive_failures >= 5

respawns=0
consecutive_failures=0
misses=0
last_spawn=0
last_check=0
boot_grace_until=0
last_result="starting"
started_at=$(date +%s)

wlog() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$WLOG"; }

write_meta() {
  mkdir -p "$(dirname "$META")" 2>/dev/null || true
  printf '{"pid":%s,"started_at":%s,"last_check":%s,"respawns":%s,"consecutive_failures":%s,"last_spawn":%s,"boot_grace_until":%s,"last_result":"%s","interval_s":%s,"probe_url":"%s"}\n' \
    "$$" "$started_at" "$last_check" "$respawns" "$consecutive_failures" \
    "$last_spawn" "$boot_grace_until" "$last_result" "$INTERVAL" "$PROBE_URL" > "$META" 2>/dev/null || true
}

# ---- single-instance guard (kernel-level, immune to argv-matching footguns):
# the first start attempt used pgrep -f and FALSE-POSITIVED on the invoking
# tool shell — its own command line mentioned the script path, so the guard
# saw the STARTER as "another instance" and the real watchdog exited. The
# [.] trick only protects the pgrep pattern from matching itself; it cannot
# protect against starters that mention the script. flock is atomic, held
# for this process's lifetime, and released by the kernel on death.
mkdir -p "$PROJ/data" 2>/dev/null || true
exec 9>"$PROJ/data/dev_server_watchdog.lock"
if ! flock -n 9; then
  wlog "another instance holds the watchdog lock — exiting."
  exit 0
fi

# ---- probe: ANY http answer (200-599) = alive; no connection = dead ----
probe_alive() {
  local code
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$PROBE_URL" 2>/dev/null)
  code=${code:-000}
  [[ "$code" =~ ^[2-5][0-9]{2}$ ]]
}

# ---- port occupancy check (bash builtin /dev/tcp — no lsof dependency) ----
port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/3000") 2>/dev/null; }

# ---- clean the dead tree so the respawn can bind port 3000 ----
# Patterns are bracketed ([0], [v], [-]) so a CONCURRENT operator command
# that merely MENTIONS these strings (ps | grep, tail | grep) can never be
# matched and killed — same argv footgun discipline as the pgrep guards.
# Signatures cover the full Task-55 recovery shape: the bun parent, the bash
# pipeline wrapper, the node launcher, the next-server worker itself, and
# orphaned postcss compile workers.
kill_stale_tree() {
  wlog "server dead — cleaning stale dev-server tree"
  pkill -TERM -f 'next dev -p 300[0]' 2>/dev/null || true
  pkill -TERM -f 'bun run de[v]'       2>/dev/null || true
  pkill -TERM -f 'next[-]server'       2>/dev/null || true
  pkill -TERM -f 'postcss[.]js'        2>/dev/null || true
  sleep 5
  pkill -KILL -f 'next dev -p 300[0]' 2>/dev/null || true
  pkill -KILL -f 'bun run de[v]'      2>/dev/null || true
  pkill -KILL -f 'next[-]server'      2>/dev/null || true
  pkill -KILL -f 'postcss[.]js'       2>/dev/null || true
  # wait up to 30 s for the port to actually free up
  local waited=0
  while port_taken && [ "$waited" -lt 30 ]; do
    sleep 2; waited=$((waited + 2))
  done
  if port_taken; then
    wlog "WARNING: port 3000 still occupied after cleanup (waited ${waited}s)"
    return 1
  fi
  return 0
}

# ---- the Task-55 recovery recipe, verbatim (subshell orphans bun to PID 1) ----
respawn_server() {
  wlog "respawning dev server (attempt: respawns=$((respawns + 1)) consecutive_failures=$consecutive_failures)"
  (
    cd "$PROJ" || exit 1
    setsid nohup "$BUN" run dev >> "$DEVLOG" 2>&1 < /dev/null &
  )
}

handle_dead() {
  local now backoff
  now=$(date +%s)
  if [ "$last_spawn" -gt 0 ] && [ $((now - last_spawn)) -lt "$STORM_WINDOW" ]; then
    consecutive_failures=$((consecutive_failures + 1))
  else
    consecutive_failures=1
  fi
  # FIRST failure respawns immediately; only repeated quick deaths back off.
  if [ "$consecutive_failures" -ge 5 ]; then backoff=$FAIL5_SLEEP
  elif [ "$consecutive_failures" -ge 2 ]; then backoff=$STORM_SLEEP
  else backoff=0
  fi
  if [ "$backoff" -gt 0 ]; then
    last_result="dead — respawn queued in ${backoff}s (consecutive_failures=$consecutive_failures)"
    write_meta
    sleep "$backoff"
    # re-probe after the backoff: if something (an operator's manual
    # recovery, or a miraculous self-recovery) brought the port back while
    # we waited, do NOT kill it — log and stand down.
    if probe_alive; then
      misses=0; consecutive_failures=0; boot_grace_until=0
      last_result="recovered during backoff — no respawn"
      wlog "$last_result"
      return
    fi
  fi
  kill_stale_tree || true
  respawn_server
  respawns=$((respawns + 1))
  last_spawn=$(date +%s)
  boot_grace_until=$((last_spawn + BOOT_GRACE))
  last_result="respawned (respawns=$respawns, consecutive_failures=$consecutive_failures)"
  misses=0
  wlog "$last_result"
}

trap 'last_result="stopped by signal"; write_meta; wlog "watchdog stopped by signal"; exit 0' TERM INT

wlog "watchdog started (pid $$, probe ${PROBE_URL} every ${INTERVAL}s)"
write_meta

# ---- main loop ----
while true; do
  if probe_alive; then
    misses=0
    consecutive_failures=0
    boot_grace_until=0
    last_result="ok"
  elif [ "$boot_grace_until" -gt 0 ] && [ "$(date +%s)" -lt "$boot_grace_until" ]; then
    # a freshly respawned server is mid-boot — not dead (see BOOT_GRACE)
    last_result="booting (grace $((boot_grace_until - $(date +%s)))s left)"
  else
    misses=$((misses + 1))
    if [ "$misses" -ge "$DEAD_THRESHOLD" ]; then
      handle_dead
    else
      last_result="probing (misses=$misses/$DEAD_THRESHOLD)"
    fi
  fi
  last_check=$(date +%s)
  write_meta
  sleep "$INTERVAL"
done
