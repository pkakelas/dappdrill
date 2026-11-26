#!/bin/sh
# Runs a command with a display on a machine that has none: a virtual one, kept in memory (Xvfb).
# A shown browser (DAPPDRILL_HEADLESS=0) then opens its windows there.
#   scripts/with-display.sh corepack pnpm probe https://app.example.com
set -e
export DISPLAY="${DISPLAY:-:99}"
socket="/tmp/.X11-unix/X${DISPLAY#:}"
if [ ! -S "$socket" ]; then
  Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 &
  tries=0
  until [ -S "$socket" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then
      echo "The virtual display $DISPLAY did not start. Is Xvfb installed?" >&2
      exit 1
    fi
    sleep 0.1
  done
fi
exec "$@"
