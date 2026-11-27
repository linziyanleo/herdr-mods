"""Catalog identity, source parity and installed-filter regressions."""

import importlib.util
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import call, patch

spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "mods/mods-plus/helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
gallery = helper.gallery


def example_html(*plurals):
    return "".join(
        f'<div data-kind="example" data-type="{plural}" data-name="Example" data-owner="herdrdev" '
        'data-gh="https://github.com/herdrdev/herdr-layout-examples/tree/main/example" '
        'data-pic="/live/example.jpg"></div>' for plural in plurals
    ).encode()


class CatalogTransportTests(unittest.TestCase):
    def setUp(self):
        self.payload = b'{"mods": []}'
        self.release = threading.Event()
        payload, release = gzip.compress(self.payload), self.release

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path == "/no-body":
                    release.wait(7)
                    return
                self.send_response(200)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                try:
                    for offset in range(0, len(payload), 4):
                        if self.path == "/stall":
                            self.wfile.write(payload[:-4])
                            release.wait(7)
                            return
                        self.wfile.write(payload[offset:offset + 4])
                        if release.wait(.25):
                            return
                except (BrokenPipeError, ConnectionResetError):
                    pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(self.release.set)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{server.server_port}"
        proxy = patch.dict(os.environ, {"no_proxy": "127.0.0.1"})
        proxy.start()
        self.addCleanup(proxy.stop)

    def test_progressing_gzip_transfer_survives_the_stall_window(self):
        with patch.object(gallery, "CATALOG_STALL_SECONDS", 1):
            self.assertEqual(gallery.download(self.url + "/slow"), self.payload)

    def test_stalled_and_progressing_transfers_have_separate_limits(self):
        with patch.object(gallery, "CATALOG_STALL_SECONDS", 1), \
                patch.object(gallery, "CATALOG_TRANSFER_TIMEOUT", 5):
            start = time.monotonic()
            with self.assertRaisesRegex(LookupError, "no download progress"):
                gallery.download(self.url + "/stall")
            self.assertLess(time.monotonic() - start, 5)
        with patch.object(gallery, "CATALOG_TRANSFER_TIMEOUT", 1):
            with self.assertRaisesRegex(LookupError, "timed out"):
                gallery.download(self.url + "/slow")

    def test_connected_endpoint_without_a_response_fails_quickly(self):
        with patch.object(gallery, "CATALOG_STALL_SECONDS", 1):
            with self.assertRaisesRegex(LookupError, "no download progress.*0 bytes received"):
                gallery.download(self.url + "/no-body")


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
        self.catalog = patch.object(gallery, "official_packages", side_effect=lambda _, **kwargs: [dict(self.pkg)])
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
        parser = gallery.Examples()
        parser.feed('<div data-kind="example" data-type="layouts" data-name="Desk" data-owner="herdrdev" '
                    'data-gh="https://github.com/herdrdev/herdr-layout-examples/tree/main/desk" '
                    'data-pic="/live/layouts/desk.jpg"></div>')
        example, = parser.items["layouts"]
        self.assertEqual(example["collection"], "example")
        self.assertEqual(example["subdir"], "desk")
        self.assertEqual(example["preview_url"], "https://herdr.dev/live/layouts/desk.jpg")
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
        html = example_html("mods", "layouts")
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
        self.assertEqual(packages[0]["preview_url"], "https://herdr.dev/live/example.jpg")

    def test_preview_dimensions(self):
        path = Path(self.temp.name) / "preview.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + gallery.struct.pack(">II", 1600, 1000))
        self.assertEqual(gallery.image_size(path), (1600, 1000))

    def test_mixed_examples_follow_card_type(self):
        parser = gallery.Examples()
        parser.feed(example_html("mods", "layouts").decode())
        for kind in ("mod", "layout"):
            self.assertEqual([p["kind"] for p in parser.items[kind + "s"]], [kind])

    def test_repository_preview_is_png(self):
        preview = Path(__file__).parents[1] / "preview.png"
        self.assertTrue(preview.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_three_catalog_sources_refresh_in_parallel_and_share_the_gallery(self):
        self.catalog.stop()
        barrier = threading.Barrier(3, timeout=3)

        def fetch(url):
            barrier.wait()
            if url.endswith("index.json"):
                plural = "layouts" if "/layouts/" in url else "mods"
                return json.dumps({plural: [{"fullName": "alice/suite", "owner": "alice", "name": "Suite"}]}).encode()
            return example_html("mods", "layouts")

        with patch.object(gallery, "download", side_effect=fetch) as request:
            self.assertEqual(len(gallery.official_packages(self.manager)), 4)
            self.assertEqual(request.call_count, 3)
            self.assertEqual(request.call_args_list.count(call(gallery.EXAMPLES_URL)), 1)
        self.assertEqual(self.manager.catalog_errors, [])

    def test_manual_refresh_replaces_fresh_catalog_and_retains_it_when_offline(self):
        self.catalog.stop()
        mods = [{"fullName": "alice/old", "owner": "alice", "name": "Old"}]

        def fetch(url):
            if url == gallery.EXAMPLES_URL:
                return example_html("mods", "layouts")
            if url.endswith("/mods/index.json"):
                return json.dumps({"mods": mods}).encode()
            return b'{"layouts": []}'

        def community_names(packages):
            return sorted(p["name"] for p in packages if p["collection"] == "community")

        with patch.object(gallery, "download", side_effect=fetch) as request:
            self.assertEqual(community_names(self.manager.build_catalog()), ["Old"])
            mods.append({"fullName": "alice/new", "owner": "alice", "name": "New"})
            self.assertEqual(community_names(self.manager.build_catalog()), ["Old"])
            self.assertEqual(request.call_count, 3)
            self.assertEqual(community_names(self.manager.build_catalog(refresh=True)), ["New", "Old"])
            self.assertEqual(request.call_count, 6)

        cache = Path(self.manager.cache_dir) / "official-mods-index.json"
        snapshot = cache.read_bytes(), cache.stat().st_mtime_ns
        with patch.object(gallery, "download", side_effect=self.offline):
            self.assertEqual(community_names(self.manager.build_catalog(refresh=True)), ["New", "Old"])
        self.assertTrue(self.manager.stale)
        self.assertTrue(any("Using cached catalog" in warning for warning in self.manager.catalog_errors))
        self.assertEqual((cache.read_bytes(), cache.stat().st_mtime_ns), snapshot)

    def test_cold_offline_warns_once_per_request_without_claiming_cache_use(self):
        self.catalog.stop()
        with patch.object(gallery, "download", side_effect=self.offline) as fetch:
            self.assertEqual(self.manager.build_catalog(), [])
        self.assertEqual(fetch.call_count, 3)
        self.assertTrue(self.manager.stale)
        self.assertEqual(len(self.manager.catalog_errors), 3)
        self.assertTrue(all(warning.startswith("Offline: https://") for warning in self.manager.catalog_errors))
        self.assertEqual(list(Path(self.manager.cache_dir).glob("official-*.json")), [])

    def test_invalid_index_refresh_preserves_bytes_and_timestamp(self):
        self.catalog.stop()
        path = Path(self.manager.cache_dir) / "official-mods-index.json"
        path.write_text(json.dumps([self.pkg]))
        os.utime(path, (1, 1))
        initial = path.read_bytes(), path.stat().st_mtime_ns
        for body in (b'{"mods": [', b'{"modCount": 1, "mods": []}'):
            with self.subTest(body=body):
                def fetch(url):
                    if url.endswith("/mods/index.json"):
                        return body
                    return b'{"layouts": []}' if url.endswith("index.json") else example_html("mods", "layouts")
                with patch.object(gallery, "download", side_effect=fetch):
                    packages = self.manager.build_catalog()
                self.assertIn(self.pkg["id"], [pkg["id"] for pkg in packages])
                self.assertTrue(self.manager.stale)
                self.assertEqual(len(self.manager.catalog_errors), 1)
                self.assertIn("Using cached catalog: Invalid official index", self.manager.catalog_errors[0])
                self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), initial)

    def test_examples_fall_back_to_index_and_preserve_existing_per_kind_caches(self):
        self.catalog.stop()
        path = Path(self.manager.cache_dir) / "official-mods-examples-v2.json"
        cached = dict(self.pkg, collection="example", preview_url="https://herdr.dev/example.jpg")
        path.write_text(json.dumps([cached]))
        os.utime(path, (1, 1))
        item = {"fullName": gallery.EXAMPLES_REPO, "owner": "herdrdev", "name": "Example",
                "path": "example", "layoutFiles": ["layouts/example.json"], "headCommit": "layout-revision"}

        def fetch(url):
            if url == gallery.EXAMPLES_URL:
                return b"<html></html>"
            return b'{"mods": []}' if url.endswith("/mods/index.json") else json.dumps({"layouts": [item]}).encode()

        with patch.object(gallery, "download", side_effect=fetch) as request:
            mod, layout = gallery.official_packages(self.manager)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(mod, cached)
        self.assertEqual((layout["collection"], layout["layouts"], layout["commit"]),
                         ("example", ["example"], "layout-revision"))
        self.assertIn("Using cached catalog: No mods examples", "\n".join(self.manager.catalog_errors))
        self.assertIn("No layouts examples", "\n".join(self.manager.catalog_errors))
        self.assertEqual(json.loads(path.read_text()), [cached])

    @staticmethod
    def offline(url):
        raise LookupError(f"Offline: {url}")

    def test_browsing_during_mutation_does_not_overwrite_records(self):
        self.write("mods/panel/main.js", "original")
        with helper.file_lock(self.manager.lock_file):
            pkg = self.manager.build_catalog()[0]
            self.assertIsNone(pkg["installed"])
            self.assertIn("Ownership has not been recorded", pkg["collision"])
            self.assertFalse(Path(self.manager.records_file).exists())
        fresh = helper.PackageManager(self.temp.name)
        fresh.branch_tree = self.manager.branch_tree
        self.assertTrue(fresh.build_catalog()[0]["installed"])
        saved = json.loads(Path(fresh.records_file).read_text())
        self.assertTrue(saved[self.pkg["id"]]["associated"])

    def test_catalog_cli_reads_while_package_lock_is_held(self):
        for plural in ("mods", "layouts"):
            for collection in ("index", "examples-v2"):
                path = Path(self.manager.cache_dir) / f"official-{plural}-{collection}.json"
                path.write_text(json.dumps([self.pkg] if (plural, collection) == ("mods", "index") else []))
        with helper.file_lock(self.manager.lock_file):
            result = subprocess.run([sys.executable, "-B", str(Path(helper.__file__)),
                                     "--app-home", self.temp.name, "--json", "catalog"],
                                    capture_output=True, text=True, timeout=3, check=True)
        self.assertEqual(json.loads(result.stdout)["count"], 1)

    def test_empty_cache_cli_does_not_create_app_data(self):
        root = Path(self.temp.name) / "empty-home"
        result = subprocess.run([sys.executable, "-B", str(Path(helper.__file__)),
                                 "--app-home", str(root), "--json", "catalog", "--cached"],
                                capture_output=True, text=True, timeout=3, check=True)
        data = json.loads(result.stdout)
        self.assertEqual(data["packages"], [])
        self.assertTrue(data["stale"])
        self.assertFalse(root.exists())

    def test_association_preserves_a_concurrent_record_change(self):
        changed = {"installed": True, "files": {"local": "new"}}
        Path(self.manager.records_file).write_text(json.dumps({self.pkg["id"]: changed}))
        self.write("mods/panel/main.js", "original")
        self.manager.build_catalog()
        self.assertEqual(json.loads(Path(self.manager.records_file).read_text())[self.pkg["id"]], changed)

    def test_ambiguous_sources_cannot_be_associated_by_search_or_details(self):
        second = dict(self.pkg, id="bob/suite/tools/panel", repo="bob/suite", name="Other")
        with patch.object(gallery, "official_packages", side_effect=lambda _, **kwargs: [dict(self.pkg), dict(second)]):
            self.write("mods/panel/main.js", "original")
            result = self.manager.build_catalog(query="Other")
            self.assertIsNone(result[0]["installed"])
            self.assertIn("multiple catalog sources", result[0]["collision"])
            with patch.object(self.manager, "raw_content", return_value=b"Recipe"), patch.object(gallery, "media", return_value=[]):
                details = self.manager.get_details(self.pkg["id"])
            self.assertIsNone(details["installed"])
            self.assertEqual(self.manager.records, {})
            self.assertFalse(Path(self.manager.records_file).exists())

    def test_incomplete_catalog_cannot_promote_a_cached_match(self):
        self.write("mods/panel/main.js", "original")
        self.manager.catalog_errors = ["offline"]
        self.assertIsNone(self.manager.build_catalog()[0]["installed"])
        self.assertEqual(self.manager.records, {})

    def test_failed_catalog_refresh_does_not_start_uncached_ownership_lookups(self):
        self.catalog.stop()
        self.write("mods/panel/main.js", "original")
        cache = Path(self.manager.cache_dir) / "official-mods-index.json"
        cache.write_text(json.dumps([self.pkg]))
        os.utime(cache, (1, 1))
        del self.manager.branch_tree
        with patch.object(gallery, "download", side_effect=self.offline), \
                patch.object(self.manager, "_gh_api") as github:
            pkg, = self.manager.build_catalog()
        self.assertIsNone(pkg["installed"])
        self.assertEqual(self.manager.records, {})
        github.assert_not_called()
        self.assertFalse(self.manager.cache_only)

    def test_details_for_a_cached_layout_do_not_restart_metadata_refresh(self):
        self.catalog.stop()
        pkg = dict(self.pkg, kind="layout", mods=[], layouts=["panel"])
        cache = Path(self.manager.cache_dir) / "official-layouts-index.json"
        cache.write_text(json.dumps([pkg]))
        os.utime(cache, (1, 1))
        with patch.object(gallery, "download", side_effect=AssertionError("Unexpected metadata request")) as fetch, \
                patch.object(gallery, "media", return_value=[]), \
                patch.object(self.manager, "active_layout_name", return_value="main"), \
                patch.object(self.manager, "raw_content", return_value=b"# Layout recipe"):
            details = self.manager.get_details(pkg["id"])
        self.assertEqual(details["recipe"], "# Layout recipe")
        self.assertEqual(details["layouts"], ["panel"])
        fetch.assert_not_called()

    def test_installed_snapshot_distinguishes_builtin_unknown_and_cached_matches(self):
        self.catalog.stop()
        other = dict(self.pkg, id="bob/suite/tools/panel", repo="bob/suite", name="Other")
        for plural in ("mods", "layouts"):
            for collection in ("index", "examples-v2"):
                cache = Path(self.manager.cache_dir) / f"official-{plural}-{collection}.json"
                cache.write_text(json.dumps([self.pkg, other] if (plural, collection) == ("mods", "index") else []))
                os.utime(cache, (1, 1))
        self.manager.shipped = {"built-in"}
        for name in ("built-in", "loose-clone", "panel"):
            self.write(f"mods/{name}/main.js", "original")
        self.manager.cache_only = True
        with patch.object(gallery, "download", side_effect=AssertionError("Unexpected network access")) as fetch:
            result = gallery.installed_packages(self.manager)
        rows = {row["name"]: row for row in result["packages"]}
        self.assertEqual(result["cache"], "stale")
        self.assertEqual(result["count"], 2)
        self.assertEqual(rows["built-in"]["provenance"], "built-in")
        self.assertEqual(rows["loose-clone"]["provenance"], "unknown")
        self.assertEqual(rows["panel"]["provenance"], "ambiguous")
        self.assertEqual({source["repo"] for source in rows["panel"]["matches"]}, {"alice/suite", "bob/suite"})
        self.assertEqual(self.manager.records, {})
        fetch.assert_not_called()

    def test_cached_catalog_and_media_do_not_refresh_network_metadata(self):
        self.catalog.stop()
        path = Path(self.manager.cache_dir) / "official-mods-index.json"
        path.write_text(json.dumps([self.pkg]))
        os.utime(path, (0, 0))
        self.manager.cache_only = True
        with patch.object(gallery, "download", side_effect=AssertionError("Unexpected network refresh")) as fetch:
            self.assertEqual(self.manager.build_catalog()[0]["id"], self.pkg["id"])
            self.assertTrue(self.manager.stale)
            fetch.assert_not_called()
        self.manager.cache_only = False
        with patch.object(gallery, "download", side_effect=OSError("image unavailable")) as fetch:
            result = gallery.media(self.manager, [self.pkg["id"]])
        self.assertEqual(result, [{"id": self.pkg["id"], "preview_error": "image unavailable", "avatar_error": "image unavailable"}])
        self.assertEqual(fetch.call_count, 2)
        self.assertTrue(all(call.kwargs == {"timeout": 6} for call in fetch.call_args_list))
        self.assertFalse(self.manager.cache_only)

    def test_shared_media_urls_download_once_per_batch_and_warm_cache_downloads_nothing(self):
        packages = [dict(self.pkg, id=f"alice/suite/{i}", avatar_url="https://assets.herdr.dev/shared.png") for i in range(4)]
        with patch.object(gallery, "available_packages", return_value=packages), \
                patch.object(gallery, "download", return_value=b"fixture image") as fetch:
            first = gallery.media(self.manager, [p["id"] for p in packages])
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(len({p["avatar_path"] for p in first}), 1)
            self.assertEqual(len({p["preview_path"] for p in first}), 1)
            self.assertEqual(gallery.media(self.manager, [p["id"] for p in packages]), first)
            self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
