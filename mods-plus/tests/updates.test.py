"""Update checks against disposable package stores and controlled upstream replies."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "mods/mods-plus/helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class UpdatesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mgr = helper.PackageManager(self.temp.name)
        self.v1 = b'import { View, div } from "gpui-kit"; export default class Mod extends View { render() { return div().child("v1"); } }'
        self.v2 = self.v1.replace(b'"v1"', b'"v2"')
        self.sha1, self.sha2 = map(helper.blob_sha, (self.v1, self.v2))

    def package(self, name, repo=None):
        repo = repo or "owner/" + name
        pkg_id = repo + "/" + name
        path = Path(self.temp.name) / "mods" / name / "main.js"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.v1)
        self.mgr.records[pkg_id] = {"repo": repo, "subdir": name, "ref": "HEAD",
            "installed": True, "enabled": True, "mods": [name], "layouts": [],
            "files": {f"mods/{name}/main.js": self.sha1}}
        return pkg_id

    def test_parallel_sources_and_candidates_with_partial_failure(self):
        ids = [self.package(name) for name in ("one", "two", "offline")]
        fetch_barrier = threading.Barrier(3, timeout=5)
        download_barrier = threading.Barrier(2, timeout=5)

        def tree(repo, branch, refresh=False):
            self.assertTrue(refresh)
            fetch_barrier.wait()
            name = repo.split("/")[-1]
            if name == "offline":
                raise OSError("network unavailable")
            return {"HEAD": "new-revision", f"{name}/mods/{name}/main.js": self.sha2}

        def blob(repo, sha):
            download_barrier.wait()
            return self.v2

        with patch.object(self.mgr, "branch_tree", side_effect=tree), patch.object(self.mgr, "blob_bytes", side_effect=blob):
            result = self.mgr.check_updates()
        self.assertFalse(result["ok"])
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["errors"], [{"id": ids[2], "error": "network unavailable"}])
        self.assertIsNone(self.mgr.get_settings()["last_check"])
        for name in ("one", "two", "offline"):
            self.assertEqual((Path(self.temp.name) / "mods" / name / "main.js").read_bytes(), self.v1)
        self.assertEqual(helper.PackageManager(self.temp.name).get_settings()["prepared_updates_count"], 2)

    def test_shared_repo_fetched_once_and_stale_candidates_cleared(self):
        ids = [self.package(name, "owner/suite") for name in ("one", "two")]
        upstream = {f"{name}/mods/{name}/main.js": self.sha2 for name in ("one", "two")}
        with patch.object(self.mgr, "branch_tree", return_value=upstream) as fetch, patch.object(self.mgr, "blob_bytes", return_value=self.v2):
            self.assertEqual(self.mgr.check_updates()["count"], 2)
            self.assertEqual(fetch.call_count, 1)
        upstream = {key: self.sha1 for key in upstream}
        with patch.object(self.mgr, "branch_tree", return_value=upstream):
            self.assertEqual(self.mgr.check_updates()["count"], 0)
        for pkg_id in ids:
            self.assertFalse((Path(self.mgr.updates_dir) / pkg_id.replace("/", "-")).exists())

    def test_failed_candidate_and_partial_directory_do_not_count(self):
        pkg_id = self.package("broken")
        incomplete = Path(self.mgr.updates_dir) / "partial" / "candidate"
        incomplete.mkdir(parents=True)
        with patch.object(self.mgr, "branch_tree", return_value={"broken/mods/broken/main.js": self.sha2}), patch.object(self.mgr, "blob_bytes", return_value=b"invalid JavaScript {{"):
            result = self.mgr.check_updates()
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["errors"][0]["id"], pkg_id)
        self.assertIn("herdr-app check", result["errors"][0]["error"])
        self.assertFalse(self.mgr.records[pkg_id]["has_update"])

    def test_refresh_bypasses_cached_tree_and_does_not_hide_network_failure(self):
        with patch.object(self.mgr, "_gh_api", return_value={"sha": "old", "tree": []}):
            self.mgr.branch_tree("owner/mod")
        with patch.object(self.mgr, "_gh_api", side_effect=OSError("offline")):
            self.assertEqual(self.mgr.branch_tree("owner/mod")["HEAD"], "old")
            with self.assertRaisesRegex(OSError, "offline"):
                self.mgr.branch_tree("owner/mod", refresh=True)

    def test_timed_out_validation_leaves_no_candidate_and_no_success_timestamp(self):
        pkg_id = self.package("slow")
        with patch.object(self.mgr, "branch_tree", return_value={"slow/mods/slow/main.js": self.sha2}), \
             patch.object(self.mgr, "blob_bytes", return_value=self.v2), \
             patch.object(helper.subprocess, "run", side_effect=helper.subprocess.TimeoutExpired("herdr-app check", 45)) as check:
            result = self.mgr.check_updates()
        self.assertFalse(result["ok"])
        self.assertEqual(result["count"], 0)
        self.assertIsNone(result["settings"]["last_check"])
        self.assertEqual(check.call_args.kwargs["timeout"], 45)
        self.assertFalse((Path(self.mgr.updates_dir) / pkg_id.replace("/", "-")).exists())
        self.assertEqual((Path(self.temp.name) / "mods/slow/main.js").read_bytes(), self.v1)

    def test_lock_timeout_never_enters_mutation(self):
        with helper.file_lock(self.mgr.lock_file):
            with self.assertRaises(TimeoutError):
                with helper.file_lock(self.mgr.lock_file, timeout=0.01):
                    self.fail("Mutation entered without lock")

    def test_files_within_one_package_download_concurrently(self):
        self.package("suite")
        barrier = threading.Barrier(4, timeout=5)
        files = {"suite/mods/suite/main.js": self.sha2,
                 **{f"suite/mods/suite/{n}.txt": str(n) for n in range(3)}}

        def blob(repo, sha):
            barrier.wait()
            return self.v2 if sha == self.sha2 else sha.encode()

        with patch.object(self.mgr, "branch_tree", return_value=files), patch.object(self.mgr, "blob_bytes", side_effect=blob):
            result = self.mgr.check_updates()
        self.assertTrue(result["ok"], result["errors"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["settings"]["prepared_update_ids"], ["owner/suite/suite"])

    def test_legacy_hours_and_custom_minutes_persist_and_schedule(self):
        Path(self.mgr.settings_file).write_text(json.dumps({"auto_update": True, "interval_hours": 12, "last_check": 1000}))
        mgr = helper.PackageManager(self.temp.name)
        self.assertEqual(mgr.get_settings()["interval_value"], 12)
        self.assertEqual(mgr.get_settings()["interval_unit"], "hr")
        mgr.update_settings(interval_value=5, interval_unit="min")
        mgr = helper.PackageManager(self.temp.name)
        with patch.object(helper.time, "time", return_value=1299):
            self.assertFalse(mgr.get_settings()["overdue"])
        with patch.object(helper.time, "time", return_value=1300):
            self.assertTrue(mgr.get_settings()["overdue"])
        self.assertNotIn("interval_hours", json.loads(Path(mgr.settings_file).read_text()))

    def test_invalid_intervals_leave_persisted_settings_unchanged(self):
        self.mgr.update_settings(interval_value=30, interval_unit="min")
        before = Path(self.mgr.settings_file).read_bytes()
        for value, unit in [(0, "min"), (-1, "hr"), (1.5, "hr"), (True, "min"), (1, "seconds")]:
            with self.subTest(value=value, unit=unit), self.assertRaises(ValueError):
                self.mgr.update_settings(interval_value=value, interval_unit=unit)
            self.assertEqual(Path(self.mgr.settings_file).read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
