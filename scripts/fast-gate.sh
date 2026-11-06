#!/usr/bin/env bash
# The checks every change must pass before review: types, unit tests, a
# production build, the discovery files, the performance budget, and docs
# that name every hook, API and extension point in the code.
# CI runs the same steps (.github/workflows/deploy.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm test
npm run build
node scripts/check-discovery.mjs
node scripts/check-perf-budget.mjs
node scripts/check-docs.mjs
