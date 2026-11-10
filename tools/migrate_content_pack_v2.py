#!/usr/bin/env python3
"""One-time migration of Atlas_Content_Pack_v2 into the generic Atlas tree."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Atlas_Content_Pack_v2"
CONTENT = ROOT / "content"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.strip().encode("utf-8")).hexdigest()


def safe_root(path: Path) -> Path:
    resolved = path.resolve()
    workspace = ROOT.resolve()
    if resolved == workspace or workspace not in resolved.parents:
        raise RuntimeError(f"Unsafe migration path: {resolved}")
    return resolved


def move_file(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise RuntimeError(f"Migration destination already exists: {destination}")
    shutil.move(str(source), str(destination))


def load_legacy_catalog() -> list[dict]:
    source = (ROOT / "catalog.js").read_text(encoding="utf-8")
    return json.loads(source[source.index("[") : source.rfind("]") + 1])


def transform_story_manifest(path: Path, scope_root: Path) -> None:
    manifest = read_json(path)
    manifest["id"] = manifest["id"].replace("radio-", "stories-")
    manifest["kind"] = "stories"
    for episode in manifest.get("episodes", []):
        episode["kind"] = "story"
        episode["audio_text_path"] = episode["audio_text_path"].replace("radio/", "stories/", 1)
        episode["audio_path"] = f"stories/audio/{episode['id']}.mp3"
    write_json(path, manifest)


def transform_content_tree() -> None:
    catalog = read_json(CONTENT / "catalog.json")
    catalog["schema_version"] = 2
    catalog["download_lifecycle"] = "city packages with shared country dependencies"
    for country in catalog["countries"]:
        country.pop("shared_archive", None)
        for city in country["cities"]:
            city.pop("archive", None)
            city["attraction_count"] = city.pop("tour_count")
            city["story_count"] = city.pop("radio_count")
    write_json(CONTENT / "catalog.json", catalog)

    for country_dir in sorted((CONTENT / "countries").iterdir()):
        if not country_dir.is_dir():
            continue
        country = read_json(country_dir / "manifest.json")
        old_radio = country_dir / "radio"
        stories_dir = country_dir / "stories"
        if old_radio.exists():
            old_radio.rename(stories_dir)
        country["stories"] = str(country.pop("radio")).replace("radio/", "stories/", 1)
        country["content_type"] = "country"
        write_json(country_dir / "manifest.json", country)
        transform_story_manifest(stories_dir / "manifest.json", country_dir)

        for city_dir in sorted((country_dir / "cities").iterdir()):
            if not city_dir.is_dir():
                continue
            city = read_json(city_dir / "manifest.json")
            old_radio = city_dir / "radio"
            stories_dir = city_dir / "stories"
            if old_radio.exists():
                old_radio.rename(stories_dir)
            city["stories"] = str(city.pop("city_radio")).replace("radio/", "stories/", 1)
            transform_story_manifest(stories_dir / "manifest.json", city_dir)

            old_tours = city_dir / "tours"
            attractions_dir = city_dir / "attractions"
            if old_tours.exists():
                old_tours.rename(attractions_dir)
            city["attractions"] = city.pop("tours")
            for ref in city["attractions"]:
                ref["manifest"] = ref["manifest"].replace("tours/", "attractions/", 1)
            city["includes"] = [
                item.replace("city-radio", "city-stories").replace("city-tour", "city-attraction")
                for item in city.get("includes", [])
            ]
            write_json(city_dir / "manifest.json", city)

            for attraction_dir in sorted(attractions_dir.iterdir()):
                if not attraction_dir.is_dir():
                    continue
                attraction = read_json(attraction_dir / "manifest.json")
                old_stops = attraction_dir / "stops"
                points_dir = attraction_dir / "points"
                if old_stops.exists():
                    old_stops.rename(points_dir)
                attraction["points"] = attraction.pop("stops")
                for ref in attraction["points"]:
                    ref["meta"] = ref["meta"].replace("stops/", "points/", 1)
                attraction["main_points"] = attraction.pop("main_stops")
                attraction["optional_continuation_points"] = attraction.pop("optional_continuation_stops")
                attraction["content_type"] = "attraction"
                write_json(attraction_dir / "manifest.json", attraction)
                for program_name in ("full.json", "must-see.json"):
                    program_path = attraction_dir / "programs" / program_name
                    program = read_json(program_path)
                    program["ordered_point_ids"] = program.pop("ordered_stop_ids")
                    if "optional_continuation_ids" in program:
                        program["optional_point_ids"] = program.pop("optional_continuation_ids")
                    write_json(program_path, program)


def merge_legacy_metadata_and_media() -> tuple[int, int, int, int]:
    legacy = {tour["id"]: tour for tour in load_legacy_catalog()}
    reused_audio = stale_audio = moved_photos = moved_maps = 0
    archive_audio = ROOT / "content-archive" / "stale-audio-v025"

    for country_dir in sorted((CONTENT / "countries").iterdir()):
        for city_dir in sorted((country_dir / "cities").iterdir()):
            for attraction_dir in sorted((city_dir / "attractions").iterdir()):
                manifest_path = attraction_dir / "manifest.json"
                attraction = read_json(manifest_path)
                old = legacy[attraction["id"]]
                map_data = dict(old.get("map", {}))
                map_data["archive"] = str((attraction_dir / "map.pmtiles").relative_to(ROOT)).replace("\\", "/")
                image_value = map_data.get("image")
                if image_value:
                    old_image = ROOT / image_value.removeprefix("./")
                    new_image = attraction_dir / "map-plan.svg"
                    move_file(old_image, new_image)
                    map_data["image"] = str(new_image.relative_to(ROOT)).replace("\\", "/")
                old_map = ROOT / "maps" / "offline" / f"{attraction['id']}.pmtiles"
                new_map = attraction_dir / "map.pmtiles"
                if old_map.exists():
                    move_file(old_map, new_map)
                    moved_maps += 1
                attraction["map"] = map_data
                write_json(manifest_path, attraction)

                old_points = {
                    point["id"]: point
                    for point in old.get("stops", []) + old.get("extension", {}).get("stops", [])
                }
                for point_ref in attraction["points"]:
                    point_dir = attraction_dir / "points" / point_ref["id"]
                    meta_path = point_dir / "meta.json"
                    meta = read_json(meta_path)
                    old_point = old_points[point_ref["id"]]
                    meta["summary"] = old_point.get("summary", "")
                    meta["where_to_listen"] = old_point.get("position", "")
                    meta["location"] = map_data.get("geoPoints", {}).get(point_ref["id"])
                    meta["map_note"] = {
                        "status": old_point.get("mapStatus"),
                        "description": old_point.get("mapDescription"),
                        "source": old_point.get("mapSource"),
                    }

                    photo = None
                    for extension in (".jpg", ".jpeg", ".png", ".webp"):
                        candidate = ROOT / "photos" / "real" / f"{point_ref['id']}{extension}"
                        if candidate.is_file():
                            destination = point_dir / f"photo{extension.lower()}"
                            move_file(candidate, destination)
                            photo = destination
                            moved_photos += 1
                            break
                    meta["media"] = {
                        "photo": {
                            "path": str((photo or point_dir / "photo.jpg").relative_to(ROOT)).replace("\\", "/"),
                            "download_url": old_point.get("photo"),
                            "source_url": old_point.get("photoSource"),
                            "source_filename": old_point.get("photoFilename"),
                            "review_status": old_point.get("photoReview"),
                            "accuracy_note": old_point.get("photoAccuracy"),
                        }
                    }
                    for narration_id, filename in (("main", "main.mp3"), ("learn_more", "learn_more.mp3")):
                        narration = meta["narrations"][narration_id]
                        narration["audio"] = f"audio/{filename}"
                        text_value = (point_dir / narration["text"]).read_text(encoding="utf-8").strip()
                        narration["text_sha256"] = sha256_text(text_value)

                    legacy_audio = ROOT / "audio" / f"{point_ref['id']}.mp3"
                    if legacy_audio.is_file():
                        legacy_text = (ROOT / "texts" / f"{point_ref['id']}.txt").read_text(encoding="utf-8").strip()
                        current_text = (point_dir / "main.txt").read_text(encoding="utf-8").strip()
                        if legacy_text == current_text:
                            destination = point_dir / "audio" / "main.mp3"
                            move_file(legacy_audio, destination)
                            (destination.parent / "main.sha256").write_text(
                                sha256_text(current_text) + "\n", encoding="ascii"
                            )
                            reused_audio += 1
                        else:
                            move_file(legacy_audio, archive_audio / f"{point_ref['id']}.mp3")
                            stale_audio += 1
                    write_json(meta_path, meta)
    return reused_audio, stale_audio, moved_photos, moved_maps


def relocate_editorial_files() -> None:
    docs_target = ROOT / "docs" / "content"
    review_target = ROOT / "docs" / "content-review"
    archive_target = ROOT / "content-archive" / "retired-stories-2026-11-09"
    docs_target.mkdir(parents=True, exist_ok=True)
    review_target.mkdir(parents=True, exist_ok=True)

    move_file(SOURCE / "README.md", docs_target / "CONTENT_PACK_V2_SOURCE.md")
    move_file(SOURCE / "PROGRAMS_OVERVIEW.md", docs_target / "PROGRAMS_OVERVIEW.md")
    move_file(SOURCE / "RADIO_INDEX.md", docs_target / "STORIES_INDEX.md")
    move_file(SOURCE / "ALL_CONTENT.md", review_target / "ALL_CONTENT.md")
    for path in sorted((SOURCE / "docs").glob("*")):
        move_file(path, docs_target / path.name)
    retired = SOURCE / "review" / "retired_radio_2026-11-09"
    if retired.exists():
        archive_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(retired), str(archive_target))
    for path in sorted((SOURCE / "review").glob("*")):
        move_file(path, review_target / path.name)


def main() -> int:
    safe_root(SOURCE)
    safe_root(CONTENT)
    if not SOURCE.is_dir():
        raise SystemExit("Atlas_Content_Pack_v2 is missing or was already migrated")
    if CONTENT.exists():
        raise SystemExit("Target content/ already exists; refusing to merge implicitly")

    expected = {"ALL_CONTENT.md", "PROGRAMS_OVERVIEW.md", "RADIO_INDEX.md", "README.md", "catalog.json", "content", "dist", "docs", "review"}
    actual = {path.name for path in SOURCE.iterdir()}
    if actual != expected:
        raise RuntimeError(f"Unexpected pack entries: {sorted(actual ^ expected)}")

    shutil.move(str(SOURCE / "content"), str(CONTENT))
    move_file(SOURCE / "catalog.json", CONTENT / "catalog.json")
    transform_content_tree()
    stats = merge_legacy_metadata_and_media()
    relocate_editorial_files()

    dist = safe_root(SOURCE / "dist")
    if dist.exists():
        shutil.rmtree(dist)
    docs = SOURCE / "docs"
    review = SOURCE / "review"
    if docs.exists():
        docs.rmdir()
    if review.exists():
        review.rmdir()
    remaining = list(SOURCE.iterdir())
    if remaining:
        raise RuntimeError(f"Pack migration left unexpected files: {remaining}")
    SOURCE.rmdir()

    print("Content pack migrated successfully")
    print(f"Reused main MP3: {stats[0]}; stale MP3 archived: {stats[1]}")
    print(f"Moved point photos: {stats[2]}; moved PMTiles maps: {stats[3]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
