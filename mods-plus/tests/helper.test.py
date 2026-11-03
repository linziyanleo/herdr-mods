#!/usr/bin/env python3
"""Unit and contract tests for Mods Plus local package manager helper."""

import importlib.util
import json
import os
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("helper", os.path.join(os.path.dirname(__file__), "../mods/mods-plus/helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
PackageManager = helper.PackageManager


class TestPackageManager(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="mods-plus-test-")
        self.app_home = os.path.join(self.test_dir, "herdr-app")
        os.makedirs(os.path.join(self.app_home, "mods"), exist_ok=True)
        os.makedirs(os.path.join(self.app_home, "layouts"), exist_ok=True)
        os.makedirs(os.path.join(self.app_home, "data"), exist_ok=True)

        # Mock installed.json (shipped items)
        with open(os.path.join(self.app_home, "installed.json"), "w") as f:
            json.dump({"shipped-mod": {"main.js": "1234"}, "layout:main": {"json": "5678"}}, f)

        # Create sample layout referencing 'custom-mod'
        layout_data = {
            "id": "root",
            "type": "row",
            "children": [
                {"id": "test-pane", "type": "block", "content": {"mod": "custom-mod"}}
            ]
        }
        with open(os.path.join(self.app_home, "layouts", "custom-layout.json"), "w") as f:
            json.dump(layout_data, f)

        self.mgr = PackageManager(self.app_home)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_settings_and_overdue(self):
        s = self.mgr.get_settings()
        self.assertFalse(s["auto_update"])
        self.assertEqual(s["interval_hours"], 24)
        self.assertFalse(s["overdue"])

        # Update settings to auto_update=True with 1 hour interval
        updated = self.mgr.update_settings(auto_update=True, interval_hours=1, default_agent="codex")
        self.assertTrue(updated["auto_update"])
        self.assertEqual(updated["default_agent"], "codex")
        self.assertTrue(updated["overdue"])  # Never checked before, so overdue is True

    def test_reference_protection_on_removal(self):
        # Register a package with 'custom-mod'
        pkg_id = "testowner/testmod"
        self.mgr.records[pkg_id] = {
            "id": pkg_id,
            "repo": "testowner/testmod",
            "subdir": "",
            "commit": "c123456",
            "files": {},
            "mods": ["custom-mod"],
            "layouts": [],
            "installed": True,
            "enabled": True,
        }
        self.mgr._save_records()

        # Create mod folder in active mods/
        mod_dir = os.path.join(self.app_home, "mods", "custom-mod")
        os.makedirs(mod_dir, exist_ok=True)
        with open(os.path.join(mod_dir, "main.js"), "w") as f:
            f.write("// custom mod")

        # Try to remove without force: must be blocked because custom-layout references it
        res = self.mgr.remove(pkg_id, force=False)
        self.assertFalse(res["ok"])
        self.assertIn("custom-layout", res["error"])
        self.assertTrue(os.path.exists(mod_dir))  # Files must be preserved!
        self.assertIn("cleanup_prompt", res)

        # Now remove with force: files backed up and removed
        res_force = self.mgr.remove(pkg_id, force=True)
        self.assertTrue(res_force["ok"])
        self.assertFalse(os.path.exists(mod_dir))
        self.assertNotIn(pkg_id, self.mgr.records)

        # Check backup exists
        backups = os.listdir(self.mgr.backups_dir)
        self.assertTrue(len(backups) > 0)

    def test_separate_install_and_enable(self):
        # Mock package files in cache/stage
        pkg_id = "testowner/newmod"
        repo = "testowner/newmod"
        slug = pkg_id.replace("/", "-")
        stage_dir = os.path.join(self.mgr.stage_dir, slug)
        os.makedirs(os.path.join(stage_dir, "mods", "newmod"), exist_ok=True)
        with open(os.path.join(stage_dir, "mods", "newmod", "main.js"), "w") as f:
            f.write("// new mod code")
        with open(os.path.join(stage_dir, "RECIPE.md"), "w") as f:
            f.write("# New Mod Recipe\nStep 1: Enjoy.")

        # Simulate install by placing staged package in packages_dir and recording
        pkg_store = os.path.join(self.mgr.packages_dir, slug)
        shutil.copytree(stage_dir, pkg_store)
        shutil.rmtree(stage_dir)

        self.mgr.records[pkg_id] = {
            "id": pkg_id,
            "repo": repo,
            "subdir": "",
            "commit": "c987654",
            "files": {"mods/newmod/main.js": helper.blob_sha(b"// new mod code")},
            "mods": ["newmod"],
            "layouts": [],
            "installed": True,
            "enabled": False,
            "at": "2026-11-03",
        }
        self.mgr._save_records()

        # Newly installed package MUST NOT be in active mods/ yet!
        active_mod = os.path.join(self.app_home, "mods", "newmod")
        self.assertFalse(os.path.exists(active_mod))

        # Enable package: now files must be copied to active mods/
        en_res = self.mgr.enable(pkg_id)
        self.assertTrue(en_res["ok"])
        self.assertTrue(os.path.exists(active_mod))
        self.assertTrue(self.mgr.records[pkg_id]["enabled"])

    def test_generate_prompt(self):
        pkg_id = "testowner/agentic-mod"
        self.mgr.records[pkg_id] = {
            "id": pkg_id,
            "repo": "testowner/agentic-mod",
            "subdir": "",
            "commit": "abc1234",
            "mods": ["agentic-mod"],
            "installed": True,
            "enabled": False,
        }
        prompt = self.mgr.generate_prompt(pkg_id, "# Recipe\nAdd to sidebar.")
        self.assertIn("https://github.com/testowner/agentic-mod", prompt["text"])
        self.assertIn("Add to sidebar.", prompt["text"])
        self.assertIn("target app home", prompt["text"].lower())
        self.assertIn("herdr-app check", prompt["text"])


if __name__ == "__main__":
    unittest.main()
