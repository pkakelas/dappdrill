#!/usr/bin/env bash
# Serializes pnpm commands across parallel agents working in one checkout.
# Usage: scripts/pnpm-locked.sh add zod --filter @dappdrill/core
set -euo pipefail
exec /usr/bin/lockf -t 600 "$(dirname "$0")/../.pnpm.lock" corepack pnpm "$@"
