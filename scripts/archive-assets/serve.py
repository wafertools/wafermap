#!/usr/bin/env python3
"""Static file server for the wafermap examples package.

Why this exists instead of `python3 -m http.server`:

On Windows, Python's `mimetypes` module seeds itself from the registry. On
machines where another installed program has remapped the `.js` key — which is
common — the stdlib server hands JavaScript back as `text/plain`. Browsers
refuse to execute an ES module with a non-JavaScript MIME type, so EVERY page in
this package fails to load, with an error that looks nothing like the cause. The
same archive works perfectly on Linux and macOS, which makes it worse to
diagnose.

Pinning the map below removes that failure entirely, on every platform.

Usage:
    python3 serve.py [port]      # default 8080
"""

import functools
import http.server
import mimetypes
import os
import socketserver
import sys

# Explicit map — deliberately not trusting the platform's mimetypes database.
TYPES = {
    ".js":   "text/javascript",
    ".mjs":  "text/javascript",
    ".json": "application/json",
    ".css":  "text/css",
    ".html": "text/html",
    ".htm":  "text/html",
    ".svg":  "image/svg+xml",
    ".csv":  "text/csv",
    ".wasm": "application/wasm",
    ".map":  "application/json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in TYPES:
            return TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        # These pages are re-served constantly while editing; a cached module is
        # a confusing way to discover your change did not take.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter than the default: errors only.
        if not args or str(args[1]).startswith(("2", "3")):
            return
        super().log_message(fmt, *args)


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"not a port number: {sys.argv[1]}", file=sys.stderr)
            return 2

    # Serve from this script's directory, whatever the working directory is.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    for ext, mime in TYPES.items():
        mimetypes.add_type(mime, ext)

    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), functools.partial(Handler)) as httpd:
            print("wafermap examples — serving on http://localhost:%d/" % port)
            print("  examples:  http://localhost:%d/examples/index.html" % port)
            print("  starter:   http://localhost:%d/starter/" % port)
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except OSError as e:
        print(f"could not start on port {port}: {e}", file=sys.stderr)
        print(f"try another port:  python3 serve.py {port + 1}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nstopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
