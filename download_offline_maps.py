#!/usr/bin/env python3
"""Prepare small Protomaps PMTiles extracts for Egypt Atlas v0.23+.

The generated .pmtiles files are DATA ONLY: the PWA still needs a local
PMTiles renderer/style/font assets and an explicit offline-download flow.

No tile.openstreetmap.org bulk downloads are used. See
https://docs.protomaps.com/guide/getting-started
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

from tools.content_model import ContentTree

ROOT = Path(__file__).resolve().parent
CLI = ROOT / "tools" / ("pmtiles.exe" if os.name == "nt" else "pmtiles")
USER_AGENT = "Atlas-map-prep/2.0 (+https://docs.protomaps.com/)"


def load_attractions() -> list[dict]:
    attractions = []
    for asset in ContentTree().maps():
        attraction = {
            "id": asset.attraction.manifest["id"],
            "title": asset.attraction.manifest["title"],
            "map": {"navBounds": asset.bounds},
            "output": asset.output,
        }
        bounds = asset.bounds
        if not bounds or len(bounds) != 2:
            raise ValueError(f"Attraction {attraction.get('id')} lacks map.navBounds")
        w, s = bounds[0]
        e, n = bounds[1]
        if not (-180 < w < e < 180 and -90 < s < n < 90):
            raise ValueError(f"Attraction {attraction.get('id')} has invalid bounds: {bounds}")
        attractions.append(attraction)
    return attractions


def http_request(url: str, *, range_first=False, timeout=15):
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json,application/octet-stream,*/*"}
    if range_first:
        headers["Range"] = "bytes=0-31"
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def discover_recent_source(days=9) -> str:
    """Probe small HTTP ranges, never download full ~120 GB basemap."""
    today = dt.datetime.now(dt.timezone.utc).date()
    print("Looking for a recent daily Protomaps basemap (tiny range requests)...", flush=True)
    for age in range(days):
        date = today - dt.timedelta(days=age)
        url = f"https://build.protomaps.com/{date:%Y%m%d}.pmtiles"
        try:
            with http_request(url, range_first=True, timeout=9) as resp:
                magic = resp.read(7)
                if magic == b"PMTiles":
                    print(f"Found: {url}", flush=True)
                    return url
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    raise RuntimeError(
        "Could not find an accessible recent daily Protomaps build. "
        "Open https://maps.protomaps.com/builds/ and copy a current .pmtiles "
        "link; rerun with --source URL. If a VPN/proxy is in use, also test it."
    )


def download_asset(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + ".partial")
    try:
        with http_request(url, timeout=70) as response, temp.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        temp.replace(dest)
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def select_windows_cli_asset(assets: list[dict], arch_keywords: tuple[str, ...]) -> dict:
    """Select Windows without confusing the `win_` suffix in `Darwin_`."""
    matches=[]
    for asset in assets:
        name=asset.get("name","").lower()
        is_windows=bool(re.search(r"(?:^|[-_.])windows(?:[-_.]|$)",name))
        has_arch=any(keyword in name for keyword in arch_keywords)
        is_archive=name.endswith((".zip", ".tar.gz", ".tgz", ".exe"))
        if is_windows and has_arch and is_archive:
            matches.append(asset)
    if not matches:
        raise RuntimeError(
            "No Windows CLI asset found in official latest GitHub release. "
            "Install manually from https://github.com/protomaps/go-pmtiles/releases"
        )
    matches.sort(key=lambda asset:(not asset.get("name","").lower().endswith(".zip"),asset.get("name","")))
    return matches[0]


def auto_install_cli() -> Path:
    if CLI.is_file():
        return CLI
    from_path = shutil.which("pmtiles")
    if from_path:
        return Path(from_path)
    system = platform.system().lower()
    arch = platform.machine().lower()
    if system != "windows" or arch not in ("amd64", "x86_64", "arm64", "aarch64"):
        raise RuntimeError(
            "The bundled auto-installer currently targets Windows only. "
            "Download your pmtiles binary from "
            "https://github.com/protomaps/go-pmtiles/releases and pass --pmtiles /path/to/pmtiles"
        )
    if arch in ("aarch64", "arm64"):
        arch_keywords=("arm64", "aarch64")
    else:
        arch_keywords=("amd64", "x86_64", "x64", "64bit")
    url="https://api.github.com/repos/protomaps/go-pmtiles/releases/latest"
    print("Downloading official pmtiles CLI from GitHub Releases...",flush=True)
    with http_request(url,timeout=30) as resp:
        release=json.load(resp)
    assets=release.get("assets",[])
    asset=select_windows_cli_asset(assets,arch_keywords)
    with tempfile.TemporaryDirectory() as temp_dir:
        downloaded=Path(temp_dir)/asset["name"]
        print(f"CLI release: {asset['name']}",flush=True)
        download_asset(asset["browser_download_url"],downloaded)
        digest=asset.get("digest")
        if digest and digest.startswith("sha256:"):
            h=hashlib.file_digest(downloaded.open("rb"),"sha256").hexdigest()
            if h.lower()!=digest.split(":",1)[1].lower():
                raise RuntimeError("CLI SHA-256 does not match GitHub release digest")
        data=None
        low=downloaded.name.lower()
        if low.endswith(".zip"):
            with zipfile.ZipFile(downloaded) as z:
                entries=[name for name in z.namelist() if Path(name).name.lower()=="pmtiles.exe"]
                if not entries:
                    raise RuntimeError("Downloaded release archive lacks pmtiles.exe")
                data=z.read(entries[0])
        elif low.endswith((".tar.gz", ".tgz")):
            with tarfile.open(downloaded, "r:gz") as t:
                matches=[m for m in t.getmembers() if Path(m.name).name.lower()=="pmtiles.exe" and m.isfile()]
                if not matches:
                    raise RuntimeError("Downloaded release archive lacks pmtiles.exe")
                f=t.extractfile(matches[0]); assert f is not None
                data=f.read()
        elif low.endswith(".exe"):
            data=downloaded.read_bytes()
        if not data or not data.startswith(b"MZ"):
            raise RuntimeError("Downloaded executable does not have a Windows PE header")
        CLI.parent.mkdir(parents=True,exist_ok=True)
        CLI.write_bytes(data)
        print(f"CLI installed at {CLI}",flush=True)
    return CLI


def sha256_of_file(file:Path)->str:
    h=hashlib.sha256()
    with file.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()


def bbox(tour:dict) -> str:
    a,b=tour["map"]["navBounds"]
    return ",".join(f"{coord:.6f}" for coord in (a[0],a[1],b[0],b[1]))


def main(argv:list[str]|None=None)->int:
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    targets=ap.add_mutually_exclusive_group(required=True)
    targets.add_argument("--all",action="store_true",help="all attraction areas discovered in content/")
    targets.add_argument("--attraction",action="append",metavar="ID",help="a single attraction ID (can repeat)")
    targets.add_argument("--list",action="store_true",help="show attraction IDs and bounding boxes")
    ap.add_argument("--source",help="Source Protomaps daily .pmtiles URL (auto-discovery if missing)")
    ap.add_argument("--pmtiles",help="Path to installed pmtiles CLI (Windows CLI auto-installer if missing)")
    ap.add_argument("--maxzoom",type=int,default=15,choices=range(8,16),metavar="8..15",help="maximum basemap zoom; default 15, zoom 16-18 can overscale")
    ap.add_argument("--force",action="store_true",help="replace existing local archives")
    ap.add_argument("--dry-run",action="store_true",help="print planned extraction commands; no downloads")
    args=ap.parse_args(argv)
    attractions=load_attractions()
    by_id={item["id"]:item for item in attractions}
    if args.list:
        for item in attractions:
            print(f"{item['id']:18s} {bbox(item)}  {item['title']}")
        return 0
    if args.all: selected=attractions
    else:
        unknown=sorted(set(args.attraction)-set(by_id))
        if unknown:
            ap.error(f"Unknown attraction IDs: {', '.join(unknown)}; see --list")
        selected=[item for item in attractions if item["id"] in set(args.attraction)]
    jobs=[(item,item["output"]) for item in selected]
    for item,dest in jobs:
        print(f"{item['id']:18s} bbox={bbox(item)} maxzoom={args.maxzoom} => {dest.relative_to(ROOT)}")
    if args.dry_run:
        print("Dry-run only. Real downloads use a recent daily source or --source URL.")
        return 0
    need=[(t,out) for t,out in jobs if args.force or not out.exists()]
    if not need:
        print("All requested .pmtiles archives already exist. Use --force to refresh.")
        return 0
    cli=Path(args.pmtiles).expanduser().resolve() if args.pmtiles else auto_install_cli()
    if not cli.is_file():
        raise RuntimeError(f"pmtiles binary not found: {cli}")
    source=args.source or discover_recent_source()
    if not (source.startswith(("https://","http://")) or Path(source).is_file()):
        raise ValueError("--source must be an HTTP(S) URL or an existing local .pmtiles path")
    for idx,(attraction,dest) in enumerate(jobs,1):
        print(f"\n[{idx}/{len(jobs)}] {attraction['title']}",flush=True)
        if not args.force and dest.is_file():
            print(f"  Already present: {dest.name}; skipping",flush=True)
            continue
        dest.parent.mkdir(parents=True,exist_ok=True)
        temp=dest.with_suffix(".pmtiles.partial")
        temp.unlink(missing_ok=True)
        cmd=[str(cli),"extract",source,str(temp),"--bbox="+bbox(attraction),"--maxzoom="+str(args.maxzoom)]
        print("  Running:"," ".join(cmd),flush=True)
        try:
            subprocess.run(cmd,check=True)
            if not temp.is_file() or temp.stat().st_size<130:
                raise RuntimeError(f"Extract output is missing or too small: {temp}")
            with temp.open("rb") as f:
                if f.read(7)!=b"PMTiles":
                    raise RuntimeError(f"Downloaded file does not have a valid PMTiles magic header: {temp}")
            subprocess.run([str(cli),"verify",str(temp)],check=True)
            temp.replace(dest)
            print(f"  OK: {dest.stat().st_size/1024/1024:.2f} MiB",flush=True)
        except Exception:
            temp.unlink(missing_ok=True)
            raise
    print("\nMap preparation complete. Each PMTiles archive is stored beside its attraction manifest.")
    return 0


if __name__=="__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled. Existing complete files remain unchanged.",file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"\nERROR: {e}",file=sys.stderr)
        sys.exit(1)
