"""Transport/helper measurements, using real curl against a controlled loopback server.

No package is installed. --live records the four official feeds once, then replays
their metadata with 32 KiB media and a 20 ms server delay. Results are body bytes,
not TLS/header bytes, and exclude the native bridge and GPU. All data stays in /tmp.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import statistics
import struct
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1] / "mods/mods-plus")
parser.add_argument("--live", action="store_true")
parser.add_argument("--feeds", type=Path, help="Record/replay the exact official feed snapshot outside the repository")
parser.add_argument("--samples", type=int, default=5)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("helper", args.runtime / "helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
gallery = helper.gallery
download = gallery.download
feeds = {}
live = []
for plural in ("mods", "layouts"):
    for url in (f"https://assets.herdr.dev/{plural}/index.json", f"https://herdr.dev/{plural}/"):
        snapshot = args.feeds / (plural + (".json" if url.endswith("index.json") else ".html")) if args.feeds else None
        if snapshot and snapshot.exists() and not args.live:
            feeds[url] = snapshot.read_bytes()
            continue
        if args.live:
            started = time.perf_counter()
            feeds[url] = download(url)
            live.append({"url": url, "bytes": len(feeds[url]), "ms": (time.perf_counter() - started) * 1000})
            if snapshot:
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                snapshot.write_bytes(feeds[url])
        elif url.endswith("index.json"):
            feeds[url] = json.dumps({plural: [dict(fullName=f"fixture/catalog-{n}", owner=f"author-{n // 4}",
                path="panel", name=f"Panel {n:04}", stars=1000-n, modNames=[f"fixture-{n}"],
                previewUrl=f"https://assets.herdr.dev/previews/{plural}-{n}.png") for n in range(96 if plural == "mods" else 24)]}).encode()
        else:
            feeds[url] = b"<html></html>"

requests = []
media = b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + struct.pack(">II", 640, 400) + b"\0" * (32768 - 24)
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        url = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["url"][0]
        body = feeds.get(url, media)
        time.sleep(0.020)
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        requests.append({"url": url, "bytes": len(body)})
server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
gallery.download = lambda url, timeout=20: download(f"http://127.0.0.1:{server.server_port}/?url={urllib.parse.quote(url, safe='')}", timeout)

results = []
try:
    for sample in range(args.samples):
        with tempfile.TemporaryDirectory(prefix="mods-measure-", dir="/tmp") as root:
            for phase in ("cold", "warm"):
                manager = helper.PackageManager(root)
                requests.clear()
                started = time.perf_counter()
                manager.cache_only = True
                cached = manager.build_catalog()
                stale = manager.stale
                if stale:
                    manager.cache_only = False
                    packages = manager.build_catalog()
                else:
                    packages = cached
                catalog_ms = (time.perf_counter() - started) * 1000
                visible = sorted([p for p in packages if p["kind"] == "mod" and p["collection"] == "community"],
                                 key=lambda p: (not p["installed"], not bool(p["preview_url"]), -p["stars"], p["name"]))[:24]
                before_media = len(requests)
                errors = list(manager.catalog_errors)
                images = 0
                started = time.perf_counter()
                for index in range(0, len(visible), 4):
                    batch = visible[index:index+4]
                    assets = {item["id"]: item for item in gallery.media(manager, [p["id"] for p in batch])}
                    for pkg in batch:
                        for field in ("preview", "avatar"):
                            if not pkg[field + "_url"]:
                                continue
                            relative = assets.get(pkg["id"], {}).get(field + "_path")
                            if not relative or Path(root, relative).stat().st_size != len(media):
                                errors.append(f"Missing or incorrect {field}: {pkg['id']}")
                            else:
                                images += 1
                results.append(dict(sample=sample, phase=phase, packages=len(packages), shown=len(visible),
                    cached_packages=len(cached), stale=stale, catalog_ms=round(catalog_ms, 3),
                    media_ms=round((time.perf_counter()-started)*1000, 3), requests=len(requests),
                    media_requests=len(requests)-before_media, unique_urls=len({r["url"] for r in requests}),
                    bytes=sum(r["bytes"] for r in requests), images=images, errors=errors))
finally:
    server.shutdown()
summary = {}
for phase in ("cold", "warm"):
    rows = [r for r in results if r["phase"] == phase]
    summary[phase] = {key: {"median": statistics.median(r[key] for r in rows),
        "p95": sorted(r[key] for r in rows)[int((len(rows)-1)*.95+.5)]} for key in ("catalog_ms", "media_ms", "requests", "bytes")}
print(json.dumps({"runtime": str(args.runtime), "live_feeds": live, "condition": "loopback, 20ms per response, 32KiB media, four workers, 24 cards in batches of four", "samples": results, "summary": summary}, indent=2))
raise SystemExit(any(row["errors"] for row in results))
