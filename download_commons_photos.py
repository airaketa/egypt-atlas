#!/usr/bin/env python3
"""Download candidate tour photos, resuming safely after interruptions."""

import argparse
import csv
import email.utils
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "photos" / "real"
IMAGE_EXTENSIONS = (".jpg", ".png", ".webp")
MIN_IMAGE_BYTES = 2500
MAX_IMAGE_BYTES = 8 * 1024 * 1024
RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}
USER_AGENT = "EgyptAtlas/0.26 (https://github.com/airaketa/egypt-atlas; offline media preparation)"


def load_stops():
    source = (ROOT / "catalog.js").read_text(encoding="utf-8")
    tours = json.loads(source[source.index("[") : source.rfind("]") + 1])
    return [
        stop
        for tour in tours
        for stop in tour["stops"] + tour.get("extension", {}).get("stops", [])
        if stop.get("photo", "").startswith("https://")
    ]


def cached_photo(stop_id):
    for extension in IMAGE_EXTENSIONS:
        candidate = OUT / f"{stop_id}{extension}"
        if candidate.is_file() and candidate.stat().st_size > MIN_IMAGE_BYTES:
            return candidate
    return None


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
            print(f"  {label}: HTTP {error.code}; retry {attempt}/{retries - 1} in {delay:.0f}s", flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == retries:
                raise
            delay = min(3.0 * (2 ** (attempt - 1)), 60.0)
            print(f"  {label}: temporary error: {error}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"{label}: attempts exhausted")


def commons_thumbnail_url(stop, *, timeout, retries):
    source = stop.get("photoSource", "")
    marker = "/wiki/File:"
    if "commons.wikimedia.org" not in source or marker not in source:
        return stop["photo"]
    filename = urllib.parse.unquote(source.split(marker, 1)[1])
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
    return imageinfo[0].get("thumburl") or imageinfo[0].get("url") or stop["photo"]


def download_photo(stop, *, timeout, retries):
    download_url = commons_thumbnail_url(stop, timeout=timeout, retries=retries)
    request = urllib.request.Request(
        download_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/jpeg,image/png,image/webp,image/*",
        },
    )
    with open_with_retries(request, timeout=timeout, retries=retries, label="Image") as response:
        mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if not mime.startswith("image/"):
            raise ValueError(f"not an image: {mime or 'missing Content-Type'}")
        content = response.read(MAX_IMAGE_BYTES + 1)
    if not MIN_IMAGE_BYTES < len(content) <= MAX_IMAGE_BYTES:
        raise ValueError(f"image size unexpected: {len(content)} bytes")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(mime, ".jpg")
    destination = OUT / f"{stop['id']}{extension}"
    partial = destination.with_suffix(destination.suffix + ".part")
    partial.write_bytes(content)
    partial.replace(destination)
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between new downloads (default: 2)")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-request timeout in seconds (default: 30)")
    parser.add_argument("--retries", type=int, default=5, help="maximum attempts per photo (default: 5)")
    args = parser.parse_args(argv)
    if args.delay < 0 or args.timeout <= 0 or args.retries < 1:
        parser.error("delay must be >= 0, timeout > 0, and retries >= 1")

    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    attempted = False
    for stop in load_stops():
        destination = cached_photo(stop["id"])
        if destination:
            status = "cached"
        else:
            if attempted and args.delay:
                time.sleep(args.delay)
            attempted = True
            try:
                destination = download_photo(stop, timeout=args.timeout, retries=args.retries)
                status = "downloaded"
            except Exception as error:
                destination = OUT / f"{stop['id']}.jpg"
                status = "FAILED " + str(error)[:200]
        print(stop["id"], status, flush=True)
        rows.append([stop["id"], stop.get("photoSource", ""), str(destination.relative_to(ROOT)), status])

    with (ROOT / "data" / "photo_download_results.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["ID", "Commons", "Local path", "Result"])
        writer.writerows(rows)
    completed = sum(row[-1] in ("downloaded", "cached") for row in rows)
    print(f"Completed: {completed}/{len(rows)}", flush=True)
    print("IMPORTANT: verify each image author and license before distribution.")
    return 0 if completed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
