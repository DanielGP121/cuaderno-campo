"""Serve the production build exactly as GitHub Pages will: docs/ under /cuaderno-campo/.

    python scripts/serve_docs.py            # http://127.0.0.1:4173/cuaderno-campo/

Only for checking the built app (base path, manifest, service worker) before pushing.
"""
from __future__ import annotations

import http.server
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "docs"
PREFIX = "/cuaderno-campo"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        if path == PREFIX or path == PREFIX + "/":
            path = "/index.html"
        elif path.startswith(PREFIX + "/"):
            path = path[len(PREFIX):]
        return super().translate_path(path)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving {ROOT} at http://127.0.0.1:{PORT}{PREFIX}/", flush=True)
        httpd.serve_forever()
