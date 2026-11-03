"""Catalog identity, source parity and installed-filter regressions."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "mods/mods-plus/helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
gallery = helper.gallery


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manager = helper.PackageManager(self.temp.name)
        self.pkg = gallery.normalize({
            "fullName": "alice/suite", "owner": "alice", "path": "tools/panel",
            "name": "Panel", "modNames": ["panel"], "headCommit": "revision",
            "previewUrl": "https://assets.herdr.dev/previews/image.png", "stars": 8,
        }, "mod")
        self.catalog = patch.object(gallery, "official_packages", side_effect=lambda _: [dict(self.pkg)])
        self.catalog.start()
        self.addCleanup(self.catalog.stop)
        self.tree = {"tools/panel/mods/panel/main.js": helper.blob_sha(b"original")}
        self.manager.branch_tree = lambda *_: self.tree

    def write(self, path, text):
        target = Path(self.temp.name) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def test_nested_package_and_extra_cache_files(self):
        self.write("mods/panel/main.js", "original")
        self.write("mods/panel/.cache/generated.png", "cached")
        self.write("mods/panel/NOTICE", "local attribution")
        result = self.manager.build_catalog(status_filter="installed")
        self.assertEqual([p["id"] for p in result], ["alice/suite/tools/panel"])
        self.assertEqual(self.manager.build_catalog(status_filter="not_installed"), [])
        record = self.manager.records[self.pkg["id"]]
        self.assertEqual(record["files"], {"mods/panel/main.js": helper.blob_sha(b"original")})
        self.assertNotIn(".cache/generated.png", record["files"])

    def test_same_name_and_partial_package_do_not_imply_installation(self):
        self.write("mods/panel/main.js", "different")
        result = self.manager.build_catalog()
        self.assertFalse(result[0]["installed"])
        self.assertTrue(result[0]["collision"])
        self.assertNotIn(self.pkg["id"], self.manager.records)
        self.write("mods/panel/main.js", "original")
        self.pkg["mods"].append("companion")
        self.tree["tools/panel/mods/companion/main.js"] = helper.blob_sha(b"companion")
        self.assertEqual(self.manager.build_catalog(status_filter="installed"), [])

    def test_record_is_not_installation_when_files_are_gone(self):
        self.manager.records[self.pkg["id"]] = {"installed": True, "mods": ["panel"]}
        self.assertFalse(self.manager.build_catalog()[0]["installed"])
        self.write("mods/panel/NOTICE", "leftover file")
        self.assertFalse(self.manager.build_catalog()[0]["installed"])
        self.write("data/mods-plus/packages/alice-suite-tools-panel/mods/panel/main.js", "original")
        pkg = self.manager.build_catalog()[0]
        self.assertTrue(pkg["installed"])
        self.assertFalse(pkg["enabled"])

    def test_verified_installation_survives_local_edit_and_offline_catalog(self):
        self.write("mods/panel/main.js", "original")
        self.manager.build_catalog()
        self.write("mods/panel/main.js", "local edit")
        self.manager.branch_tree = lambda *_: self.fail("Known ownership must not depend on network availability")
        self.assertTrue(self.manager.build_catalog()[0]["installed"])

    def test_network_failure_is_not_not_installed(self):
        self.write("mods/panel/main.js", "original")
        def unavailable(*_):
            raise LookupError("Offline")
        self.manager.branch_tree = unavailable
        self.assertIsNone(self.manager.build_catalog()[0]["installed"])
        self.assertEqual(self.manager.build_catalog(status_filter="not_installed"), [])
        self.assertEqual(self.manager.build_catalog(status_filter="installed"), [])

    def test_layout_companion_mods_are_checked(self):
        self.pkg.update(kind="layout", mods=[], layouts=["desk"])
        self.tree["tools/panel/layouts/desk.json"] = helper.blob_sha(b"{}")
        self.write("layouts/desk.json", "{}")
        self.assertFalse(self.manager.build_catalog()[0]["installed"])
        self.write("mods/panel/main.js", "original")
        self.assertTrue(self.manager.build_catalog()[0]["installed"])

    def test_official_examples_and_preview_policy(self):
        parser = gallery.Examples("layout")
        parser.feed('<div data-kind="example" data-name="Desk" data-owner="herdrdev" '
                    'data-gh="https://github.com/herdrdev/herdr-layout-examples/tree/main/desk" '
                    'data-pic="/live/layouts/desk.jpg"></div>')
        self.assertEqual(parser.items[0]["collection"], "example")
        self.assertEqual(parser.items[0]["subdir"], "desk")
        self.assertEqual(parser.items[0]["preview_url"], "https://herdr.dev/live/layouts/desk.jpg")
        unmoderated = gallery.normalize({"fullName": "a/b", "owner": "a", "name": "B",
                                        "previewUrl": "https://elsewhere/image.png"}, "mod")
        self.assertEqual(unmoderated["preview_url"], "")

    def test_expired_catalog_is_preserved_with_warning(self):
        path = Path(self.manager.cache_dir) / "official-mods-community.json"
        path.write_text(json.dumps([self.pkg]))
        os.utime(path, (0, 0))
        self.manager.catalog_errors = []
        def offline():
            raise LookupError("offline")
        self.assertEqual(self.manager._cached(path.name, 1, offline), [self.pkg])
        self.assertIn("Using cached catalog", self.manager.catalog_errors[0])

    def test_example_identity_comes_from_the_same_official_index(self):
        self.catalog.stop()
        item = {"fullName": "herdrdev/herdr-layout-examples", "owner": "herdrdev",
                "name": "Example", "path": "example", "modNames": ["example"],
                "headCommit": "example-revision"}
        html = ('<div data-kind="example" data-name="Example" data-owner="herdrdev" '
                'data-gh="https://github.com/herdrdev/herdr-layout-examples/tree/main/example" '
                'data-pic="/live/example.jpg"></div>').encode()
        def fetch(url):
            if url.endswith("index.json"):
                key = "layouts" if "/layouts/" in url else "mods"
                return json.dumps({key: [item]}).encode()
            return html
        with patch.object(gallery, "download", side_effect=fetch):
            packages = gallery.official_packages(self.manager)
        self.assertEqual(len(packages), 2)
        self.assertTrue(all(p["collection"] == "example" for p in packages))
        self.assertEqual(packages[0]["mods"], ["example"])
        self.assertEqual(packages[0]["commit"], "example-revision")

    def test_preview_dimensions(self):
        path = Path(self.temp.name) / "preview.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + gallery.struct.pack(">II", 1600, 1000))
        self.assertEqual(gallery.image_size(path), (1600, 1000))


if __name__ == "__main__":
    unittest.main()
