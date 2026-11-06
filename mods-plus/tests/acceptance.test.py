#!/usr/bin/env python3
"""Acceptance test suite for Mods Plus in a disposable environment."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("helper", os.path.join(os.path.dirname(__file__), "../mods/mods-plus/helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
PackageManager = helper.PackageManager


class TestAcceptance(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="mods-plus-acc-")
        self.app = os.path.join(self.base, "app")
        os.makedirs(os.path.join(self.app, "mods"), exist_ok=True)
        os.makedirs(os.path.join(self.app, "layouts"), exist_ok=True)
        os.makedirs(os.path.join(self.app, "data"), exist_ok=True)

        # 1. Shipped installed.json
        with open(os.path.join(self.app, "installed.json"), "w") as f:
            json.dump({"shipped-mod": {"main.js": "1111"}, "layout:main": {"json": "2222"}}, f)

        # 2. Personal layout referencing 'existing-mod'
        personal_layout = {
            "id": "root",
            "type": "row",
            "children": [
                {"id": "pane-1", "type": "block", "content": {"mod": "existing-mod"}},
                {"id": "pane-2", "type": "block", "content": {"mod": "standalone-mod"}},
            ]
        }
        with open(os.path.join(self.app, "layouts", "personal.json"), "w") as f:
            json.dump(personal_layout, f)

        self.mgr = PackageManager(self.app)

        # Seed mock catalog index
        self.mock_index = {
            "alice/herdr-existing-mod": {
                "stars": 42,
                "description": "An existing mod",
                "branch": "main",
                "mod": {"existing-mod": ["mods/existing-mod"]},
                "layout": {},
                "previews": {},
                "recipes": {"mods/existing-mod": "mods/existing-mod/RECIPE.md"}
            },
            "bob/herdr-new-suite": {
                "stars": 88,
                "description": "A new suite of mods and layouts",
                "branch": "main",
                "mod": {"suite-mod": ["mods/suite-mod"]},
                "layout": {"suite-layout": ["layouts/suite-layout.json"]},
                "previews": {},
                "recipes": {}
            },
            "charlie/herdr-colliding-mod": {
                "stars": 5,
                "description": "A mod that collides with local directory",
                "branch": "main",
                "mod": {"standalone-mod": ["mods/standalone-mod"]},
                "layout": {},
                "previews": {},
                "recipes": {}
            }
        }
        with open(os.path.join(self.mgr.cache_dir, "index.json"), "w") as f:
            json.dump(self.mock_index, f)

        # The official catalog is the boundary; GitHub trees are only file evidence.
        fixtures = []
        for repo, info in self.mock_index.items():
            for kind in ("mod", "layout"):
                if not info[kind]:
                    continue
                fixtures.append(helper.gallery.normalize({
                    "fullName": repo, "owner": repo.split("/")[0], "name": repo.split("/")[1],
                    "blurb": info["description"], "stars": info["stars"],
                    "modNames": list(info["mod"]),
                    "layoutFiles": [p for paths in info["layout"].values() for p in paths],
                }, kind))
        self.catalog_patch = patch.object(helper.gallery, "official_packages", return_value=fixtures)
        self.catalog_patch.start()
        self.addCleanup(self.catalog_patch.stop)
        def tree(repo, branch="HEAD", refresh=False):
            with open(os.path.join(self.mgr.cache_dir, f"tree-{repo.replace('/', '-')}.json")) as f:
                return json.load(f)
        self.mgr.branch_tree = tree
        self.mgr._gh_api = lambda path: {"default_branch": "main", "private": False}

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_acceptance_criteria_flow(self):
        # 1. Create a matching local mod for existing-mod (file hashes match upstream mock tree)
        local_existing = os.path.join(self.app, "mods", "existing-mod")
        os.makedirs(local_existing, exist_ok=True)
        file_bytes = b"// existing mod code\nconsole.log('hi');"
        with open(os.path.join(local_existing, "main.js"), "wb") as f:
            f.write(file_bytes)

        # Upstream tree for alice/herdr-existing-mod
        tree_slug = "alice-herdr-existing-mod"
        with open(os.path.join(self.mgr.cache_dir, f"tree-{tree_slug}.json"), "w") as f:
            json.dump({"mods/existing-mod/main.js": helper.blob_sha(file_bytes)}, f)

        # 2. Create colliding directory for charlie/herdr-colliding-mod with DIFFERENT files
        local_colliding = os.path.join(self.app, "mods", "standalone-mod")
        os.makedirs(local_colliding, exist_ok=True)
        with open(os.path.join(local_colliding, "main.js"), "wb") as f:
            f.write(b"// entirely different local content")

        tree_colliding = "charlie-herdr-colliding-mod"
        with open(os.path.join(self.mgr.cache_dir, f"tree-{tree_colliding}.json"), "w") as f:
            json.dump({"mods/standalone-mod/main.js": "different-sha-12345"}, f)

        # 3. Acceptance Check 3: Existing packages are recognized without Adopt.
        # Modified copies and ambiguous name collisions remain intact.
        catalog = self.mgr.build_catalog()
        alice_pkg = next(p for p in catalog if p["id"] == "alice/herdr-existing-mod")
        self.assertTrue(alice_pkg["installed"], "Existing package must be recognized without manual adopt")
        self.assertIsNone(alice_pkg["collision"])

        charlie_pkg = next(p for p in catalog if p["id"] == "charlie/herdr-colliding-mod")
        self.assertFalse(charlie_pkg["installed"], "Colliding directory must not be falsely adopted")
        self.assertIsNotNone(charlie_pkg["collision"], "Collision must be documented with clear explanation")
        self.assertIn("Local mod folder", charlie_pkg["collision"])

        # 4. Acceptance Check 2: Installed-first ordering in "all"
        all_pkgs = self.mgr.build_catalog(status_filter="all")
        self.assertTrue(all_pkgs[0]["installed"], "Installed packages must appear first in 'all' filter")

        # Filtering by kind
        mod_only = self.mgr.build_catalog(kind_filter="mod")
        self.assertTrue(all(p["kind"] in ("mod", "both") for p in mod_only))

        layout_only = self.mgr.build_catalog(kind_filter="layout")
        self.assertTrue(all(p["kind"] in ("layout", "both") for p in layout_only))

        # 5. Acceptance Check 4: Install completes through scripts without unintended layout changes.
        # Newly installed package must remain outside active mods/ until separate activation!
        suite_code = b'import { View, div } from "gpui-kit";\nexport default class SuiteMod extends View { render() { return div(); } }\n'
        suite_code_v2 = b'import { View, div } from "gpui-kit";\nexport default class SuiteMod extends View { render() { return div().child("v2"); } }\n'
        bob_tree = {
            "HEAD": "baseline-commit",
            "mods/suite-mod/main.js": helper.blob_sha(suite_code),
            "mods/suite-mod/mod.json": helper.blob_sha(b'{"place":"none"}'),
            "layouts/suite-layout.json": helper.blob_sha(b'{"id":"suite","type":"block"}'),
            "RECIPE.md": helper.blob_sha(b"# Suite Recipe\nActivate with love."),
        }
        with open(os.path.join(self.mgr.cache_dir, "tree-bob-herdr-new-suite.json"), "w") as f:
            json.dump(bob_tree, f)

        # Seed mock blobs
        for path, sha in bob_tree.items():
            if path == "HEAD":
                continue
            blob_path = os.path.join(self.mgr.cache_dir, "blobs", sha[:2], sha)
            os.makedirs(os.path.dirname(blob_path), exist_ok=True)
            content = b"# Suite Recipe\nActivate with love." if path == "RECIPE.md" else b'{"id":"suite","type":"block"}' if "layout" in path else b'{"place":"none"}' if "mod.json" in path else suite_code
            with open(blob_path, "wb") as f:
                f.write(content)

        # Mock herdr-app check by creating a dummy pass if needed or letting it succeed
        # Run install
        install_review = self.mgr.review_install("bob/herdr-new-suite")
        install_res = self.mgr.install("bob/herdr-new-suite", reviewed=install_review["token"])
        self.assertTrue(install_res["ok"])

        # Check: Installed package MUST NOT exist in active mods/ yet!
        active_suite_mod = os.path.join(self.app, "mods", "suite-mod")
        self.assertFalse(os.path.exists(active_suite_mod), "Newly installed mod must not appear in active mods/ before activation")

        # Check: Package record marked installed=True, enabled=False
        rec = self.mgr.records["bob/herdr-new-suite"]
        self.assertTrue(rec["installed"])
        self.assertFalse(rec["enabled"])

        # 6. Acceptance Check 5: Enable performs the integration
        enable_res = self.mgr.enable("bob/herdr-new-suite")
        self.assertTrue(enable_res["ok"])
        self.assertTrue(os.path.exists(active_suite_mod), "Enabled mod must now exist in active mods/")
        self.assertTrue(self.mgr.records["bob/herdr-new-suite"]["enabled"])

        # Use layout
        # Do not switch the developer's live window from a disposable test.
        with patch.object(helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as command:
            layout_res = self.mgr.use_layout("bob/herdr-new-suite")
            self.assertEqual(command.call_args.args[0][:3], ["herdr-app", "do", "layout.switch"])
        self.assertTrue(layout_res["ok"])
        active_layout = os.path.join(self.app, "layouts", "suite-layout.json")
        self.assertTrue(os.path.exists(active_layout), "Layout file must be copied to layouts/")

        # 7. Acceptance Check 5: Activation prompt contains source, revision, paths, recipe, and layout
        prompt_res = self.mgr.generate_prompt("bob/herdr-new-suite")
        self.assertIn("bob/herdr-new-suite", prompt_res["text"])
        self.assertIn("suite-mod", prompt_res["text"])
        self.assertIn("Activate with love.", prompt_res["text"])
        self.assertIn(self.app, prompt_res["text"])

        # 8. Acceptance Check 6: Removal checks references across layouts and blocks unsafe deletion
        # alice/herdr-existing-mod is referenced by personal.json ('existing-mod')
        rem_res = self.mgr.remove("alice/herdr-existing-mod", force=False)
        self.assertFalse(rem_res["ok"], "Removal must be blocked when a layout still references the mod")
        self.assertIn("personal", rem_res["error"])
        self.assertIn("cleanup_prompt", rem_res)
        self.assertTrue(os.path.exists(local_existing), "Referenced files must remain completely intact")

        # 9. Acceptance Check 7: Manual updates default, scheduled check interval
        s = self.mgr.get_settings()
        self.assertFalse(s["auto_update"], "Manual updates must be the default")
        self.mgr.update_settings(auto_update=True, interval_hours=6)
        s2 = self.mgr.get_settings()
        self.assertTrue(s2["auto_update"])
        self.assertEqual(s2["interval_hours"], 6)

        # 10. Acceptance Check 8: Prepared updates leave running interface intact
        # Mock upstream newer commit for bob/herdr-new-suite
        updated_tree = dict(bob_tree)
        new_sha = helper.blob_sha(suite_code_v2)
        updated_tree["mods/suite-mod/main.js"] = new_sha
        updated_tree["HEAD"] = "newcommit999"
        with open(os.path.join(self.mgr.cache_dir, "tree-bob-herdr-new-suite.json"), "w") as f:
            json.dump(updated_tree, f)
        blob_path = os.path.join(self.mgr.cache_dir, "blobs", new_sha[:2], new_sha)
        os.makedirs(os.path.dirname(blob_path), exist_ok=True)
        with open(blob_path, "wb") as f:
            f.write(suite_code_v2)

        # Check updates: creates candidate in updates_dir without modifying active mods/
        chk_res = self.mgr.check_updates()
        self.assertTrue(chk_res["ok"])
        self.assertEqual(chk_res["count"], 1)

        # Active mod file MUST still be v1!
        with open(os.path.join(active_suite_mod, "main.js"), "rb") as f:
            curr_code = f.read()
        self.assertEqual(curr_code, suite_code, "Running mod must not be mutated upon candidate download")

        # Apply update immediately: now active mod becomes v2!
        update_review = self.mgr.review_update("bob/herdr-new-suite")
        apply_res = self.mgr.apply_update("bob/herdr-new-suite", reviewed=update_review["token"])
        self.assertTrue(apply_res["ok"])
        with open(os.path.join(active_suite_mod, "main.js"), "rb") as f:
            updated_code = f.read()
        self.assertEqual(updated_code, suite_code_v2, "Active mod must be updated when apply_update is called")


if __name__ == "__main__":
    unittest.main()
