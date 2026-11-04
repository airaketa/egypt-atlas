"""Download credited Commons cartouche photographs for offline use."""

import email.utils
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "cartouches"
MIN_BYTES = 10_000
MAX_BYTES = 8 * 1024 * 1024
RETRIES = 8
USER_AGENT = "EgyptAtlas/0.26 (https://github.com/airaketa/egypt-atlas; offline media preparation)"
RETRYABLE_CODES = {429, 500, 502, 503, 504}


def retry_delay(error, attempt):
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


def open_with_retries(request, label):
    for attempt in range(1, RETRIES + 1):
        try:
            return urllib.request.urlopen(request, timeout=60)
        except urllib.error.HTTPError as error:
            if error.code not in RETRYABLE_CODES or attempt == RETRIES:
                raise
            delay = retry_delay(error, attempt)
            print(f"  {label}: HTTP {error.code}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == RETRIES:
                raise
            delay = min(3.0 * (2 ** (attempt - 1)), 60.0)
            print(f"  {label}: temporary error: {error}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"{label}: attempts exhausted")


def commons_thumbnail_url(photo):
    marker = "/wiki/File:"
    filename = urllib.parse.unquote(photo["source"].split(marker, 1)[1])
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
    with open_with_retries(request, "Commons API") as response:
        payload = json.load(response)
    pages = payload.get("query", {}).get("pages", [])
    imageinfo = pages[0].get("imageinfo", []) if pages else []
    if not imageinfo:
        raise ValueError("Commons API did not return imageinfo for " + filename)
    return imageinfo[0].get("thumburl") or imageinfo[0].get("url")


def download(photo, destination):
    url = commons_thumbnail_url(photo)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/jpeg,image/*"},
    )
    with open_with_retries(request, "Image") as response:
        mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        body = response.read(MAX_BYTES + 1)
    if mime != "image/jpeg" or not body.startswith(b"\xff\xd8"):
        raise ValueError(f"not a JPEG: {mime or 'missing Content-Type'}")
    if not MIN_BYTES < len(body) <= MAX_BYTES:
        raise ValueError(f"image size unexpected: {len(body)} bytes")
    partial = destination.with_suffix(".jpg.part")
    partial.write_bytes(body)
    partial.replace(destination)
    return len(body)


def main():
    photos = json.loads((ROOT / "data" / "cartouche_photo_sources.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    completed = 0
    attempted = False
    for key, photo in photos.items():
        destination = OUT / f"{key}.jpg"
        if destination.is_file() and destination.stat().st_size > MIN_BYTES:
            print("CACHED", key, flush=True)
            completed += 1
            continue
        if attempted:
            time.sleep(15)
        attempted = True
        try:
            size = download(photo, destination)
            print("OK", key, size, "bytes", flush=True)
            completed += 1
        except Exception as error:
            print("ERROR", key, type(error).__name__, str(error)[:200], flush=True)
            print("Source:", photo["source"], flush=True)
    print(f"Completed: {completed}/{len(photos)}", flush=True)
    print("Attribution and licenses are recorded inside the app.")
    return 0 if completed == len(photos) else 1


if __name__ == "__main__":
    raise SystemExit(main())
