"""Short RPCs for bounded, one-shot helper jobs (Herdr exec has a 30s limit)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from helper import file_lock

JOB_TIMEOUT = 300


def write_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
        json.dump(value, out)
    os.replace(out.name, path)


def job_path(root, job_id):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise ValueError("Invalid job ID")
    return Path(root) / "data/mods-plus/jobs" / job_id


def status(root, job_id):
    state = json.loads((job_path(root, job_id) / "status.json").read_text())
    if state["state"] == "running":
        try:
            os.kill(state["pid"], 0)
        except ProcessLookupError:
            return {"id": job_id, "state": "failed", "error": "Task stopped before completing. Retry the operation."}
    return state


def start(root, args, helper_path=None, timeout=JOB_TIMEOUT):
    base = Path(root) / "data/mods-plus/jobs"
    base.mkdir(parents=True, exist_ok=True)
    # Manual and scheduled checks share one in-flight operation across mod copies.
    identity = ["check-updates"] if args[0] == "check-updates" else args
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    pointer = base / (key + ".json")
    with file_lock(str(base / ".start.lock")):
        if pointer.exists():
            previous = json.loads(pointer.read_text())
            if job_path(root, previous).exists() and status(root, previous)["state"] == "running":
                return {"id": previous, "state": "running"}
        # Finished receipts are useful after a view closes, but not indefinitely.
        for old in base.iterdir():
            if old.is_dir() and time.time() - old.stat().st_mtime > 86400:
                if status(root, old.name)["state"] != "running":
                    shutil.rmtree(old)
        job_id = uuid.uuid4().hex
        folder = job_path(root, job_id)
        folder.mkdir()
        script = str(helper_path or Path(__file__).with_name("helper.py"))
        write_json(folder / "request.json", {
            "argv": [sys.executable, "-B", script, "--app-home", str(root), "--json", *args],
            "timeout": timeout,
        })
        worker = subprocess.Popen(
            [sys.executable, "-B", str(Path(__file__).resolve()), "--app-home", str(root), "run", job_id],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        threading.Thread(target=worker.wait, daemon=True).start()
        write_json(folder / "status.json", {"id": job_id, "state": "running", "pid": worker.pid})
        write_json(pointer, job_id)
        return {"id": job_id, "state": "running"}


def run(root, job_id):
    folder = job_path(root, job_id)
    # The launcher publishes the PID before this worker can publish completion.
    with file_lock(str(folder.parent / ".start.lock")):
        request = json.loads((folder / "request.json").read_text())
    try:
        child = subprocess.Popen(request["argv"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 start_new_session=True)
        try:
            stdout, stderr = child.communicate(timeout=request["timeout"])
        except subprocess.TimeoutExpired:
            # Terminate descendants too, including gh/curl and native checks.
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
            raise TimeoutError(f"Task exceeded {request['timeout']} seconds. Retry the operation.")
        if child.returncode:
            message = (stderr or stdout).decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError(message[-1] if message else "Helper operation failed")
        state = {"id": job_id, "state": "done", "result": json.loads(stdout)}
    except Exception as error:
        state = {"id": job_id, "state": "failed", "error": str(error)}
    write_json(folder / "status.json", state)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-home", required=True)
    parser.add_argument("command", choices=("start", "status", "run"))
    parser.add_argument("value")
    args = parser.parse_args()
    if args.command == "run":
        run(args.app_home, args.value)
    else:
        result = start(args.app_home, json.loads(args.value)) if args.command == "start" else status(args.app_home, args.value)
        print(json.dumps(result))
