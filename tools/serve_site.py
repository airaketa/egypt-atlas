#!/usr/bin/env python3
"""Serve a built Atlas site with HTTP byte-range support for PMTiles/audio."""

from __future__ import annotations

import argparse
import os
import re
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


class RangeRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):  # noqa: D401 - signature inherited from stdlib
        range_header = self.headers.get("Range")
        if not range_header:
            response = super().send_head()
            if response is not None:
                self._range = None
            return response

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(source.fileno()).st_size
        match = RANGE_RE.fullmatch(range_header.strip())
        if not match:
            source.close()
            self.send_error(416, "Invalid byte range")
            return None

        start_raw, end_raw = match.groups()
        if start_raw:
            start = int(start_raw)
            end = min(int(end_raw), size - 1) if end_raw else size - 1
        elif end_raw:
            suffix = min(int(end_raw), size)
            start, end = size - suffix, size - 1
        else:
            source.close()
            self.send_error(416, "Invalid byte range")
            return None

        if start < 0 or start >= size or end < start:
            source.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        self.send_response(206)
        self.send_header("Content-type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.end_headers()
        self._range = (start, end)
        return source

    def copyfile(self, source, outputfile):
        byte_range = getattr(self, "_range", None)
        if byte_range is None:
            shutil.copyfileobj(source, outputfile)
            return

        start, end = byte_range
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="_site")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    handler = partial(RangeRequestHandler, directory=args.directory)
    server = ThreadingHTTPServer(("", args.port), handler)
    print(f"Serving {os.path.abspath(args.directory)} at http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
