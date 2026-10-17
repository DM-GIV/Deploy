#!/usr/bin/env python3
"""Build the explicit static Selectel payload; server/API sources are excluded."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT_FILES = {"index.html", "404.html", "favicon.ico", "robots.txt", "sitemap.xml", "llms.txt", "yandex_dcff75ab84eb360e.html", "b9b9a861bbfa8cfb5b68212f4817fabe.txt"}
EXCLUDED_ROUTE_ROOTS = {"docs", "services", "tests", "scripts", "api", "lib", "content", ".github"}
RELEASE_EXCLUSIONS = Path("content/editorial/release-exclusions.json")


def tracked_files(root: Path) -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=root)
    return [Path(item.decode("utf-8")) for item in output.split(b"\0") if item]


def is_static_payload(path: Path) -> bool:
    text = path.as_posix()
    if text in ROOT_FILES or text.startswith("assets/"):
        return True
    return path.name == "index.html" and len(path.parts) >= 2 and path.parts[0] not in EXCLUDED_ROUTE_ROOTS


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_release(root: Path, output: Path, *, allow_dirty: bool = False) -> dict:
    root = root.resolve()
    output = output.resolve()
    if output.exists():
        raise FileExistsError(f"release output already exists: {output}")
    if not allow_dirty:
        dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
        if dirty:
            raise RuntimeError("refusing to build a release from a dirty worktree")
    exclusion_data = json.loads((root / RELEASE_EXCLUSIONS).read_text(encoding="utf-8"))
    excluded = {Path(value) for value in exclusion_data.get("paths", [])}
    files = sorted(path for path in tracked_files(root) if is_static_payload(path) and path not in excluded)
    required = {Path(name) for name in ROOT_FILES}
    if not required.issubset(files):
        raise RuntimeError(f"missing required tracked files: {sorted(str(p) for p in required - set(files))}")
    forbidden = [path for path in files if path.suffix in {".env", ".sqlite", ".sqlite3"} or "secret" in path.name.lower()]
    if forbidden:
        raise RuntimeError(f"forbidden release files: {forbidden}")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        manifest_files = []
        for relative in files:
            source = root / relative
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            os.chmod(target, 0o644)
            manifest_files.append({"path": relative.as_posix(), "bytes": target.stat().st_size, "sha256": sha256(target)})
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        manifest = {"schema": "torgatlas-static-release-v1", "source_commit": head, "excluded_owner_approval_paths": sorted(path.as_posix() for path in excluded), "files": manifest_files}
        manifest_path = temporary / "release-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(manifest_path, 0o644)
        # mkdtemp creates 0700; the web server runs as another user and must be able to traverse the release.
        for directory in [temporary, *[d for d in temporary.rglob('*') if d.is_dir()]]:
            os.chmod(directory, 0o755)
        os.replace(temporary, output)
        return manifest
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--root", default=Path(__file__).resolve().parents[1], type=Path)
    args = parser.parse_args()
    manifest = build_release(args.root, args.output)
    print(json.dumps({"output": str(args.output.resolve()), "source_commit": manifest["source_commit"], "files": len(manifest["files"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
