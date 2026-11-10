#!/usr/bin/env python3
"""Compile the folder-based Atlas content tree into generic app packages."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import shutil

from content_model import CONTENT_ROOT, ROOT, ContentTree, read_json, relative, sha256_bytes, sha256_file


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "./" + path.resolve().relative_to(ROOT.resolve()).as_posix()


def package_web_path(package_id: str) -> str:
    return f"./content-data/packages/{package_id}.json"


def country_hero_asset(country) -> Path | None:
    value = country.manifest.get("hero", {}).get("art")
    if not value:
        return None
    country_root = country.path.resolve()
    source = (country.path / value).resolve()
    try:
        source.relative_to(country_root)
    except ValueError as error:
        raise ValueError(f"Country hero art must stay inside {country.path}: {value}") from error
    return source


def compile_stories(tree: ContentTree, manifest: dict, scope_root: Path) -> dict:
    result = {
        "id": manifest["id"],
        "title": manifest["title"],
        "sections": copy.deepcopy(manifest.get("sections", [])),
        "episodes": [],
    }
    for episode in manifest.get("episodes", []):
        item = copy.deepcopy(episode)
        item["text"] = (scope_root / episode["audio_text_path"]).read_text(encoding="utf-8").strip()
        item["audio"] = web_path(scope_root / episode["audio_path"])
        result["episodes"].append(item)
    return result


def compile_country(tree: ContentTree, country) -> dict:
    stories, scope_root = tree.country_stories(country)
    public_manifest = copy.deepcopy(country.manifest)
    hero_asset = country_hero_asset(country)
    if hero_asset:
        public_manifest["hero"]["art"] = web_path(hero_asset)
    return {
        "schema_version": 2,
        "package": {
            "id": country.manifest["id"],
            "scope": "country",
            "revision": country.manifest["revision"],
        },
        "country": {
            "id": country.manifest["country_id"],
            "title": country.catalog["title"],
            "language": country.manifest.get("language", tree.catalog.get("language", "ru")),
            "manifest": public_manifest,
        },
        "stories": compile_stories(tree, stories, scope_root),
    }


def compile_point(point) -> dict:
    item = copy.deepcopy(point.meta)
    for narration in item.get("narrations", {}).values():
        narration_path = point.path / narration["text"]
        audio_path = point.path / narration["audio"]
        narration["text"] = narration_path.read_text(encoding="utf-8").strip()
        narration["audio"] = web_path(audio_path)
    photo = item.get("media", {}).get("photo")
    if photo and photo.get("path"):
        photo["path"] = "./" + photo["path"].removeprefix("./")
    return item


def compile_city(tree: ContentTree, city) -> dict:
    stories, scope_root = tree.city_stories(city)
    attractions = []
    for attraction in tree.attractions:
        if attraction.city.path != city.path:
            continue
        item = copy.deepcopy(attraction.manifest)
        item["programs"] = {
            "full": read_json(attraction.path / attraction.manifest["full_program"]),
            "must_see": read_json(attraction.path / attraction.manifest["must_see_program"]),
        }
        item["points"] = [compile_point(point) for point in tree.points if point.attraction.path == attraction.path]
        attractions.append(item)
    return {
        "schema_version": 2,
        "package": {
            "id": city.manifest["id"],
            "scope": "city",
            "revision": city.manifest["revision"],
            "requires": [item["package_id"] for item in city.manifest.get("requires", [])],
        },
        "country": {
            "id": city.country.manifest["country_id"],
            "title": city.country.catalog["title"],
            "package_id": city.country.manifest["id"],
        },
        "city": {
            "id": city.manifest["city_id"],
            "title": city.manifest["title"],
            "language": city.manifest.get("language", tree.catalog.get("language", "ru")),
            "content_status": city.manifest.get("content_status"),
            "factcheck_status": city.manifest.get("factcheck_status"),
            "map": copy.deepcopy(city.manifest.get("map")),
        },
        "stories": compile_stories(tree, stories, scope_root),
        "attractions": attractions,
    }


def copy_tracked_package_assets(tree: ContentTree, site_root: Path) -> None:
    for country in tree.countries:
        source = country_hero_asset(country)
        if not source:
            continue
        destination = site_root / source.relative_to(ROOT)
        if source.resolve() == destination.resolve():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for attraction in tree.attractions:
        image = attraction.manifest.get("map", {}).get("image")
        if not image:
            continue
        source = ROOT / image.removeprefix("./")
        destination = site_root / image.removeprefix("./")
        if source.resolve() == destination.resolve():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def expected_package_assets(tree: ContentTree) -> dict[str, list[tuple[str, str]]]:
    result: dict[str, list[tuple[str, str]]] = {}
    for country in tree.countries:
        result[country.manifest["id"]] = [(package_web_path(country.manifest["id"]), "package")]
        hero_asset = country_hero_asset(country)
        if hero_asset:
            result[country.manifest["id"]].append((web_path(hero_asset), "country-hero"))
    for city in tree.cities:
        result[city.manifest["id"]] = [(package_web_path(city.manifest["id"]), "package")]
    for track in tree.audio_tracks():
        result[track.package_id].append((web_path(track.output), "audio"))
    for photo in tree.photos():
        result[photo.package_id].append((web_path(photo.output), "photo"))
    for map_asset in tree.maps():
        result[map_asset.package_id].append((web_path(map_asset.output), "map"))
        image = map_asset.attraction.manifest.get("map", {}).get("image")
        if image:
            result[map_asset.package_id].append(("./" + image.removeprefix("./"), "map-plan"))
    for map_asset in tree.city_maps():
        result[map_asset.package_id].append((web_path(map_asset.output), "city-map"))
    return result


def build_catalog(tree: ContentTree) -> dict:
    countries = []
    for country in tree.countries:
        cities = []
        for city in tree.cities:
            if city.country.path != country.path:
                continue
            cities.append(
                {
                    "id": city.manifest["city_id"],
                    "title": city.manifest["title"],
                    "package_id": city.manifest["id"],
                    "package_url": package_web_path(city.manifest["id"]),
                    "requires": [item["package_id"] for item in city.manifest.get("requires", [])],
                    "attraction_count": len(city.manifest.get("attractions", [])),
                    "story_count": len(tree.city_stories(city)[0].get("episodes", [])),
                }
            )
        countries.append(
            {
                "id": country.manifest["country_id"],
                "title": country.catalog["title"],
                "package_id": country.manifest["id"],
                "package_url": package_web_path(country.manifest["id"]),
                "revision": country.manifest["revision"],
                "story_count": len(tree.country_stories(country)[0].get("episodes", [])),
                "cities": cities,
            }
        )
    return {
        "schema_version": 2,
        "project": tree.catalog.get("project", "Atlas"),
        "language": tree.catalog.get("language", "ru"),
        "content_revision": tree.catalog["content_revision"],
        "countries": countries,
    }


def build_offline_manifest(tree: ContentTree, site_root: Path, require_complete: bool) -> dict:
    expected = expected_package_assets(tree)
    packages = []
    missing_total = []
    country_by_package = {country.manifest["id"]: country for country in tree.countries}
    city_by_package = {city.manifest["id"]: city for city in tree.cities}
    for package_id, entries in expected.items():
        files = []
        missing = []
        seen = set()
        for path_value, kind in entries:
            clean = path_value.removeprefix("./")
            if clean in seen:
                raise ValueError(f"Duplicate file in package {package_id}: {clean}")
            seen.add(clean)
            source = site_root / clean
            if not source.is_file():
                missing.append({"path": "./" + clean, "kind": kind})
                missing_total.append(f"{package_id}:{clean}")
                continue
            files.append(
                {
                    "path": "./" + clean,
                    "kind": kind,
                    "bytes": source.stat().st_size,
                    "sha256": sha256_file(source),
                }
            )
        if package_id in country_by_package:
            node = country_by_package[package_id]
            record = {
                "id": package_id,
                "scope": "country",
                "country_id": node.manifest["country_id"],
                "title": node.catalog["title"] + " · общий пакет",
                "_declared_revision": node.manifest["revision"],
                "requires": [],
            }
        else:
            node = city_by_package[package_id]
            record = {
                "id": package_id,
                "scope": "city",
                "country_id": node.country.manifest["country_id"],
                "city_id": node.manifest["city_id"],
                "title": node.manifest["title"],
                "_declared_revision": node.manifest["revision"],
                "requires": [item["package_id"] for item in node.manifest.get("requires", [])],
            }
        record["files"] = files
        record["missing"] = missing
        record["bytes"] = sum(item["bytes"] for item in files)
        packages.append(record)

    package_by_id = {item["id"]: item for item in packages}
    for record in sorted(packages, key=lambda item: item["scope"] != "country"):
        dependency_revisions = {
            package_id: package_by_id[package_id]["revision"]
            for package_id in record["requires"]
        }
        revision_payload = {
            "declared_revision": record.pop("_declared_revision"),
            "dependencies": dependency_revisions,
            "files": [(item["path"], item["sha256"]) for item in record["files"]],
            "missing": [item["path"] for item in record["missing"]],
        }
        canonical = json.dumps(revision_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        record["revision"] = sha256_bytes(canonical.encode("utf-8"))[:16]
    if require_complete and missing_total:
        preview = "\n".join("  - " + item for item in missing_total[:30])
        suffix = "" if len(missing_total) <= 30 else f"\n  ... and {len(missing_total) - 30} more"
        raise ValueError(f"Content packages are incomplete ({len(missing_total)} missing):\n{preview}{suffix}")
    return {
        "schema_version": 2,
        "cache_name": "atlas-content-v2",
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "packages": packages,
    }


def build(site_root: Path, require_complete: bool = False) -> dict:
    site_root = site_root.resolve()
    tree = ContentTree()
    data_root = site_root / "content-data"
    package_root = data_root / "packages"
    package_root.mkdir(parents=True, exist_ok=True)
    copy_tracked_package_assets(tree, site_root)
    for country in tree.countries:
        write_json(package_root / f"{country.manifest['id']}.json", compile_country(tree, country))
    for city in tree.cities:
        write_json(package_root / f"{city.manifest['id']}.json", compile_city(tree, city))
    catalog = build_catalog(tree)
    write_json(data_root / "catalog.json", catalog)
    offline = build_offline_manifest(tree, site_root, require_complete)
    write_json(data_root / "offline-packages.json", offline)
    return {"summary": tree.summary(), "packages": offline["packages"]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-root", type=Path, default=ROOT, help="site directory receiving content-data")
    parser.add_argument("--require-complete", action="store_true", help="fail if any package media are missing")
    args = parser.parse_args(argv)
    result = build(args.site_root, args.require_complete)
    summary = result["summary"]
    print(
        "Content compiled: "
        f"{summary['countries']} countries, {summary['cities']} cities, "
        f"{summary['attractions']} attractions, {summary['points']} points, "
        f"{summary['audio']} audio tracks"
    )
    for package in result["packages"]:
        print(
            f"  {package['id']}: {len(package['files'])} files, "
            f"{package['bytes'] / 1024 / 1024:.1f} MiB, missing {len(package['missing'])}"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        raise SystemExit(f"ERROR: {error}")
