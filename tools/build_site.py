#!/usr/bin/env python3
"""Build the generic Atlas PWA and optionally inject Release media."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import zipfile

from build_content import build as build_content
from content_model import ContentTree, ROOT, sha256_bytes


SHELL_FILES = (
    "index.html",
    "styles.css",
    "app.js",
    "map-logic.js",
    "sw.js",
    "manifest.webmanifest",
)
SHELL_DIRECTORIES = ("icons", "vendor")


def safe_output(path: Path) -> Path:
    output = path.resolve()
    workspace = ROOT.resolve()
    if output == workspace or workspace not in output.parents:
        raise ValueError(f"Output must be a subdirectory of the workspace: {output}")
    return output


def safe_member(name: str) -> bool:
    value = PurePosixPath(name)
    return (
        not value.is_absolute()
        and ".." not in value.parts
        and "\\" not in name
        and (name == "media-package.json" or (value.parts and value.parts[0] == "content"))
    )


def extract_media(media: Path, destination: Path, tree: ContentTree) -> dict:
    with zipfile.ZipFile(media) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate entries in media ZIP")
        if not all(safe_member(name) for name in names):
            raise ValueError("Media ZIP contains an unsafe or unsupported path")
        if "media-package.json" not in names:
            raise ValueError("Use tools/pack_media.py to create the Release ZIP")
        index = json.loads(archive.read("media-package.json"))
        if index.get("format") != 3:
            raise ValueError("Outdated media ZIP; rebuild atlas-media.zip")
        if index.get("content_revision") != tree.catalog["content_revision"]:
            raise ValueError("Media ZIP belongs to a different content revision")
        indexed_paths = {entry["path"] for entry in index.get("files", [])}
        archive_paths = set(names) - {"media-package.json"}
        if indexed_paths != archive_paths:
            raise ValueError("Media ZIP file list does not match media-package.json")
        for entry in index["files"]:
            data = archive.read(entry["path"])
            if len(data) != entry["bytes"] or sha256_bytes(data) != entry["sha256"]:
                raise ValueError("Media integrity check failed: " + entry["path"])
            target = destination / entry["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return index


def git_revision() -> str:
    configured = os.environ.get("GITHUB_SHA", "").strip()
    if configured:
        return configured
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build_metadata(tree: ContentTree, media_index: dict | None, release_tag: str) -> dict:
    media_payload = json.dumps(media_index or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    media_sha256 = hashlib.sha256(media_payload.encode("utf-8")).hexdigest()
    commit = git_revision()
    seed = "\n".join((tree.catalog["content_revision"], release_tag, commit, media_sha256))
    build_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]
    files = (media_index or {}).get("files", [])
    missing = (media_index or {}).get("missing", [])
    return {
        "schema_version": 1,
        "version": release_tag,
        "build_id": build_id,
        "media_release": release_tag if media_index else None,
        "content_revision": tree.catalog["content_revision"],
        "git_commit": commit,
        "built_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "media_files": len(files),
        "media_missing": len(missing),
        "media_sha256": media_sha256,
    }


def inject_build_id(service_worker: Path, build_id: str) -> None:
    source = service_worker.read_text(encoding="utf-8")
    placeholder = "__ATLAS_BUILD_ID__"
    if source.count(placeholder) != 1:
        raise ValueError("sw.js must contain exactly one build ID placeholder")
    service_worker.write_text(source.replace(placeholder, build_id), encoding="utf-8")


def build_site(output: Path, media: Path | None, require_complete: bool, release_tag: str) -> dict:
    output = safe_output(output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in SHELL_FILES:
        shutil.copy2(ROOT / name, output / name)
    for name in SHELL_DIRECTORIES:
        shutil.copytree(ROOT / name, output / name)

    tree = ContentTree()
    media_index = None
    if media:
        media_index = extract_media(media.resolve(), output, tree)
    result = build_content(output, require_complete=require_complete)
    metadata = build_metadata(tree, media_index, release_tag)
    metadata_path = output / "content-data" / "build-info.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    inject_build_id(output / "sw.js", metadata["build_id"])
    result["build_info"] = metadata
    print(f"Built site: {output}")
    print(f"Version: {metadata['version']} (build {metadata['build_id']})")
    if media_index:
        print(f"Injected {len(media_index['files'])} media files from {media}")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, help="atlas-media.zip from a media-v* Release")
    parser.add_argument("--out", type=Path, default=ROOT / "_site")
    parser.add_argument("--require-complete", action="store_true", help="require every declared city-package asset")
    parser.add_argument(
        "--release-tag",
        default=os.environ.get("ATLAS_MEDIA_RELEASE", "preview"),
        help="release tag recorded in build-info.json (default: ATLAS_MEDIA_RELEASE or preview)",
    )
    args = parser.parse_args(argv)
    build_site(args.out, args.media, args.require_complete, args.release_tag)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(f"ERROR: {error}")
