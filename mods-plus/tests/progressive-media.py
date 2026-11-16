"""Real curl + one batch job: cold/warm and one slow visible preview. No clipboard/UI."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import threading
import time
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1] / "mods/mods-plus")
parser.add_argument("--expect-progress", action="store_true")
args = parser.parse_args()
runtime = args.runtime.resolve()
requests = []
active = peak = 0
lock = threading.Lock()
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0\0\x80\xff")) + chunk(b"IEND", b"")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        global active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(1 if self.path == "/0.png" else .02)
        body = png
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        with lock:
            requests.append(self.path)
            active -= 1


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
reports = []
try:
    with tempfile.TemporaryDirectory(prefix="mods-progress-", dir="/tmp") as folder:
        root = Path(folder)
        packages = [{"id": str(i), "preview_url": f"http://127.0.0.1:{server.server_port}/{i}.png", "avatar_url": ""} for i in range(4)]
        (root / "packages.json").write_text(json.dumps(packages))
        fixture = root / "fixture.py"
        fixture.write_text("import sys,json\nfrom pathlib import Path\n"
                           f"sys.path.insert(0,{str(runtime)!r})\nimport helper\n"
                           f"helper.gallery.available_packages=lambda manager: json.loads(Path({str(root / 'packages.json')!r}).read_text())\n"
                           "helper.main()\n")
        launch = "import sys,json;sys.path.insert(0,sys.argv[1]);import jobs;print(json.dumps(jobs.start(sys.argv[2],['media','[\"0\",\"1\",\"2\",\"3\"]'],sys.argv[3])))"
        for phase in ("cold", "warm"):
            requests.clear()
            started = time.monotonic()
            state = json.loads(subprocess.check_output([sys.executable, "-B", "-c", launch, str(runtime), folder, str(fixture)], text=True, timeout=5))
            polls = 0
            first = None
            first_while_running = False
            while True:
                result = state.get("progress", {}) if state["state"] == "running" else state.get("result", {})
                if first is None and any(item.get("preview_path") for item in result.get("media", [])):
                    first = (time.monotonic() - started) * 1000
                    first_while_running = state["state"] == "running"
                if state["state"] != "running":
                    break
                if time.monotonic() - started > 10:
                    raise TimeoutError("Media batch exceeded measurement deadline")
                time.sleep(.5)
                state = json.loads(subprocess.check_output([sys.executable, "-B", str(runtime / "jobs.py"), "--app-home", folder, "status", state["id"]], text=True, timeout=5))
                polls += 1
            assert state["state"] == "done", state
            assets = state["result"]["media"]
            assert len(assets) == 4 and all((root / item["preview_path"]).read_bytes() == png and item["preview_width"] == item["preview_height"] == 1 for item in assets)
            reports.append(dict(phase=phase, starts=1, status_polls=polls, first_usable_ms=round(first, 3),
                                complete_ms=round((time.monotonic() - started) * 1000, 3),
                                first_while_running=first_while_running, requests=len(requests), peak_downloads=peak, errors=0))
finally:
    server.shutdown()
if args.expect_progress:
    assert reports[0]["first_while_running"] and reports[0]["first_usable_ms"] < reports[0]["complete_ms"]
    assert reports[0]["requests"] == 4 and reports[1]["requests"] == 0
    assert all(row["starts"] == 1 and row["peak_downloads"] <= 4 for row in reports)
print(json.dumps(dict(runtime=str(runtime),condition="four previews; one 1000ms response, three 20ms; real curl and jobs; 500ms UI polling", phases=reports), indent=2))
