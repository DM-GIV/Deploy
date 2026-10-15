#!/usr/bin/env python3
"""Version every local CSS/JS reference by CONTENT: /assets/x.css -> /assets/x.css?v=<first 12 hex of sha256(file)>.

Why: nginx serves /assets/* with max-age=86400. A changed stylesheet under an unchanged URL stays stale in returned visitors' caches and
breaks pages whose HTML (always revalidated) already uses the new rules (the reported "articles stuck to the edge" defect).
With a content fingerprint the URL changes exactly when the file changes, so no stale file can be used after a release.

  python3 scripts/fingerprint-assets.py           rewrite the references in every tracked HTML page
  python3 scripts/fingerprint-assets.py --check   fail if any reference is missing a fingerprint or has a wrong one
Vendored third-party assets (/assets/vendor/...) keep their own version query.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = re.compile(r'((?:href|src)=")(/assets/(?!vendor/)[A-Za-z0-9_.\-]+\.(?:css|js))(\?v=[A-Za-z0-9.]+)?(")')


def fingerprint(rel: str) -> str:
    return hashlib.sha256((ROOT / rel.lstrip("/")).read_bytes()).hexdigest()[:12]


def pages() -> list[str]:
    names = subprocess.check_output(["git", "ls-files", "*.html"], cwd=ROOT, text=True).split()
    return [n for n in names if not n.startswith("tests/")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    problems, changed = [], 0
    for name in pages():
        path = ROOT / name
        text = path.read_text(encoding="utf-8")

        def fix(match):
            asset = match.group(2)
            if not (ROOT / asset.lstrip("/")).is_file():
                problems.append(f"{name}: missing asset {asset}")
                return match.group(0)
            wanted = f"?v={fingerprint(asset)}"
            if match.group(3) != wanted:
                problems.append(f"{name}: {asset}{match.group(3) or ''} should be {asset}{wanted}")
            return f"{match.group(1)}{asset}{wanted}{match.group(4)}"

        new = REF.sub(fix, text)
        if not args.check and new != text:
            path.write_text(new, encoding="utf-8")
            changed += 1
    if args.check and problems:
        print("\n".join(problems[:30]), file=sys.stderr)
        return 1
    if not args.check:
        print(f"fingerprinted {changed} page(s)")
        if any("missing asset" in p for p in problems):
            print("\n".join(problems[:30]), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
