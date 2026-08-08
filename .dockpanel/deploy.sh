#!/usr/bin/env bash
set -euo pipefail

test -f docs/site/index.html

install -d public
cp -a docs/site/. public/
install -m 0644 \
  docs/ASSETS.md \
  docs/LEGAL.md \
  docs/OPERATIONS.md \
  docs/PUBLICATION.md \
  LICENSE \
  NOTICE.md \
  public/
