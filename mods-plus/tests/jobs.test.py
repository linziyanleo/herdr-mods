"""Exercise real one-shot workers, including work longer than Herdr exec permits."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

RUNTIME = Path(__file__).parents[1] / "mods/mods-plus"
sys.path.insert(0, str(RUNTIME))
import jobs


class JobsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.helper = self.root / "fixture.py"

    def wait(self, job_id, limit=10):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            state = jobs.status(self.root, job_id)
            if state["state"] != "running":
                return state
            time.sleep(.05)
        self.fail("Worker did not reach a terminal state")

    def test_work_survives_launcher_exit_and_thirty_seconds(self):
        self.helper.write_text('import json,time\ntime.sleep(31)\nprint(json.dumps({"finished": True}))\n')
        code = ('import sys,json; sys.path.insert(0,sys.argv[1]); import jobs; '
                'print(json.dumps(jobs.start(sys.argv[2],["check-updates"],sys.argv[3])))')
        before = time.monotonic()
        launch = subprocess.run([sys.executable, "-B", "-c", code, str(RUNTIME), str(self.root), str(self.helper)],
                                capture_output=True, text=True, timeout=5, check=True)
        job_id = json.loads(launch.stdout)["id"]
        self.assertLess(time.monotonic() - before, 5)
        second = jobs.start(self.root, ["check-updates", "--if-overdue"], self.helper)
        self.assertEqual(second["id"], job_id)
        state = self.wait(job_id, 40)
        self.assertGreaterEqual(time.monotonic() - before, 31)
        self.assertEqual(state["state"], "done", state)
        self.assertEqual(state["result"], {"finished": True})

    def test_timeout_terminates_child_process_group(self):
        marker = self.root / "late-write"
        child_code = f'import time; from pathlib import Path; time.sleep(1); Path({str(marker)!r}).touch()'
        self.helper.write_text(f'import subprocess,sys,time\nsubprocess.Popen([sys.executable,"-c",{child_code!r}])\ntime.sleep(5)\n')
        task = jobs.start(self.root, ["install", "test/repo"], self.helper, timeout=.2)
        state = self.wait(task["id"])
        self.assertEqual(state["state"], "failed")
        self.assertIn("exceeded", state["error"])
        time.sleep(1.1)
        self.assertFalse(marker.exists(), "A descendant survived the operation deadline")

    def test_failure_can_be_retried_and_receipts_can_expire(self):
        self.helper.write_text('import sys\nsys.exit("fixture failed")\n')
        first = jobs.start(self.root, ["catalog"], self.helper)
        self.assertIn("fixture failed", self.wait(first["id"])["error"])
        path = jobs.job_path(self.root, first["id"])
        os.utime(path, (0, 0))
        self.helper.write_text('print("{}")\n')
        second = jobs.start(self.root, ["catalog"], self.helper)
        self.assertNotEqual(second["id"], first["id"])
        self.assertEqual(self.wait(second["id"])["state"], "done")
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
