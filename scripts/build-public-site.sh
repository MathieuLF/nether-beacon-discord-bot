#!/usr/bin/env bash
set -euo pipefail

repository="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repository"
exec node scripts/build-public-site.js
