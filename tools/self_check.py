#!/usr/bin/env python3
"""Validate the generic Atlas content model and app integration."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

from content_model import ContentTree, ROOT


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> int:
    tree = ContentTree()
    summary = tree.summary()
    if (summary["countries"], summary["cities"], summary["attractions"], summary["points"], summary["audio"]) != (1, 3, 12, 82, 217):
        fail(f"Unexpected migrated Egypt baseline: {summary}")

    point_ids = {point.meta["id"] for point in tree.points}
    for point in tree.points:
        for name, narration in point.meta["narrations"].items():
            text = (point.path / narration["text"]).read_text(encoding="utf-8").strip()
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if digest != narration["text_sha256"]:
                fail(f"Text checksum drift: {point.meta['id']}:{name}")
    for attraction in tree.attractions:
        local_ids = {item["id"] for item in attraction.manifest["points"]}
        map_data = attraction.manifest.get("map", {})
        center = map_data.get("center", [])
        if len(center) != 2 or not all(isinstance(value, (int, float)) for value in center):
            fail(f"Attraction lacks a usable city-map center: {attraction.manifest['id']}")
        if map_data.get("defaultView") != "plan":
            geo_ids = set(map_data.get("geoPoints", {}))
            located_ids = {
                point.meta["id"] for point in tree.points
                if point.attraction.path == attraction.path and point.meta.get("location")
            }
            missing_map_points = local_ids - geo_ids - located_ids
            if missing_map_points:
                fail(f"Live-map attraction has unmapped points: {attraction.manifest['id']} {sorted(missing_map_points)}")
        for filename in (attraction.manifest["full_program"], attraction.manifest["must_see_program"]):
            program = json.loads((attraction.path / filename).read_text(encoding="utf-8"))
            referenced = set(program.get("ordered_point_ids", [])) | set(program.get("optional_point_ids", []))
            if not referenced <= local_ids:
                fail(f"Program references foreign points: {attraction.manifest['id']} {sorted(referenced-local_ids)}")
    if len(point_ids) != summary["points"]:
        fail("Point IDs are not globally unique")

    required = (
        "index.html", "styles.css", "app.js", "map-logic.js", "sw.js", "manifest.webmanifest",
        "generate_all.py", "download_commons_photos.py", "download_offline_maps.py",
        "tools/content_model.py", "tools/build_content.py", "tools/build_site.py", "tools/pack_media.py",
        "GENERATE_ALL_WINDOWS.bat", "DOWNLOAD_PHOTOS_WINDOWS.bat", "DOWNLOAD_ALL_MAPS_WINDOWS.bat",
        "PACK_MEDIA_WINDOWS.bat", "docs/CONTENT_ARCHITECTURE.md",
    )
    for name in required:
        if not (ROOT / name).is_file():
            fail(f"Missing required file: {name}")
    if (ROOT / "Atlas_Content_Pack_v2").exists():
        fail("Atlas_Content_Pack_v2 must be empty/removed after migration")
    app_source = (ROOT / "app.js").read_text(encoding="utf-8")
    if "EgyptAtlasCatalog" in app_source or "catalog.js" in (ROOT / "index.html").read_text(encoding="utf-8"):
        fail("Legacy hard-coded catalog is still wired into the app")
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    for expected in ("media-v", "atlas-media.zip", "ATLAS_MEDIA_RELEASE", "--require-complete"):
        if expected not in workflow:
            fail(f"Pages workflow lacks {expected}")
    service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    for expected in ("__ATLAS_BUILD_ID__", "build-info.json"):
        if expected not in service_worker:
            fail(f"Service worker lacks generated-version support: {expected}")
    if "BUILD_INFO_URL" not in app_source:
        fail("App does not display generated build metadata")
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for expected in ("/content/**/audio/*.mp3", "/content/**/photo.jpg", "/content/**/map.pmtiles", "/atlas-media.zip"):
        if expected not in ignored:
            fail(f"Missing generated-media ignore rule: {expected}")
    print(
        "PASS: generic Atlas content tree; "
        f"{summary['countries']} country, {summary['cities']} cities, "
        f"{summary['attractions']} attractions, {summary['points']} points, {summary['audio']} audio tracks"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, ValueError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
