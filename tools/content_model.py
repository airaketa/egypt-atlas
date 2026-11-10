"""Generic content-tree reader shared by Atlas build and media tools."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Iterator


ROOT = Path(__file__).resolve().parents[1]
CONTENT_ROOT = ROOT / "content"
DEFAULT_VOICE = "ru-RU-SvetlanaNeural"


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Missing content file: {path.relative_to(ROOT)}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path.relative_to(ROOT)}: {error}") from error


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class CountryNode:
    path: Path
    manifest: dict
    catalog: dict


@dataclass(frozen=True)
class CityNode:
    path: Path
    manifest: dict
    catalog: dict
    country: CountryNode


@dataclass(frozen=True)
class AttractionNode:
    path: Path
    manifest: dict
    reference: dict
    city: CityNode


@dataclass(frozen=True)
class PointNode:
    path: Path
    meta: dict
    reference: dict
    attraction: AttractionNode


@dataclass(frozen=True)
class AudioTrack:
    id: str
    source: Path
    output: Path
    title: str
    package_id: str
    pronunciation_id: str
    voice: str = DEFAULT_VOICE

    @property
    def text(self) -> str:
        return self.source.read_text(encoding="utf-8").strip()

    @property
    def text_sha256(self) -> str:
        return sha256_bytes(self.text.encode("utf-8"))


@dataclass(frozen=True)
class PhotoAsset:
    point: PointNode
    output: Path
    package_id: str
    download_url: str
    source_url: str


@dataclass(frozen=True)
class MapAsset:
    attraction: AttractionNode
    output: Path
    package_id: str
    bounds: list
    max_zoom: int


class ContentTree:
    def __init__(self, root: Path = CONTENT_ROOT):
        self.root = root.resolve()
        self.catalog_path = self.root / "catalog.json"
        self.catalog = read_json(self.catalog_path)
        if self.catalog.get("schema_version") != 2:
            raise ValueError("content/catalog.json must use schema_version 2")
        self._countries: list[CountryNode] = []
        self._cities: list[CityNode] = []
        self._attractions: list[AttractionNode] = []
        self._points: list[PointNode] = []
        self._load()

    def _load(self) -> None:
        seen_package_ids: set[str] = set()
        seen_point_ids: set[str] = set()
        seen_attraction_keys: set[tuple[str, str, str]] = set()
        for country_ref in self.catalog.get("countries", []):
            country_path = self.root / "countries" / country_ref["id"]
            country = CountryNode(country_path, read_json(country_path / "manifest.json"), country_ref)
            if country.manifest["country_id"] != country_ref["id"]:
                raise ValueError(f"Country ID mismatch: {country_path}")
            package_id = country.manifest["id"]
            if package_id in seen_package_ids:
                raise ValueError(f"Duplicate package ID: {package_id}")
            seen_package_ids.add(package_id)
            self._countries.append(country)

            catalog_cities = {item["id"]: item for item in country_ref.get("cities", [])}
            for city_ref in country.manifest.get("cities", []):
                city_id = city_ref["id"]
                if city_id not in catalog_cities:
                    raise ValueError(f"City {country_ref['id']}/{city_id} is missing from catalog.json")
                city_path = country_path / "cities" / city_id
                city = CityNode(city_path, read_json(city_path / "manifest.json"), catalog_cities[city_id], country)
                if city.manifest["city_id"] != city_id or city.manifest["country_id"] != country_ref["id"]:
                    raise ValueError(f"City scope mismatch: {city_path}")
                package_id = city.manifest["id"]
                if package_id in seen_package_ids:
                    raise ValueError(f"Duplicate package ID: {package_id}")
                seen_package_ids.add(package_id)
                self._cities.append(city)

                for attraction_ref in city.manifest.get("attractions", []):
                    manifest_path = city_path / attraction_ref["manifest"]
                    attraction = AttractionNode(manifest_path.parent, read_json(manifest_path), attraction_ref, city)
                    key = (country_ref["id"], city_id, attraction.manifest["id"])
                    if key in seen_attraction_keys:
                        raise ValueError(f"Duplicate attraction key: {'/'.join(key)}")
                    seen_attraction_keys.add(key)
                    self._attractions.append(attraction)
                    for point_ref in attraction.manifest.get("points", []):
                        meta_path = attraction.path / point_ref["meta"]
                        point = PointNode(meta_path.parent, read_json(meta_path), point_ref, attraction)
                        if point.meta["id"] != point_ref["id"]:
                            raise ValueError(f"Point ID mismatch: {meta_path}")
                        if point.meta["id"] in seen_point_ids:
                            raise ValueError(f"Duplicate point ID: {point.meta['id']}")
                        seen_point_ids.add(point.meta["id"])
                        self._points.append(point)
        if not self._countries:
            raise ValueError("Content catalog has no countries")

    @property
    def countries(self) -> tuple[CountryNode, ...]:
        return tuple(self._countries)

    @property
    def cities(self) -> tuple[CityNode, ...]:
        return tuple(self._cities)

    @property
    def attractions(self) -> tuple[AttractionNode, ...]:
        return tuple(self._attractions)

    @property
    def points(self) -> tuple[PointNode, ...]:
        return tuple(self._points)

    def country_stories(self, country: CountryNode) -> tuple[dict, Path]:
        path = country.path / country.manifest["stories"]
        return read_json(path), country.path

    def city_stories(self, city: CityNode) -> tuple[dict, Path]:
        path = city.path / city.manifest["stories"]
        return read_json(path), city.path

    @staticmethod
    def _story_tracks(manifest: dict, scope_root: Path, package_id: str) -> Iterator[AudioTrack]:
        for episode in manifest.get("episodes", []):
            source = scope_root / episode["audio_text_path"]
            output = scope_root / episode["audio_path"]
            yield AudioTrack(
                id=episode["id"],
                source=source,
                output=output,
                title=episode["title"],
                package_id=package_id,
                pronunciation_id=episode["id"],
                voice=episode.get("tts_profile", DEFAULT_VOICE),
            )

    def audio_tracks(self) -> tuple[AudioTrack, ...]:
        tracks: list[AudioTrack] = []
        for country in self.countries:
            manifest, scope_root = self.country_stories(country)
            tracks.extend(self._story_tracks(manifest, scope_root, country.manifest["id"]))
        for city in self.cities:
            manifest, scope_root = self.city_stories(city)
            tracks.extend(self._story_tracks(manifest, scope_root, city.manifest["id"]))
        for point in self.points:
            for narration_id, narration in point.meta.get("narrations", {}).items():
                slug = narration_id.replace("_", "-")
                tracks.append(
                    AudioTrack(
                        id=f"{point.meta['id']}--{slug}",
                        source=point.path / narration["text"],
                        output=point.path / narration["audio"],
                        title=f"{point.meta['title']} · {('Основной рассказ' if narration_id == 'main' else 'Хочу узнать больше')}",
                        package_id=point.attraction.city.manifest["id"],
                        pronunciation_id=point.meta["id"],
                    )
                )
        ids = [track.id for track in tracks]
        outputs = [track.output.resolve() for track in tracks]
        if len(ids) != len(set(ids)):
            raise ValueError("Audio track IDs are not unique")
        if len(outputs) != len(set(outputs)):
            raise ValueError("Audio output paths are not unique")
        return tuple(tracks)

    def photos(self) -> tuple[PhotoAsset, ...]:
        assets: list[PhotoAsset] = []
        for point in self.points:
            photo = point.meta.get("media", {}).get("photo", {})
            path_value = photo.get("path")
            if not path_value:
                raise ValueError(f"Point {point.meta['id']} lacks media.photo.path")
            assets.append(
                PhotoAsset(
                    point=point,
                    output=ROOT / path_value,
                    package_id=point.attraction.city.manifest["id"],
                    download_url=photo.get("download_url") or "",
                    source_url=photo.get("source_url") or "",
                )
            )
        return tuple(assets)

    def maps(self) -> tuple[MapAsset, ...]:
        assets: list[MapAsset] = []
        for attraction in self.attractions:
            map_data = attraction.manifest.get("map", {})
            bounds = map_data.get("navBounds")
            archive = map_data.get("archive")
            if not archive or not bounds:
                raise ValueError(f"Attraction {attraction.manifest['id']} lacks map archive/bounds")
            assets.append(
                MapAsset(
                    attraction=attraction,
                    output=ROOT / archive,
                    package_id=attraction.city.manifest["id"],
                    bounds=bounds,
                    max_zoom=int(map_data.get("maxZoom", 15)),
                )
            )
        return tuple(assets)

    def summary(self) -> dict[str, int]:
        return {
            "countries": len(self.countries),
            "cities": len(self.cities),
            "attractions": len(self.attractions),
            "points": len(self.points),
            "audio": len(self.audio_tracks()),
            "photos": len(self.photos()),
            "maps": len(self.maps()),
        }
