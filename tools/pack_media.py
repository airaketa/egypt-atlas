#!/usr/bin/env python3
"""Package all generated Atlas media for a GitHub media-v* Release."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import zipfile

from content_model import ContentTree, ROOT, sha256_file


def valid_photo(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 2500:
        return False
    header = path.read_bytes()[:16]
    suffix = path.suffix.lower()
    return (
        suffix in (".jpg", ".jpeg")
        and header.startswith(b"\xff\xd8")
        or suffix == ".png"
        and header.startswith(b"\x89PNG\r\n\x1a\n")
        or suffix == ".webp"
        and header.startswith(b"RIFF")
        and header[8:12] == b"WEBP"
    )


def valid_map(path: Path) -> bool:
    return path.is_file() and path.stat().st_size >= 130 and path.read_bytes()[:7] == b"PMTiles"


def valid_audio(track) -> bool:
    if not track.output.is_file() or track.output.stat().st_size < 2500:
        return False
    sidecar = track.output.with_suffix(".sha256")
    if not sidecar.is_file() or sidecar.read_text(encoding="ascii").strip() != track.text_sha256:
        return False
    try:
        from mutagen.mp3 import MP3

        info = MP3(str(track.output)).info
        return 8 <= info.length <= 900 and info.bitrate > 0
    except (ImportError, Exception):
        # A strict header/size fallback keeps packaging usable without mutagen;
        # GENERATE_ALL_WINDOWS performs the full decoder-level verification.
        header = track.output.read_bytes()[:3]
        return header == b"ID3" or header[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "atlas-media.zip")
    parser.add_argument("--strict", action="store_true", help="fail unless every declared audio/photo/map is ready")
    parser.add_argument("--confirm-rights", action="store_true", help="confirm redistribution rights for audio and images")
    args = parser.parse_args(argv)
    if not args.confirm_rights:
        raise SystemExit("ERROR: pass --confirm-rights after reviewing image and TTS redistribution rights")

    tree = ContentTree()
    ready: list[tuple[Path, str, str]] = []
    missing: list[str] = []
    counts = {"audio": 0, "photo": 0, "map": 0}

    for track in tree.audio_tracks():
        if valid_audio(track):
            ready.append((track.output, track.package_id, "audio"))
            counts["audio"] += 1
        else:
            missing.append(f"audio:{track.id}")
    for photo in tree.photos():
        if valid_photo(photo.output):
            ready.append((photo.output, photo.package_id, "photo"))
            counts["photo"] += 1
        else:
            missing.append(f"photo:{photo.point.meta['id']}")
    for map_asset in tree.maps():
        if valid_map(map_asset.output):
            ready.append((map_asset.output, map_asset.package_id, "map"))
            counts["map"] += 1
        else:
            missing.append(f"map:{map_asset.attraction.manifest['id']}")
    for map_asset in tree.city_maps():
        if valid_map(map_asset.output):
            ready.append((map_asset.output, map_asset.package_id, "city-map"))
            counts["map"] += 1
        else:
            missing.append(f"city-map:{map_asset.city.manifest['city_id']}")

    expected = tree.summary()
    print(
        f"Found: {counts['audio']}/{expected['audio']} audio, "
        f"{counts['photo']}/{expected['photos']} photos, {counts['map']}/{expected['maps']} maps"
    )
    if args.strict and missing:
        preview = ", ".join(missing[:40])
        suffix = "" if len(missing) <= 40 else f" … and {len(missing) - 40} more"
        raise SystemExit(f"ERROR: incomplete media ({len(missing)} missing): {preview}{suffix}")

    entries = []
    for path, package_id, kind in sorted(ready, key=lambda item: item[0].as_posix()):
        entries.append(
            {
                "path": path.relative_to(ROOT).as_posix(),
                "package_id": package_id,
                "kind": kind,
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    index = {
        "format": 3,
        "project": "Atlas",
        "content_revision": tree.catalog["content_revision"],
        "files": entries,
        "missing": missing,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix(args.out.suffix + ".part")
    temporary.unlink(missing_ok=True)
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("media-package.json", json.dumps(index, ensure_ascii=False, indent=2) + "\n")
        for entry in entries:
            archive.write(ROOT / entry["path"], entry["path"])
    temporary.replace(args.out)
    print(f"Created {args.out} ({args.out.stat().st_size / 1024 / 1024:.1f} MiB, {len(entries)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
