#!/usr/bin/env bash
# The checks every change must pass before review: types, unit tests, a
# production build, the discovery files and the performance budget.
# CI runs the same steps (.github/workflows/deploy.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm test
npm run build
node scripts/check-discovery.mjs
node scripts/check-perf-budget.mjs
