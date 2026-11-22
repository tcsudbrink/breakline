"""Breakline local server.

Serves the app and proxies NOAA ERDDAP requests through /erddap/<host>/<path>,
caching each response on disk so repeat views are instant and work offline.

    python server.py            -> http://localhost:8790
"""
import hashlib
import http.server
import os
import socketserver
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
# Keep the cache out of OneDrive so it doesn't sync megabytes of grids.
CACHE = os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "breakline-cache")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790

# Only these upstream hosts may be proxied.
HOSTS = {
    "pfeg": "https://coastwatch.pfeg.noaa.gov/erddap/",
    "cw": "https://coastwatch.noaa.gov/erddap/",
    "upwell": "https://upwell.pfeg.noaa.gov/erddap/",
    "aoml": "https://cwcgom.aoml.noaa.gov/erddap/",
    "ndbc": "https://www.ndbc.noaa.gov/",
}
# Requests containing "(last)" change daily; everything else is pinned to a date.
TTL_LATEST = 3 * 3600
TTL_FIXED = 30 * 86400

os.makedirs(CACHE, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/erddap/"):
            return self.proxy()
        return super().do_GET()

    def proxy(self):
        rest = self.path[len("/erddap/"):]
        host, _, path = rest.partition("/")
        if host not in HOSTS:
            self.send_error(400, "unknown host")
            return
        url = HOSTS[host] + path
        key = hashlib.sha1(url.encode()).hexdigest()
        fn = os.path.join(CACHE, key)
        p = urllib.parse.unquote(path)
        ttl = (600 if host == "ndbc" else 1800 if host == "aoml" and "last" in p
               else TTL_LATEST if "last" in p else TTL_FIXED)
        body, status = None, 200
        if os.path.exists(fn) and time.time() - os.path.getmtime(fn) < ttl:
            with open(fn, "rb") as f:
                body = f.read()
        else:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Breakline/0.2"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                with open(fn, "wb") as f:
                    f.write(body)
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read() or str(e).encode()
            except Exception as e:  # network down: fall back to stale cache
                if os.path.exists(fn):
                    with open(fn, "rb") as f:
                        body = f.read()
                else:
                    status, body = 502, str(e).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Breakline on http://localhost:{PORT}")
    Server(("", PORT), Handler).serve_forever()
