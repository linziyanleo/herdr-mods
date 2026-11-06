"""Review/import contracts against fake GitHub blobs and disposable app homes."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "mods/mods-plus/helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mods-review-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.mgr = helper.PackageManager(self.temp.name)
        self.repo = "owner/suite"
        self.blobs = {}
        self.code = b'import { View, div } from "gpui-kit"; export default class Mod extends View { render() { return div().child("v1"); } }'
        self.content = {
            "one/RECIPE.md": b"# One\nA test package.",
            "one/mods/one/main.js": self.code,
            "one/mods/one/mod.json": b'{"place":"none"}',
            "one/mods/one/note.txt": b"first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\nlast\n",
            "one/keys.json": b'{"global":{"cmd-shift-x":"mod.open:one","cmd-shift-y":"mod.open:one"}}',
            "two/RECIPE.md": b"# Two",
            "two/layouts/two.json": b'{"id":"root","type":"block","content":{"mod":"one"}}',
            "docs/RECIPE.md": b"# Not a package",
        }
        self.revision = "a" * 40
        self.update_tree()
        self.wire(self.mgr)
        (self.home / "keys.json").write_text('{"global":{"cmd-shift-x":"app.palette"}}')

    def update_tree(self):
        self.tree = {"HEAD": self.revision}
        for path, content in self.content.items():
            sha = helper.blob_sha(content)
            self.blobs[sha] = content
            self.tree[path] = sha

    def wire(self, mgr):
        mgr._gh_api = lambda path: {"default_branch": "develop", "private": False}
        mgr.branch_tree = lambda *args, **kwargs: copy.deepcopy(self.tree)
        mgr.blob_bytes = lambda repo, sha: self.blobs[sha]

    def installed(self, active=False):
        proposal = self.mgr.review_install(self.repo, "one")
        result = self.mgr.install(self.repo, "one", reviewed=proposal["token"])
        self.assertTrue(result["ok"], result)
        if active:
            self.assertTrue(self.mgr.enable(self.repo + "/one")["ok"])
        return self.repo + "/one"

    def prepare_update(self):
        self.revision = "b" * 40
        self.update_tree()
        result = self.mgr.check_updates()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["count"], 1)

    def snapshot(self):
        return {str(p.relative_to(self.home)): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}

    def test_multi_package_discovery_and_review_have_no_install_side_effects(self):
        before = self.snapshot()
        with patch.object(helper.subprocess, "run", side_effect=AssertionError("Preview executed a program")):
            found = self.mgr.discover("https://github.com/owner/suite/tree/develop")
            self.assertEqual([p["id"] for p in found["packages"]], ["owner/suite/one", "owner/suite/two"])
            self.assertEqual([p["kind"] for p in found["packages"]], ["mod", "layout"])
            self.assertEqual(len(self.mgr.discover("owner/suite/one")["packages"]), 1)
            proposal = self.mgr.review_install(self.repo, "one")
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(proposal["mods"], ["one"])
        self.assertEqual(proposal["commit"], "a" * 40)
        self.assertEqual(proposal["shortcuts"][0]["status"], "conflict")
        self.assertNotIn("two/RECIPE.md", proposal["files"])

    def test_invalid_hosts_paths_refs_and_private_sources_are_rejected(self):
        for value in ["https://example.com/a/b", "http://github.com/a/b", "https://github.com.evil/a/b",
                      "https://user@github.com/a/b", "https://github.com:443/a/b", "a/b/../x", "a/b/./x",
                      "a/b//x", "a/b/%2e%2e", "a/b@tag", "https://github.com/a/b?ref=main",
                      "https://github.com/a/b/blob/develop/README.md", "a/b/\\x"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.mgr.discover(value)
        with self.assertRaisesRegex(ValueError, "Non-default or ambiguous"):
            self.mgr.discover("https://github.com/owner/suite/tree/main/one")
        self.mgr._gh_api = lambda path: {"default_branch": "release/next", "private": False}
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.mgr.discover("https://github.com/owner/suite/tree/release/next/one")
        self.mgr._gh_api = lambda path: {"default_branch": "develop", "private": True}
        with self.assertRaisesRegex(ValueError, "public"):
            self.mgr.discover(self.repo)

    def test_reviewed_revision_and_local_key_drift_refuse_before_checks(self):
        proposal = self.mgr.review_install(self.repo, "one")
        self.revision = "b" * 40
        self.update_tree()
        with patch.object(helper.subprocess, "run", side_effect=AssertionError("Stale review executed check")):
            result = self.mgr.install(self.repo, "one", reviewed=proposal["token"])
        self.assertFalse(result["ok"])
        self.assertIn("changed since review", result["error"])
        proposal = self.mgr.review_install(self.repo, "one")
        (self.home / "keys.json").write_text('{"global":{"cmd-shift-y":"app.help"}}')
        self.assertFalse(self.mgr.install(self.repo, "one", reviewed=proposal["token"])["ok"])
        self.assertEqual(self.mgr.records, {})

    def test_install_enable_keys_and_source_survive_restart_catalog_outage_and_removal(self):
        pkg_id = self.installed()
        self.assertFalse((self.home / "mods/one").exists())

        self.assertNotIn("cmd-shift-y", json.loads((self.home / "keys.json").read_text())["global"])
        mgr = helper.PackageManager(self.temp.name)
        self.wire(mgr)
        self.assertEqual(mgr.records[pkg_id]["ref"], "develop")
        with patch.object(helper.gallery, "official_packages", side_effect=OSError("catalog offline")):
            catalog = mgr.build_catalog(status_filter="installed")
            self.assertEqual([p["id"] for p in catalog], [pkg_id])
            self.assertEqual(mgr.get_details(pkg_id)["recipe"], "# One\nA test package.")
        self.assertTrue(mgr.enable(pkg_id)["ok"])
        keys = json.loads((self.home / "keys.json").read_text())["global"]
        self.assertEqual(keys["cmd-shift-x"], "app.palette")
        self.assertEqual(keys["cmd-shift-y"], "mod.open:one")
        self.assertTrue(mgr.remove(pkg_id)["ok"])
        self.assertEqual(json.loads((self.home / "keys.json").read_text())["global"], {"cmd-shift-x": "app.palette"})
        self.assertFalse((self.home / "mods/one").exists())

    def test_cached_catalog_keeps_imported_sources_without_network_or_record_writes(self):
        pkg_id = self.installed()
        mgr = helper.PackageManager(self.temp.name)
        mgr.cache_only = True
        before = Path(mgr.records_file).read_bytes()
        with patch.object(helper.gallery, "download", side_effect=AssertionError("Cached import made a network request")):
            packages = mgr.build_catalog(status_filter="installed")
            self.assertEqual([pkg["id"] for pkg in packages], [pkg_id])
            self.assertEqual([item["id"] for item in helper.gallery.media(mgr, [pkg_id])], [pkg_id])
        self.assertEqual(Path(mgr.records_file).read_bytes(), before)

    def test_activation_collision_does_not_overwrite_a_new_local_mod(self):
        pkg_id = self.installed()
        local = self.home / "mods/one/main.js"
        local.parent.mkdir(parents=True)
        local.write_text("preserve me")
        self.assertFalse(self.mgr.enable(pkg_id)["ok"])
        self.assertEqual(local.read_text(), "preserve me")
        self.assertTrue(self.mgr.remove(pkg_id)["ok"])
        self.assertEqual(local.read_text(), "preserve me", "removing an inactive package cannot claim active files")

    def test_update_merges_local_edits_deletes_owned_files_and_keeps_rebound_keys(self):
        pkg_id = self.installed(active=True)
        local = self.home / "mods/one/note.txt"
        local.write_bytes(local.read_bytes().replace(b"first", b"local-first"))
        self.content["one/mods/one/note.txt"] = self.content["one/mods/one/note.txt"].replace(b"last", b"upstream-last")
        self.content["one/mods/one/main.js"] = self.code.replace(b"v1", b"v2")
        self.content["one/keys.json"] = b'{"global":{"cmd-shift-y":"mod.open:updated","cmd-shift-z":"mod.open:one"}}'
        (self.home / "keys.json").write_text('{"global":{"cmd-shift-x":"app.palette","cmd-shift-y":"app.help"}}')
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertEqual(proposal["conflicts"], [])
        self.assertIn("mods/one/note.txt", proposal["locally_modified"])
        result = self.mgr.apply_update(pkg_id, reviewed=proposal["token"])
        self.assertTrue(result["ok"], result)
        self.assertIn(b"local-first", local.read_bytes())
        self.assertIn(b"upstream-last", local.read_bytes())
        self.assertEqual(json.loads((self.home / "keys.json").read_text())["global"]["cmd-shift-y"], "app.help")
        self.assertEqual(helper.PackageManager(self.temp.name).records[pkg_id]["commit"], self.revision)
        del self.content["one/mods/one/note.txt"]
        self.prepare_update()
        self.assertIn("Local edit conflict: mods/one/note.txt", self.mgr.review_update(pkg_id)["conflicts"])

    def test_candidate_and_local_drift_never_apply_unreviewed_files(self):
        pkg_id = self.installed(active=True)
        self.content["one/mods/one/main.js"] = self.code.replace(b"v1", b"v2")
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        local = self.home / "mods/one/main.js"
        local.write_bytes(self.code + b"\n// local edit\n")
        before = self.snapshot()
        self.assertFalse(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertEqual(self.snapshot(), before)
        candidate = Path(self.mgr.updates_dir) / "owner-suite-one/candidate/mods/one/main.js"
        candidate.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "Prepared update changed"):
            self.mgr.apply_update(pkg_id, reviewed=proposal["token"])

    def test_new_files_only_update_is_detected_without_activating_stored_package(self):
        pkg_id = self.installed()
        self.content["one/mods/one/new.txt"] = b"new"
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertIn({"path": "mods/one/new.txt", "status": "add"}, proposal["changes"])
        self.assertTrue(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertFalse((self.home / "mods/one").exists())
        self.assertFalse(self.mgr.records[pkg_id]["enabled"])

    def test_removed_files_and_replaced_candidates_are_reviewed_again(self):
        pkg_id = self.installed(active=True)
        del self.content["one/mods/one/note.txt"]
        self.prepare_update()
        old_review = self.mgr.review_update(pkg_id)
        self.assertIn({"path": "mods/one/note.txt", "status": "remove"}, old_review["changes"])
        self.content["one/RECIPE.md"] = b"# One\nUpdated recipe."
        self.prepare_update()
        self.assertFalse(self.mgr.apply_update(pkg_id, reviewed=old_review["token"])["ok"])
        proposal = self.mgr.review_update(pkg_id)
        self.assertTrue(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertFalse((self.home / "mods/one/note.txt").exists())
        self.assertEqual(self.mgr.records[pkg_id]["source"]["recipe"], "# One\nUpdated recipe.")
        self.content["one/mods/replacement/main.js"] = self.code
        del self.content["one/mods/one/main.js"]
        del self.content["one/mods/one/mod.json"]
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertEqual(proposal["conflicts"], [])
        (self.home / "layouts").mkdir(exist_ok=True)
        (self.home / "layouts/other.json").write_text('{"content":{"mod":"one"}}')
        self.assertNotEqual(self.mgr.review_update(pkg_id)["token"], proposal["token"])
        self.assertFalse(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertTrue((self.home / "mods/one/main.js").exists())

    def test_layout_review_and_update_preserve_local_layout_edits(self):
        self.content["one/layouts/one.json"] = b'{\n "id": "root",\n "type": "block",\n "background": "surface",\n "padding": 8,\n "min": 0,\n "max": 500,\n "hidden": false,\n "size": {"px": 100},\n "content": {"mod": "one"}\n}\n'
        self.update_tree()
        pkg_id = self.installed(active=True)
        with patch.object(helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            self.assertTrue(self.mgr.use_layout(pkg_id)["ok"])
        layout = self.home / "layouts/one.json"
        layout.parent.mkdir(exist_ok=True)
        layout.write_bytes(self.content["one/layouts/one.json"].replace(b'"surface"', b'"chrome"'))
        self.content["one/layouts/one.json"] = self.content["one/layouts/one.json"].replace(b'"px": 100', b'"px": 200')
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertIn({"path": "one", "status": "change"}, proposal["layout_changes"])
        result = self.mgr.apply_update(pkg_id, reviewed=proposal["token"])
        self.assertTrue(result["ok"], result)
        self.assertEqual(json.loads(layout.read_text())["background"], "chrome")
        self.assertEqual(json.loads(layout.read_text())["size"]["px"], 200)

    def layout_pair(self):
        self.content["one/layouts/a.json"] = b'{"id":"a","type":"block","background":"surface"}'
        self.content["one/layouts/b.json"] = b'{"id":"b","type":"block","background":"surface"}'
        self.update_tree()
        pkg_id = self.installed()
        with patch.object(helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as command:
            result = self.mgr.use_layout(pkg_id)
            self.assertTrue(result["ok"], result)
            self.assertEqual(command.call_args.args[0], ["herdr-app", "do", "layout.switch", "--name", "a"])
        self.assertEqual(helper.PackageManager(self.temp.name).records[pkg_id]["active_layouts"], ["a"])
        self.assertFalse((self.home / "layouts/b.json").exists())
        # Identical bytes are not ownership evidence: the user creates this file independently.
        (self.home / "layouts/b.json").write_bytes(self.content["one/layouts/b.json"])
        return pkg_id

    def test_update_and_remove_only_own_the_layout_actually_enabled(self):
        pkg_id = self.layout_pair()
        unrelated = (self.home / "layouts/b.json").read_bytes()
        for name in ("a", "b"):
            path = f"one/layouts/{name}.json"
            self.content[path] = self.content[path].replace(b"surface", b"raised")
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertEqual(proposal["conflicts"], [])
        self.assertTrue(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertEqual(json.loads((self.home / "layouts/a.json").read_bytes())["background"], "raised")
        self.assertEqual((self.home / "layouts/b.json").read_bytes(), unrelated)
        self.assertEqual((Path(self.mgr.packages_dir) / "owner-suite-one/layouts/b.json").read_bytes(), self.content["one/layouts/b.json"])
        self.assertEqual(helper.PackageManager(self.temp.name).records[pkg_id]["active_layouts"], ["a"])
        self.assertTrue(self.mgr.remove(pkg_id)["ok"])
        self.assertFalse((self.home / "layouts/a.json").exists())
        self.assertEqual((self.home / "layouts/b.json").read_bytes(), unrelated)

    def test_legacy_enabled_flag_never_infers_layout_ownership(self):
        pkg_id = self.layout_pair()
        del self.mgr.records[pkg_id]["active_layouts"]
        self.mgr._save_records()
        self.mgr = helper.PackageManager(self.temp.name)
        self.wire(self.mgr)
        before = {name: (self.home / f"layouts/{name}.json").read_bytes() for name in ("a", "b")}
        for name in ("a", "b"):
            path = f"one/layouts/{name}.json"
            self.content[path] = self.content[path].replace(b"surface", b"raised")
        self.content["one/mods/one/main.js"] = self.code.replace(b"v1", b"v2")
        self.prepare_update()
        proposal = self.mgr.review_update(pkg_id)
        self.assertTrue(self.mgr.apply_update(pkg_id, reviewed=proposal["token"])["ok"])
        self.assertEqual(self.mgr.records[pkg_id]["active_layouts"], [])
        self.assertEqual((self.home / "mods/one/main.js").read_bytes(), self.content["one/mods/one/main.js"])
        self.assertFalse(self.mgr.use_layout(pkg_id)["ok"], "An existing layout needs recorded ownership even after an update")
        self.assertTrue(self.mgr.remove(pkg_id)["ok"])
        for name in ("a", "b"):
            self.assertEqual((self.home / f"layouts/{name}.json").read_bytes(), before[name])

    def bulk_pair(self, active_layout=True):
        mod_id = self.installed(active=True)
        proposal = self.mgr.review_install(self.repo, "two")
        self.assertTrue(self.mgr.install(self.repo, "two", reviewed=proposal["token"])["ok"])
        layout_id = self.repo + "/two"
        if active_layout:
            with patch.object(helper.subprocess, "run"):
                self.assertTrue(self.mgr.use_layout(layout_id)["ok"])
        self.content["one/mods/one/main.js"] = self.code.replace(b"v1", b"v2")
        self.content["two/layouts/two.json"] = self.content["two/layouts/two.json"].replace(b'"root"', b'"updated"')
        self.revision = "b" * 40
        self.update_tree()
        return mod_id, layout_id

    def test_update_all_applies_mod_and_layout_and_preserves_local_edits(self):
        ids = self.bulk_pair()
        layout_path = self.home / "layouts/two.json"
        # Local, unmanaged mod files and declined shortcuts survive the batch.
        extra = self.home / "mods/one/local.txt"
        extra.write_text("keep me")
        with patch.object(self.mgr, "copy_text", side_effect=AssertionError("No agent needed")):
            result = self.mgr.update_all()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["updated"], list(ids))
        self.assertFalse(result["needs_agent"])
        self.assertEqual(result["settings"]["prepared_updates_count"], 0)
        self.assertEqual((self.home / "mods/one/main.js").read_bytes(), self.content["one/mods/one/main.js"])
        self.assertEqual(layout_path.read_bytes(), self.content["two/layouts/two.json"])
        self.assertEqual(extra.read_text(), "keep me")
        self.assertEqual(json.loads((self.home / "keys.json").read_text())["global"]["cmd-shift-x"], "app.palette")
        self.assertTrue(list(Path(self.mgr.backups_dir).iterdir()))
        self.assertTrue(all(self.mgr.records[pkg_id]["commit"] == self.revision for pkg_id in ids))
        self.assertEqual(self.mgr.update_all()["updated"], [])

    def test_update_all_keeps_stored_layout_inactive(self):
        _, layout_id = self.bulk_pair(active_layout=False)
        result = self.mgr.update_all()
        self.assertTrue(result["ok"], result)
        self.assertFalse((self.home / "layouts/two.json").exists())
        self.assertFalse(self.mgr.records[layout_id]["enabled"])
        stored = Path(self.mgr.packages_dir) / layout_id.replace("/", "-") / "layouts/two.json"
        self.assertEqual(stored.read_bytes(), self.content["two/layouts/two.json"])

    def test_update_all_copies_complete_batch_for_changed_recipe_without_applying(self):
        ids = self.bulk_pair()
        recipe = "# New recipe\nConfigure the new panel before using it.\n" + "Full instructions.\n" * 100
        self.content["one/RECIPE.md"] = recipe.encode()
        self.update_tree()
        before = {name: (self.home / name).read_bytes() for name in ("mods/one/main.js", "layouts/two.json", "keys.json")}
        with patch.object(self.mgr, "copy_text", return_value=True) as copy:
            result = self.mgr.update_all()
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["needs_agent"])
        self.assertEqual(result["pending"], list(ids))
        self.assertEqual(result["updated"], [])
        self.assertEqual(result["settings"]["prepared_updates_count"], 2)
        prompt = copy.call_args.args[0]
        self.assertEqual(prompt, result["prompt"])
        self.assertEqual(Path(result["prompt_path"]).read_text(), prompt)
        for text in [*ids, recipe, str(self.home), "a" * 40, "b" * 40, "herdr-app check", "herdr-app shot",
                     "layouts/two.json", "mods/one/main.js", "Prepared candidate:", "Shortcut review:"]:
            self.assertIn(text, prompt)
        for name, value in before.items():
            self.assertEqual((self.home / name).read_bytes(), value)

    def test_update_all_merge_conflict_and_clipboard_failure_preserve_all_packages(self):
        ids = self.bulk_pair()
        local = self.home / "mods/one/main.js"
        local.write_bytes(self.code.replace(b"v1", b"local"))
        with patch.object(self.mgr, "copy_text", return_value=False):
            result = self.mgr.update_all()
        self.assertFalse(result["ok"])
        self.assertTrue(result["needs_agent"])
        self.assertFalse(result["copied"])
        self.assertEqual(result["updated"], [])
        self.assertIn("Local edit conflict", result["prompt"])
        self.assertIn(ids[1], result["prompt"])
        self.assertEqual(Path(result["prompt_path"]).read_text(), result["prompt"])
        self.assertIn(b"local", local.read_bytes())
        self.assertTrue(all(self.mgr.records[pkg_id]["commit"] == "a" * 40 for pkg_id in ids))

    def test_update_all_check_failure_never_applies_stale_candidates(self):
        ids = self.bulk_pair()
        self.assertTrue(self.mgr.check_updates()["ok"])
        with patch.object(self.mgr, "branch_tree", side_effect=OSError("offline")), \
             patch.object(self.mgr, "apply_update", side_effect=AssertionError("Must not apply")):
            result = self.mgr.update_all()
        self.assertFalse(result["ok"])
        self.assertEqual(result["updated"], [])
        self.assertEqual(len(result["errors"]), 2)
        self.assertTrue(all(self.mgr.records[pkg_id]["commit"] == "a" * 40 for pkg_id in ids))

    def test_update_all_reports_partial_apply_failure(self):
        ids = self.bulk_pair()
        apply = self.mgr.apply_update
        def fail_second(pkg_id, reviewed=None):
            return {"ok": False, "error": "Validation failed"} if pkg_id == ids[1] else apply(pkg_id, reviewed)
        with patch.object(self.mgr, "apply_update", side_effect=fail_second):
            result = self.mgr.update_all()
        self.assertFalse(result["ok"])
        self.assertEqual(result["updated"], [ids[0]])
        self.assertEqual(result["errors"], [{"id": ids[1], "error": "Validation failed"}])
        self.assertEqual(result["settings"]["prepared_update_ids"], [ids[1]])

    def test_update_all_new_mod_and_conflicting_shortcut_require_agent(self):
        self.installed(active=True)
        self.content["one/mods/new/main.js"] = self.code
        self.content["one/keys.json"] = b'{"global":{"cmd-shift-x":"mod.open:new"}}'
        self.revision = "b" * 40
        self.update_tree()
        with patch.object(self.mgr, "copy_text", return_value=True):
            result = self.mgr.update_all()
        self.assertTrue(result["needs_agent"])
        self.assertEqual(result["updated"], [])
        self.assertIn("Mods or layouts were added or removed", result["prompt"])
        self.assertIn("Shortcut conflict", result["prompt"])
        self.assertFalse((self.home / "mods/new").exists())

    def test_update_all_preflights_competing_shortcuts_without_applying(self):
        ids = self.bulk_pair()
        keys = json.loads(self.content["one/keys.json"])
        keys["global"]["cmd-shift-z"] = "mod.open:one"
        self.content["one/keys.json"] = json.dumps(keys).encode()
        self.content["two/keys.json"] = b'{"global":{"cmd-shift-z":"layout.switch:two"}}'
        self.update_tree()
        with patch.object(self.mgr, "copy_text", return_value=True):
            result = self.mgr.update_all()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["updated"], [])
        self.assertEqual(result["pending"], list(ids))
        self.assertIn("Packages propose different shortcuts: global / cmd-shift-z", result["prompt"])
        self.assertIn("## " + ids[0], result["prompt"])
        self.assertTrue(all(self.mgr.records[pkg_id]["commit"] == "a" * 40 for pkg_id in ids))
        self.assertNotIn("cmd-shift-z", json.loads((self.home / "keys.json").read_text())["global"])

    def test_commit_identity_is_not_a_tree_hash_and_previews_reject_traversal(self):
        mgr = helper.PackageManager(self.temp.name)
        with patch.object(mgr, "_gh_api", side_effect=[{"sha": "commit-identity"}, {"sha": "tree-identity", "tree": []}]):
            self.assertEqual(mgr.branch_tree(self.repo, refresh=True)["HEAD"], "commit-identity")
        self.tree["one/mods/one/../../escape.js"] = helper.blob_sha(b"bad")
        with self.assertRaisesRegex(ValueError, "traversal"):
            self.mgr.review_install(self.repo, "one")


if __name__ == "__main__":
    unittest.main()
