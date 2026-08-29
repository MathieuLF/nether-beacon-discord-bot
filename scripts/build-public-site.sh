#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-public}"

test -f docs/site/index.html
rm -rf -- "$output_dir"
install -d -- "$output_dir"
cp -a docs/site/. "$output_dir/"
install -m 0644 \
  docs/ASSETS.md \
  docs/LEGAL.md \
  docs/OPERATIONS.md \
  docs/PUBLICATION.md \
  LICENSE \
  NOTICE.md \
  "$output_dir/"

printf 'Static site assembled in %s\n' "$output_dir"
