#!/usr/bin/env bash
# e2e.sh — the browser-level golden path for funding-arb-tower, one command.
#
# WHY THIS EXISTS: every operator round ended with a MANUAL browser pass —
# open the page, click past the default engine view (a reload ALWAYS lands on
# "quant engine"), wait for live data, eyeball the cards, check the console,
# resize to mobile. That pass lived in operator memory as 6-10 ad-hoc tool
# calls with known traps: the default-tab gotcha, CSS-uppercased card titles
# (source text is lowercase — match case-insensitively), and the delivery
# pipeline card's own "snapshot pushed · 32m old" line that must never be
# confused with the evidence-plane suffix. This script encodes the pass ONCE
# — recon.sh for the delivered UI. recon answers "is the system healthy?";
# e2e answers "does the user actually SEE the healthy system?"
#
# WHAT IT ASSERTS (both data modes, desktop 1440 + mobile 390):
#   local (no ?source): monitor view renders with live data —
#     · pill "runner live · data fresh" (process AND data plane green)
#     · cards: paper cycles · ledger · exit classification · economics ·
#       runner log
#     · coverage labels: "… ledger rows" (Task 52), "experiment-lifetime"
#       (Task 53), "(all-time)" whole-ledger counts
#     · MODE PURITY: zero "· snapshot Nm old" evidence suffixes (local reads
#       the live files — a suffix here means the mode leaked)
#   remote (?source=remote): the same cards on the snapshot plane —
#     · pill "collector live · data fresh"
#     · evidence suffix "· snapshot Nm old" on ≥2 evidence cards (Task 54:
#       labeled staleness; 3 cards carry it when the economics card renders)
#     · "economic decomposition" card VISIBLE (pre-Task-54 remote read the
#       collector's stub ledger, economics hid on closes=0)
#   both modes: zero console errors, zero page errors, no horizontal
#     overflow at either width, footer present with content filling the
#     viewport (the sticky-footer contract — min-h-screen stretch, never a
#     floating gap below the footer).
#
# HONEST FAILURE: red here means the HEALTHY golden path is broken — exactly
# what a round needs to know. A legitimately degraded system (runner down,
# stale stream, unreachable snapshot) fails honestly; pair with recon.sh to
# see WHICH plane is at fault.
#
# SIDE EFFECTS: opens a headless browser (agent-browser, isolated
# --session e2e, closed via trap on any exit). Writes NOTHING unless --shots
# is passed — then screenshots to screenshots/e2e-*.png (tracked files:
# commit them as round evidence if wanted, or let the next --shots run
# overwrite them).
#
# EXIT CODE: 0 = golden path green · 1 = needs eyes (output says what).

set -uo pipefail

BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
SESSION=e2e
SHOTS=0
case "${1:-}" in
  --shots) SHOTS=1 ;;
  "") ;;
  *) echo "usage: $0 [--shots]   (env override: E2E_BASE_URL)" >&2; exit 2 ;;
esac

trap 'agent-browser --session "$SESSION" close >/dev/null 2>&1' EXIT

FAILED=0
REASONS=()
fail() { FAILED=1; REASONS+=("$1"); printf '  ✗ %s\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
hr()   { printf '\n── %s ──\n' "$1"; }

ab() { agent-browser --session "$SESSION" "$@"; }
shot() { [ "$SHOTS" -eq 1 ] && ab screenshot "screenshots/$1.png" >/dev/null 2>&1 || true; }

# Body text of the current page. agent-browser eval returns a JSON-encoded
# string (newlines escaped as literal \n) — jq -r restores real newlines.
# On eval failure the body is empty and every text assertion fails honestly.
body_text() { ab eval "document.body.innerText" 2>/dev/null | jq -r '.' 2>/dev/null; }

# The evidence-suffix pattern. NB: the delivery-pipeline card legitimately
# renders "snapshot pushed · 32m old" / "snapshot stale · 30h 8m old" — the
# discriminator is "snapshot" DIRECTLY after the middot (evidenceSuffix is
# exactly " · snapshot {M}m old", minutes-only, no status word).
EVIDENCE_RE='· snapshot [0-9]+m old'

BODY=""
MODE_CUR=""
body_md5() { printf '%s' "$BODY" | md5sum | cut -c1-8; }
# NB on greps below: NEVER `printf "$BODY" | grep -q …` under `set -o pipefail` —
# grep -q exits on the FIRST match while printf is still writing 52 KB → printf
# takes SIGPIPE (141) → pipefail fails the whole pipeline → "missing" — a
# SCHEDULING race (caught 3/10 in a minimal repro; interactive greps without
# pipefail always passed, which is what made it look impossible). Here-strings
# (<<<"$BODY") make grep read a fully-written temp file: no writer, no race.
# The same trap inverts the purity guard (a real match could read as clean),
# so every -q / consumer-of-$BODY grep below uses the here-string form.
assert_has() {  # <label> <needle> (case-insensitive: titles are CSS-uppercased)
  if grep -qiF -- "$2" <<<"$BODY"; then ok "$1"
  else
    # diagnostic: capture the EXACT bytes the grep just missed
    printf '%s' "$BODY" > "/tmp/e2e-fail-body-$MODE_CUR.txt"
    fail "$1 — missing \"$2\" (len ${#BODY} md5 $(body_md5))"
  fi
}
assert_lacks_regex() {  # <label> <ERE> — mode-purity / regression guards
  if grep -qE -- "$2" <<<"$BODY"; then fail "$1 — unexpected /$2/"
  else ok "$1"; fi
}

# layout_eval <label> <js-that-returns-true>  — viewport-dependent contracts
layout_eval() {
  local v
  v=$(ab eval "$2" 2>/dev/null | tail -1)
  if [ "$v" = "true" ]; then ok "$1"; else fail "$1 (eval → ${v:-empty})"; fi
}

# assert_no_js_errors <mode> — console [error] lines + page errors so far.
# Console accumulates per session; callers clear after collecting.
assert_no_js_errors() {
  local console_out page_errs n_errs
  console_out=$(ab console 2>/dev/null || true)
  page_errs=$(ab errors 2>/dev/null || true)
  n_errs=$(printf '%s\n' "$console_out" | grep -c '^\[error\]')
  if [ "$n_errs" -eq 0 ] && ! grep -q '[^[:space:]]' <<<"${page_errs:-}"; then
    ok "$1: zero console errors, zero page errors"
  else
    fail "$1: $n_errs console error(s), page errors: ${page_errs:-none}"
    printf '%s\n' "$console_out" | grep '^\[error\]' | head -3 | sed 's/^/      /'
  fi
  ab console --clear >/dev/null 2>&1 || true
  ab errors --clear  >/dev/null 2>&1 || true
}

# ───────────────────────── preflight ─────────────────────────
hr "E2E @ $(date -u '+%Y-%m-%d %H:%M:%SZ') · $BASE_URL"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "  ERROR: agent-browser not on PATH"; exit 1
fi
http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/" || true)
http_code=${http_code:-000}
if [ "$http_code" != "200" ]; then
  echo "  ERROR: dev server not serving $BASE_URL (HTTP $http_code) — start it first"; exit 1
fi
# OOM citizenship (learned the hard way — see worklog Task 55): this box has
# ~4.1 GB RAM, no swap. The dev server alone holds 1.2–1.8 GB; the headless
# Chromium adds ~0.5–1 GB. Running e2e on a low-memory box OOM-kills the
# DEV SERVER (the kernel picks the biggest RSS) — the verification tool
# destroys the thing it verifies. Refuse to run when headroom is thin;
# also refuse if stray agent-browser sessions are already holding browsers.
avail_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
if [ "${avail_kb:-0}" -lt 1500000 ]; then
  echo "  ERROR: only $((avail_kb/1024)) MB memory available (< 1500 MB) — e2e would risk OOM-killing the dev server. Free memory first (e.g. close stray browsers: agent-browser session list)."
  exit 1
fi
stray=$(agent-browser session list 2>/dev/null | grep -Ev '^(Active sessions:|→|No active)' | grep -Ec .)
if [ "$stray" -gt 0 ]; then
  # A just-finished run's session can still be listed for a second while the
  # daemon tears its browser down — give it a moment before declaring strays.
  sleep 3
  stray=$(agent-browser session list 2>/dev/null | grep -Ev '^(Active sessions:|→|No active)' | grep -Ec .)
fi
if [ "$stray" -gt 0 ]; then
  echo "  ERROR: $stray stray agent-browser session(s) already hold browsers — close them first (agent-browser --session NAME close) to avoid stacking Chromium instances into another OOM."
  agent-browser session list 2>/dev/null | sed 's/^/      /'
  exit 1
fi
ok "preflight: agent-browser $(agent-browser --version 2>/dev/null | head -1) · HTTP 200 · $((avail_kb/1024)) MB available · no stray browser sessions"

# ───────────────────────── one mode's golden path ─────────────────────────
# run_mode <local|remote> <url> <pill-text>
# ORDERING IS LOAD-BEARING (verified the hard way — see worklog Task 55):
#   the "live monitor" click MUST come after hydration. A fresh load always
#   starts on the engine view, and the SSR'd button exists in the DOM before
#   React attaches its onClick — clicking pre-hydration is a silent no-op
#   and the page STAYS on the engine view while the pill (view-independent,
#   header) still renders and fools the wait. The pill only appears after
#   the client-side status fetch resolves, which only runs post-hydration —
#   so pill-wait ⇒ hydrated ⇒ the click is guaranteed live. The monitor
#   content wait after the click is the proof the view actually switched.
run_mode() {
  local mode=$1 url=$2 pill=$3

  hr "MODE: $mode ($url)"

  ab set viewport 1440 900 >/dev/null 2>&1
  ab open "$url" >/dev/null 2>&1
  ab wait --text "command center" --timeout 30000 >/dev/null 2>&1 \
    || fail "$mode: header never rendered (page blank / crashed?)"

  # The strongest single wait: this pill only renders when the status fetch
  # resolved AND the data plane is fresh AND (local) the runner is alive —
  # and, critically, that fetch is a client effect, so this also gates the
  # click below on hydration being complete.
  if ab wait --text "$pill" --timeout 30000 >/dev/null 2>&1; then
    ok "$mode: live pill rendered — \"$pill\" (⇒ hydrated, data plane green)"
  else
    fail "$mode: live pill \"$pill\" never appeared — data plane degraded (recon.sh says which)"
  fi

  # The default-tab gotcha, encoded: a fresh load ALWAYS starts on the engine
  # view — safe to click now, hydration is done (see comment above).
  ab find role button click --name "live monitor" >/dev/null 2>&1 \
    || fail "$mode: 'live monitor' button not found/clickable"

  # Proof the view actually switched. NB: card titles are CSS-uppercased
  # ("PAPER CYCLES") and agent-browser's text matching proved case-sensitive —
  # a lowercase needle against an uppercased title fails forever. The
  # case-stable marker is the view hint "live paper-validation data": plain
  # text, no text-transform, rendered ONLY in the monitor view.
  ab wait --text "live paper-validation data" --timeout 15000 >/dev/null 2>&1 \
    || fail "$mode: monitor content never rendered after the click (view stuck on engine?)"

  BODY=$(body_text)
  MODE_CUR="$mode"
  # Always stage the body in /tmp: zero repo side effects, and any transient
  # assertion failure becomes diagnosable post-hoc (length + grep the dump).
  printf '%s' "$BODY" > "/tmp/e2e-body-$mode.txt"
  printf '  (body: %d chars, md5 %s, dump /tmp/e2e-body-%s.txt)\n' "${#BODY}" "$(body_md5)" "$mode"

  # cards (source-lowercase, rendered uppercase — grep -i everywhere)
  assert_has "$mode: paper cycles card"        "paper cycles"
  assert_has "$mode: ledger card"              "paper positions ledger"
  assert_has "$mode: exit classification card" "exit classification"
  assert_has "$mode: economics card"           "economic decomposition"
  assert_has "$mode: runner log card"          "runner log"

  # coverage/evidence labels
  assert_has  "$mode: ledger coverage label"   "ledger rows"
  assert_has  "$mode: lifetime coverage label" "experiment-lifetime"
  assert_has  "$mode: whole-ledger counts"     "(all-time)"

  if [ "$mode" = "local" ]; then
    # MODE PURITY (Task 54 guard): local reads the live files — an evidence
    # suffix here means the remote snapshot plane leaked into local mode.
    assert_lacks_regex "$mode: no evidence suffix (live plane)" "$EVIDENCE_RE"
  else
    # Task 54: the evidence cards carry the snapshot age where the numbers
    # appear. 3 cards when the economics card renders; ≥2 tolerates a
    # legitimately-hidden conditional card, still catches "suffixes gone".
    local n_suffix
    n_suffix=$(printf '%s' "$BODY" | grep -oE "$EVIDENCE_RE" | wc -l)
    if [ "$n_suffix" -ge 2 ]; then
      ok "$mode: evidence suffix on $n_suffix card(s) — labeled staleness"
    else
      fail "$mode: only $n_suffix evidence suffix(es) — snapshot plane unlabeled again?"
    fi
  fi

  # layout contracts, desktop then mobile
  layout_eval "$mode desktop: no horizontal overflow" \
    "document.documentElement.scrollWidth <= window.innerWidth"
  layout_eval "$mode desktop: footer present, content fills viewport (sticky contract)" \
    "document.querySelectorAll('footer').length > 0 && document.documentElement.scrollHeight >= window.innerHeight"
  shot "e2e-$mode-desktop"

  ab set viewport 390 844 >/dev/null 2>&1
  sleep 1  # let the reflow settle before measuring
  layout_eval "$mode mobile 390: no horizontal overflow" \
    "document.documentElement.scrollWidth <= window.innerWidth"
  layout_eval "$mode mobile 390: footer present, content fills viewport (sticky contract)" \
    "document.querySelectorAll('footer').length > 0 && document.documentElement.scrollHeight >= window.innerHeight"
  shot "e2e-$mode-mobile"

  assert_no_js_errors "$mode"
}

run_mode local  "$BASE_URL/"                "runner live · data fresh"
run_mode remote "$BASE_URL/?source=remote"  "collector live · data fresh"

# ───────────────────────── verdict ─────────────────────────
hr "VERDICT"
if [ "$FAILED" -eq 0 ]; then
  echo "  GOLDEN PATH GREEN — page renders, both data planes labeled, no JS errors, responsive, footer contract holds."
else
  echo "  NEEDS EYES — reasons:"
  for r in "${REASONS[@]}"; do echo "    · $r"; done
fi
exit "$FAILED"
