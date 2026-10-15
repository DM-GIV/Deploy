#!/bin/bash
# Regenerate everything derived from sources, in dependency order. Run after editing assets, article content or navigation.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/apply-site-nav.py
python3 scripts/generate-articles.py
python3 scripts/generate-sitemap.py
python3 scripts/fingerprint-assets.py
