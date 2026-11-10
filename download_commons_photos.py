#!/usr/bin/env python3
"""Download every missing point photo declared by the generic content tree."""

from __future__ import annotations

import argparse
import csv
import email.utils
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

from tools.content_model import ContentTree, ROOT


MIN_IMAGE_BYTES = 2500
MAX_IMAGE_BYTES = 12 * 1024 * 1024
RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}
USER_AGENT = "AtlasOfflineGuide/2.0 (https://github.com/airaketa/egypt-atlas; offline media preparation)"


def retry_after_seconds(error, attempt):
    value = error.headers.get("Retry-After") if error.headers else None
    if value:
        try:
            return max(1.0, min(float(value), 300.0))
        except ValueError:
            try:
                retry_at = email.utils.parsedate_to_datetime(value).timestamp()
                return max(1.0, min(retry_at - time.time(), 300.0))
            except (TypeError, ValueError, OverflowError):
                pass
    return min(5.0 * (2 ** (attempt - 1)), 120.0)


def open_with_retries(request, *, timeout, retries, label):
    for attempt in range(1, retries + 1):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code not in RETRYABLE_HTTP_CODES or attempt == retries:
                raise
            delay = retry_after_seconds(error, attempt)
            print(f"  {label}: HTTP {error.code}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == retries:
                raise
            delay = min(3.0 * (2 ** (attempt - 1)), 60.0)
            print(f"  {label}: temporary error: {error}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"{label}: attempts exhausted")


def commons_thumbnail_url(asset, *, timeout, retries):
    marker = "/wiki/File:"
    if "commons.wikimedia.org" not in asset.source_url or marker not in asset.source_url:
        return asset.download_url
    filename = urllib.parse.unquote(asset.source_url.split(marker, 1)[1])
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "prop": "imageinfo",
            "iiprop": "url|mime",
            "iiurlwidth": "960",
            "titles": "File:" + filename,
        }
    )
    request = urllib.request.Request(
        "https://commons.wikimedia.org/w/api.php?" + query,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with open_with_retries(request, timeout=timeout, retries=retries, label="Commons API") as response:
        payload = json.load(response)
    pages = payload.get("query", {}).get("pages", [])
    imageinfo = pages[0].get("imageinfo", []) if pages else []
    if not imageinfo:
        raise ValueError("Commons API did not return imageinfo for " + filename)
    return imageinfo[0].get("thumburl") or imageinfo[0].get("url") or asset.download_url


def valid_image(path: Path) -> bool:
    if not path.is_file() or not MIN_IMAGE_BYTES < path.stat().st_size <= MAX_IMAGE_BYTES:
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


def download_photo(asset, *, timeout, retries):
    download_url = commons_thumbnail_url(asset, timeout=timeout, retries=retries)
    if not download_url:
        raise ValueError("photo has no download URL")
    request = urllib.request.Request(
        download_url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/jpeg,image/png,image/webp,image/*"},
    )
    with open_with_retries(request, timeout=timeout, retries=retries, label="Image") as response:
        mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if not mime.startswith("image/"):
            raise ValueError(f"not an image: {mime or 'missing Content-Type'}")
        content = response.read(MAX_IMAGE_BYTES + 1)
    if not MIN_IMAGE_BYTES < len(content) <= MAX_IMAGE_BYTES:
        raise ValueError(f"image size unexpected: {len(content)} bytes")
    asset.output.parent.mkdir(parents=True, exist_ok=True)
    partial = asset.output.with_suffix(asset.output.suffix + ".part")
    partial.write_bytes(content)
    header = content[:16]
    expected = asset.output.suffix.lower()
    signatures_ok = (
        expected in (".jpg", ".jpeg") and header.startswith(b"\xff\xd8")
        or expected == ".png" and header.startswith(b"\x89PNG\r\n\x1a\n")
        or expected == ".webp" and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    )
    if not signatures_ok:
        partial.unlink(missing_ok=True)
        raise ValueError(f"downloaded image format does not match {expected}")
    partial.replace(asset.output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between new downloads")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-request timeout")
    parser.add_argument("--retries", type=int, default=5, help="maximum attempts per request")
    parser.add_argument("--force", action="store_true", help="replace valid existing photos")
    args = parser.parse_args(argv)
    if args.delay < 0 or args.timeout <= 0 or args.retries < 1:
        parser.error("delay must be >= 0, timeout > 0, and retries >= 1")

    assets = ContentTree().photos()
    rows = []
    attempted = False
    for index, asset in enumerate(assets, 1):
        point_id = asset.point.meta["id"]
        if valid_image(asset.output) and not args.force:
            status = "cached"
        else:
            if attempted and args.delay:
                time.sleep(args.delay)
            attempted = True
            try:
                download_photo(asset, timeout=args.timeout, retries=args.retries)
                status = "downloaded"
            except Exception as error:
                status = "FAILED " + str(error)[:240]
        print(f"[{index}/{len(assets)}] {point_id} {status}", flush=True)
        rows.append([point_id, asset.package_id, asset.source_url, asset.output.relative_to(ROOT), status])

    report = ROOT / "data" / "photo_download_results.csv"
    with report.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ID", "Package", "Source", "Local path", "Result"])
        writer.writerows(rows)
    completed = sum(row[-1] in ("downloaded", "cached") for row in rows)
    print(f"Completed: {completed}/{len(rows)}")
    print("IMPORTANT: verify image authorship and license before distribution.")
    return 0 if completed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
