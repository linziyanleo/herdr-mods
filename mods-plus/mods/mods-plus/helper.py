#!/usr/bin/env python3
"""Local package helper for Mods Plus.

Provides catalog browsing, installation, activation, prompt generation,
protected removal, update checking and preparation, 3-way merge protection,
and settings management for Herdr mods and layouts.
"""

import argparse

# Also supports loading the helper by absolute path from tests.
import contextlib
import difflib
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog as gallery

HERDR_APP = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
SKIP_DIRS = {"__pycache__", "node_modules", ".git"}
GENERATED = {"jsconfig.json", "runtime.json"}
DAY = 24 * 3600


def ignored(rel):
    parts = rel.split("/")
    return parts[-1] in GENERATED or parts[-1].endswith(".d.ts") or any(p in SKIP_DIRS for p in parts[:-1])


def blob_sha(data: bytes) -> str:
    """The git blob hash of some bytes (what `git hash-object` prints)."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def short_sha(sha: str) -> str:
    return sha[:7] if sha else "?"


def rmtree(path):
    def retry(func, p, _exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass
    if os.path.lexists(path):
        shutil.rmtree(path, onerror=retry)


@contextlib.contextmanager
def file_lock(lock_path: str, timeout: float = 10.0):
    """File lock to coordinate background checks and dialog actions."""
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    f = open(lock_path, "w")
    start = time.time()
    locked = False
    try:
        while time.time() - start < timeout:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
                break
            except (BlockingIOError, OSError):
                time.sleep(0.1)
        if not locked:
            # Continue even if lock timed out to avoid blocking UI operations
            pass
        yield
    finally:
        if locked:
            try:
                fcntl.flock(f, fcntl.LOCK_UN)
            except OSError:
                pass
        f.close()


class PackageManager:
    ignored_file = staticmethod(ignored)

    def __init__(self, root: str = HERDR_APP):
        self.root = os.path.abspath(root)
        self.data_dir = os.path.join(self.root, "data", "mods-plus")
        self.cache_dir = os.path.join(self.data_dir, "cache")
        self.stage_dir = os.path.join(self.data_dir, "stage")
        self.packages_dir = os.path.join(self.data_dir, "packages")
        self.updates_dir = os.path.join(self.data_dir, "updates")
        self.backups_dir = os.path.join(self.data_dir, "backups")
        self.lock_file = os.path.join(self.data_dir, ".lock")
        self.records_file = os.path.join(self.data_dir, "packages.json")
        self.settings_file = os.path.join(self.data_dir, "settings.json")

        for d in (self.data_dir, self.cache_dir, self.stage_dir, self.packages_dir, self.updates_dir, self.backups_dir):
            os.makedirs(d, exist_ok=True)

        self.shipped = self._load_shipped()
        self.records = self._load_records()
        self.settings = self._load_settings()

    def _load_shipped(self):
        installed_path = os.path.join(self.root, "installed.json")
        try:
            with open(installed_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data.keys())
        except (OSError, ValueError):
            return set()

    def _load_records(self):
        try:
            with open(self.records_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_records(self):
        temp = self.records_file + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(self.records, f, indent=2)
        os.replace(temp, self.records_file)

    def _load_settings(self):
        defaults = {
            "auto_update": False,
            "interval_hours": 24,
            "default_agent": None,
            "last_check": None,
        }
        try:
            with open(self.settings_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
                defaults.update(saved)
        except (OSError, ValueError):
            pass
        return defaults

    def _save_settings(self):
        temp = self.settings_file + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(self.settings, f, indent=2)
        os.replace(temp, self.settings_file)

    # -------------------------------- File and layout inspections --------------------------------

    def local_files(self, kind: str, name: str) -> dict:
        """{relative path: blob sha} of an installed mod folder or layout file."""
        if kind == "layout":
            path = os.path.join(self.root, "layouts", f"{name}.json")
            if os.path.isfile(path):
                try:
                    with open(path, "rb") as f:
                        return {f"{name}.json": blob_sha(f.read())}
                except OSError:
                    return {}
            return {}
        path = os.path.join(self.root, "mods", name)
        out = {}
        if not os.path.isdir(path):
            return out
        for dirpath, dirs, names in os.walk(path):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for n in sorted(names):
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, path).replace(os.sep, "/")
                if not ignored(rel) and os.path.isfile(full):
                    try:
                        with open(full, "rb") as f:
                            out[rel] = blob_sha(f.read())
                    except OSError:
                        pass
        return out

    def inspect_layout_references(self, mod_name: str) -> list:
        """Finds all layouts referencing `mod_name`."""
        layouts_dir = os.path.join(self.root, "layouts")
        referencing = []
        if not os.path.isdir(layouts_dir):
            return referencing

        def check_node(node):
            if isinstance(node, dict):
                content = node.get("content")
                if isinstance(content, dict) and content.get("mod") == mod_name:
                    return True
                for child in node.get("children", []):
                    if check_node(child):
                        return True
            return False

        for f in sorted(os.listdir(layouts_dir)):
            if f.endswith(".json"):
                layout_name = f[:-5]
                try:
                    with open(os.path.join(layouts_dir, f), "r", encoding="utf-8") as fp:
                        data = json.load(fp)
                        if check_node(data):
                            referencing.append(layout_name)
                except (OSError, ValueError):
                    pass
        return referencing

    def active_layout_name(self) -> str:
        try:
            out = subprocess.run(["herdr-app", "status"], capture_output=True, text=True, timeout=2)
            if out.returncode == 0:
                data = json.loads(out.stdout)
                return data.get("layout", "main")
        except Exception:
            pass
        return "main"

    # -------------------------------- Catalog & GitHub access --------------------------------

    def _gh_api(self, path: str):
        """Talks to GitHub through `gh api` or urllib.request."""
        if shutil.which("gh"):
            try:
                proc = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=10)
                if proc.returncode == 0:
                    return json.loads(proc.stdout)
            except Exception:
                pass

        url = f"https://api.github.com/{path.lstrip('/')}"
        token = os.environ.get("GITHUB_TOKEN")
        req = urllib.request.Request(url, headers={
            "User-Agent": "Herdr-Mods-Plus",
            "Accept": "application/vnd.github.v3+json",
            **({"Authorization": f"token {token}"} if token else {})
        })
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise LookupError(f"GitHub API error for {path}: {e}")

    def _cached(self, filename: str, max_age: float, fetcher):
        path = os.path.join(self.cache_dir, filename)
        if os.path.isfile(path) and time.time() - os.path.getmtime(path) < max_age:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                pass
        # Fallback to pkg cache if available
        pkg_cache = os.path.join(self.root, "data", "pkg", "cache", filename)
        if not os.path.isfile(path) and os.path.isfile(pkg_cache):
            try:
                with open(pkg_cache, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    with open(path, "w", encoding="utf-8") as out:
                        json.dump(data, out)
                    return data
            except (OSError, ValueError):
                pass

        try:
            data = fetcher()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return data
        except Exception as e:
            if filename.startswith("official-"):
                self.catalog_errors.append(f"Using cached catalog: {e}")
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            raise e

    def branch_tree(self, repo: str, branch: str = "HEAD"):
        def fetch():
            t = self._gh_api(f"repos/{repo}/git/trees/{urllib.parse.quote(branch, safe='')}?recursive=1")
            return {e["path"]: e["sha"] for e in t.get("tree", []) if e.get("type") == "blob"}
        slug = repo.replace("/", "-")
        return self._cached(f"tree-{slug}-{hashlib.sha256(branch.encode()).hexdigest()[:12]}.json", DAY, fetch)

    def blob_bytes(self, repo: str, sha: str) -> bytes:
        cache_path = os.path.join(self.cache_dir, "blobs", sha[:2], sha)
        if os.path.isfile(cache_path):
            with open(cache_path, "rb") as f:
                return f.read()
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        r = self._gh_api(f"repos/{repo}/git/blobs/{sha}")
        import base64
        content = base64.b64decode(r["content"])
        with open(cache_path, "wb") as f:
            f.write(content)
        return content

    # -------------------------------- Catalog & Association --------------------------------

    def build_catalog(self, query="", kind_filter=None, status_filter="all"):
        return gallery.build_catalog(self, query, kind_filter, status_filter)

    def raw_content(self, repo: str, branch: str, path: str) -> bytes:
        """Fetches raw file content directly, cached on disk."""
        slug = f"{repo.replace('/', '-')}-{branch}-{path.replace('/', '-')}"
        cache_path = os.path.join(self.cache_dir, "raw", slug)
        if os.path.isfile(cache_path):
            try:
                with open(cache_path, "rb") as f:
                    return f.read()
            except OSError:
                pass
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        # Try raw.githubusercontent.com first
        url = f"https://raw.githubusercontent.com/{repo}/{branch}/{path}"
        req = urllib.request.Request(url, headers={"User-Agent": "Herdr-Mods-Plus"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = resp.read()
                with open(cache_path, "wb") as f:
                    f.write(data)
                return data
        except Exception:
            pass
        return b""

    def get_details(self, pkg_id):
        return gallery.details(self, pkg_id)

    # -------------------------------- Install & Activation --------------------------------

    def install(self, repo: str, subdir: str = "", ref: str = None) -> dict:
        """Stages files, validates with `herdr-app check`, saves to packages_dir, marks Installed."""
        pkg_id = f"{repo}/{subdir}" if subdir else repo
        slug = pkg_id.replace("/", "-")
        target_stage = os.path.join(self.stage_dir, slug)
        rmtree(target_stage)
        os.makedirs(target_stage, exist_ok=True)

        # 1. Resolve tree and blobs
        target_ref = ref or "HEAD"
        tree = self.branch_tree(repo, target_ref)
        sub_prefix = (subdir + "/") if subdir else ""

        # Check for matching mods and layouts
        mods_paths = {}
        layouts_paths = {}
        for path, sha in tree.items():
            if sub_prefix and not path.startswith(sub_prefix):
                continue
            rel = path[len(sub_prefix):]
            m = re.match(r"mods/([^/]+)/", rel)
            if m:
                mods_paths.setdefault(m.group(1), {})[rel] = sha
            m = re.fullmatch(r"layouts/([^/]+)\.json", rel)
            if m:
                layouts_paths[m.group(1)] = (rel, sha)

        if not mods_paths and not layouts_paths:
            rmtree(target_stage)
            return {"ok": False, "error": f"No mods or layouts found in {pkg_id}"}

        # 2. Check conflict with existing unmanaged active files
        for mod_name in mods_paths:
            if mod_name in self.shipped:
                rmtree(target_stage)
                return {"ok": False, "error": f"Cannot install: '{mod_name}' is a built-in Herdr mod."}
            active_path = os.path.join(self.root, "mods", mod_name)
            if os.path.exists(active_path) and not self.records.get(pkg_id, {}).get("installed"):
                rmtree(target_stage)
                return {"ok": False, "error": f"Conflict: a local mod '{mod_name}' already exists. Preserving local files."}

        for layout_name in layouts_paths:
            if f"layout:{layout_name}" in self.shipped:
                rmtree(target_stage)
                return {"ok": False, "error": f"Cannot install: '{layout_name}' is a built-in Herdr layout."}
            active_path = os.path.join(self.root, "layouts", f"{layout_name}.json")
            if os.path.exists(active_path) and not self.records.get(pkg_id, {}).get("installed"):
                rmtree(target_stage)
                return {"ok": False, "error": f"Conflict: a local layout '{layout_name}.json' already exists. Preserving local layout."}

        # 3. Stage all package files
        file_hashes = {}
        for path, sha in tree.items():
            if path == "HEAD":
                continue
            if sub_prefix and not path.startswith(sub_prefix):
                continue
            rel = path[len(sub_prefix):]
            if ignored(rel):
                continue
            dest_file = os.path.join(target_stage, rel)
            os.makedirs(os.path.dirname(dest_file), exist_ok=True)
            data = self.blob_bytes(repo, sha)
            with open(dest_file, "wb") as f:
                f.write(data)
            file_hashes[rel] = sha

        # 4. Run `herdr-app check` for runtime mods in stage
        for mod_name in mods_paths:
            staged_mod_dir = os.path.join(target_stage, "mods", mod_name)
            check_proc = subprocess.run(["herdr-app", "check", staged_mod_dir], capture_output=True, text=True)
            if check_proc.returncode != 0:
                rmtree(target_stage)
                err_msg = (check_proc.stderr or check_proc.stdout).strip() or "herdr-app check failed"
                return {"ok": False, "error": f"Validation check failed for mod '{mod_name}': {err_msg}"}

        # 5. Move staged package to permanent package store (NOT active mods/layouts yet!)
        target_store = os.path.join(self.packages_dir, slug)
        rmtree(target_store)
        shutil.copytree(target_stage, target_store)
        rmtree(target_stage)

        # 6. Record installation (installed=True, enabled=False)
        self.records[pkg_id] = {
            "id": pkg_id,
            "repo": repo,
            "subdir": subdir,
            "commit": tree.get("HEAD", ref or "latest"),
            "ref": ref or "main",
            "files": file_hashes,
            "mods": list(mods_paths.keys()),
            "layouts": list(layouts_paths.keys()),
            "installed": True,
            "enabled": False,
            "at": time.strftime("%Y-%m-%d"),
        }
        self._save_records()

        return {
            "ok": True,
            "id": pkg_id,
            "mods": list(mods_paths.keys()),
            "layouts": list(layouts_paths.keys()),
            "message": "Installed successfully. Use Enable or Use layout to activate.",
        }

    def enable(self, pkg_id: str) -> dict:
        """Copies runtime mods from package store into active `mods/` directory."""
        record = self.records.get(pkg_id)
        if not record or not record.get("installed"):
            return {"ok": False, "error": f"Package '{pkg_id}' is not installed."}

        slug = pkg_id.replace("/", "-")
        pkg_store = os.path.join(self.packages_dir, slug)
        mods_dir = os.path.join(pkg_store, "mods")

        copied = []
        if os.path.isdir(mods_dir):
            for m in os.listdir(mods_dir):
                src = os.path.join(mods_dir, m)
                dst = os.path.join(self.root, "mods", m)
                if os.path.isdir(src):
                    # Keep backup if existed
                    if os.path.exists(dst):
                        self._backup_item("mod", m, pkg_id)
                    rmtree(dst)
                    shutil.copytree(src, dst)
                    copied.append(m)

        record["enabled"] = True
        self._save_records()
        return {"ok": True, "enabled_mods": copied, "message": f"Enabled mods: {', '.join(copied) if copied else 'None'}"}

    def use_layout(self, pkg_id: str) -> dict:
        """Copies layout into `layouts/`, copies companion mods, and updates record."""
        record = self.records.get(pkg_id)
        if not record or not record.get("installed"):
            return {"ok": False, "error": f"Package '{pkg_id}' is not installed."}

        slug = pkg_id.replace("/", "-")
        pkg_store = os.path.join(self.packages_dir, slug)
        layouts_dir = os.path.join(pkg_store, "layouts")

        # Copy companion mods first
        self.enable(pkg_id)

        target_layout = None
        if os.path.isdir(layouts_dir):
            for l in os.listdir(layouts_dir):
                if l.endswith(".json"):
                    src = os.path.join(layouts_dir, l)
                    dst = os.path.join(self.root, "layouts", l)
                    shutil.copyfile(src, dst)
                    target_layout = l[:-5]
                    break

        record["enabled"] = True
        self._save_records()

        # Switch layout
        if target_layout:
            try:
                subprocess.run(["herdr-app", "do", "layout.switch", "--name", target_layout], capture_output=True, timeout=3)
            except Exception:
                pass

        return {"ok": True, "layout": target_layout, "message": f"Switched to layout {target_layout}"}

    # -------------------------------- Removal & References Protection --------------------------------

    def remove(self, pkg_id: str, force: bool = False) -> dict:
        """Removes package files while verifying layout references across all layouts."""
        record = self.records.get(pkg_id)
        if not record:
            return {"ok": False, "error": f"Package '{pkg_id}' is not recorded as installed."}

        mods = record.get("mods", [])
        layouts = record.get("layouts", [])

        if not mods and not layouts:
            return {"ok": False, "error": "Package ownership is incomplete. Refresh the catalog before removing it."}

        # 1. Inspect all local layouts for references to the package's mods
        if not force:
            for mod_name in mods:
                referencing = self.inspect_layout_references(mod_name)
                if referencing:
                    cleanup_prompt = (
                        f"The mod '{mod_name}' is still in use by layout(s): {', '.join(referencing)}.\n"
                        f"To safely deactivate, remove or replace the '{mod_name}' block in those layouts before deleting the package files."
                    )
                    return {
                        "ok": False,
                        "error": f"Cannot remove: layout '{referencing[0]}' still references mod '{mod_name}'.",
                        "referencing_layouts": referencing,
                        "cleanup_prompt": cleanup_prompt,
                    }

        # 2. Retain mods that another package or layout still uses
        other_used_mods = set()
        for other_id, other_rec in self.records.items():
            if other_id != pkg_id and other_rec.get("installed"):
                other_used_mods.update(other_rec.get("mods", []))

        # 3. Create recoverable backup
        backup_stamp = time.strftime("%Y%m%d-%H%M%S")
        backup_dir = os.path.join(self.backups_dir, f"{pkg_id.replace('/', '-')}-{backup_stamp}")
        os.makedirs(backup_dir, exist_ok=True)

        for mod_name in mods:
            if mod_name not in other_used_mods:
                p = os.path.join(self.root, "mods", mod_name)
                if os.path.isdir(p):
                    shutil.copytree(p, os.path.join(backup_dir, "mods", mod_name))
                    rmtree(p)

        for layout_name in layouts:
            p = os.path.join(self.root, "layouts", f"{layout_name}.json")
            if os.path.isfile(p):
                os.makedirs(os.path.join(backup_dir, "layouts"), exist_ok=True)
                shutil.copyfile(p, os.path.join(backup_dir, "layouts", f"{layout_name}.json"))
                os.remove(p)

        # Remove stored package
        slug = pkg_id.replace("/", "-")
        pkg_store = os.path.join(self.packages_dir, slug)
        rmtree(pkg_store)
        rmtree(os.path.join(self.updates_dir, slug))

        del self.records[pkg_id]
        self._save_records()

        return {"ok": True, "message": f"Removed package '{pkg_id}'. Backup saved to {backup_dir}."}

    def _backup_item(self, kind: str, name: str, pkg_id: str):
        backup_stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(self.backups_dir, f"{pkg_id.replace('/', '-')}-{backup_stamp}", kind, name)
        src = os.path.join(self.root, "mods" if kind == "mod" else "layouts", f"{name}.json" if kind == "layout" else name)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.isdir(src):
                shutil.copytree(src, dest)
            else:
                shutil.copyfile(src, dest)

    # -------------------------------- Activation Prompt Generation --------------------------------

    def generate_prompt(self, pkg_id: str, recipe_content: str = None) -> dict:
        """Generates comprehensive activation prompt text for LLM/agent."""
        record = self.records.get(pkg_id, {})
        parts = pkg_id.split("/")
        repo = "/".join(parts[:2])
        subdir = "/".join(parts[2:]) if len(parts) > 2 else ""

        if recipe_content is None:
            local_recipe = os.path.join(self.packages_dir, pkg_id.replace("/", "-"), "RECIPE.md")
            if os.path.isfile(local_recipe):
                try:
                    with open(local_recipe, "r", encoding="utf-8") as f:
                        recipe_content = f.read()
                except OSError:
                    recipe_content = ""

        current_layout = self.active_layout_name()
        mods = record.get("mods")
        if not mods:
            try:
                pkg = next(p for p in gallery.official_packages(self) if p["id"] == pkg_id)
                mods = pkg["mods"]
            except Exception:
                mods = []
        if not mods:
            mods = [subdir.split("/")[-1] or repo.split("/")[-1]]

        installed_paths = [os.path.join(self.root, "mods", m) for m in mods]

        prompt_text = f"""You are activating the Herdr package '{pkg_id}' in the user's Herdr desktop app.

Package Details:
- Source: https://github.com/{repo}{('/tree/main/' + subdir) if subdir else ''}
- Installed Mod Paths: {', '.join(installed_paths)}
- Target App Home: {self.root}
- Current Active Layout: {current_layout} (file: {self.root}/layouts/{current_layout}.json)

Package Recipe (RECIPE.md):
{recipe_content or '(No RECIPE.md provided. Check the package structure to integrate the mod into the layout)'}

Instructions:
1. Follow the integration instructions in the recipe above.
2. If modifying '{current_layout}.json', preserve all existing surrounding nodes, sizes, visibility, and key bindings.
3. Keep changes minimal and isolated. Do not modify bundled Herdr layouts or mods directly.
4. Verify the mod by running:
   herdr-app check {installed_paths[0]}
5. Confirm the window renders without errors:
   herdr-app status
"""
        return {"text": prompt_text, "package_id": pkg_id, "current_layout": current_layout}

    # -------------------------------- Updates & 3-Way Merge --------------------------------

    def check_updates(self) -> dict:
        """Checks upstream for newer commits, stages and verifies candidate updates."""
        candidates = []
        now = time.time()
        self.settings["last_check"] = now
        self._save_settings()

        for pkg_id, record in list(self.records.items()):
            if not record.get("installed"):
                continue
            repo = record.get("repo")
            subdir = record.get("subdir", "")
            current_commit = record.get("commit")
            branch = record.get("ref", "main")

            try:
                tree = self.branch_tree(repo, branch)
                latest_commit = tree.get("HEAD", "unknown")
            except Exception:
                continue

            sub_prefix = (subdir + "/") if subdir else ""
            has_diff = False

            # Check if upstream tree shas for package files differ
            for rel, local_sha in record.get("files", {}).items():
                remote_path = sub_prefix + rel
                if remote_path in tree and tree[remote_path] != local_sha:
                    has_diff = True
                    break

            if not has_diff:
                record["has_update"] = False
                continue

            # Stage update candidate
            slug = pkg_id.replace("/", "-")
            cand_dir = os.path.join(self.updates_dir, slug, "candidate")
            rmtree(cand_dir)
            os.makedirs(cand_dir, exist_ok=True)

            cand_hashes = {}
            for path, sha in tree.items():
                if path == "HEAD":
                    continue
                if sub_prefix and not path.startswith(sub_prefix):
                    continue
                rel = path[len(sub_prefix):]
                if ignored(rel):
                    continue
                data = self.blob_bytes(repo, sha)
                dest_file = os.path.join(cand_dir, rel)
                os.makedirs(os.path.dirname(dest_file), exist_ok=True)
                with open(dest_file, "wb") as f:
                    f.write(data)
                cand_hashes[rel] = sha

            # Check candidate runtime mods with `herdr-app check`
            valid = True
            for mod_name in record.get("mods", []):
                staged_mod = os.path.join(cand_dir, "mods", mod_name)
                if os.path.isdir(staged_mod):
                    chk = subprocess.run(["herdr-app", "check", staged_mod], capture_output=True, text=True)
                    if chk.returncode != 0:
                        valid = False
                        break

            if not valid:
                rmtree(cand_dir)
                continue

            # 3-Way Merge check: compare baseline, local active files, and candidate
            conflicts = []
            locally_modified = []
            for mod_name in record.get("mods", []):
                local_files = self.local_files("mod", mod_name)
                baseline = record.get("files", {})
                for rel, curr_sha in local_files.items():
                    base_sha = baseline.get(f"mods/{mod_name}/{rel}")
                    if base_sha and curr_sha != base_sha:
                        locally_modified.append(f"mods/{mod_name}/{rel}")
                        cand_sha = cand_hashes.get(f"mods/{mod_name}/{rel}")
                        if cand_sha and cand_sha != curr_sha:
                            # Both modified: try 3-way merge on text files
                            merged = self._three_way_merge(
                                os.path.join(self.root, "mods", mod_name, rel),
                                base_sha,
                                cand_sha,
                                repo
                            )
                            if not merged:
                                conflicts.append(f"mods/{mod_name}/{rel}")

            record["has_update"] = True
            cand_meta = {
                "id": pkg_id,
                "latest_commit": latest_commit,
                "cand_hashes": cand_hashes,
                "conflicts": conflicts,
                "locally_modified": locally_modified,
                "prepared_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            with open(os.path.join(self.updates_dir, slug, "meta.json"), "w", encoding="utf-8") as f:
                json.dump(cand_meta, f, indent=2)

            candidates.append({
                "id": pkg_id,
                "latest_commit": short_sha(latest_commit),
                "conflicts": conflicts,
                "locally_modified": locally_modified,
            })

        self._save_records()
        return {"ok": True, "candidates": candidates, "count": len(candidates)}

    def _three_way_merge(self, local_path: str, base_sha: str, cand_sha: str, repo: str) -> bool:
        """Attempts diff3 merge, preserving local modifications without conflicts."""
        try:
            with open(local_path, "rb") as f:
                local_bytes = f.read()
            base_bytes = self.blob_bytes(repo, base_sha)
            cand_bytes = self.blob_bytes(repo, cand_sha)

            with tempfile.NamedTemporaryFile("wb", delete=False) as f_local, \
                 tempfile.NamedTemporaryFile("wb", delete=False) as f_base, \
                 tempfile.NamedTemporaryFile("wb", delete=False) as f_cand:
                f_local.write(local_bytes)
                f_base.write(base_bytes)
                f_cand.write(cand_bytes)
                local_name, base_name, cand_name = f_local.name, f_base.name, f_cand.name

            proc = subprocess.run(["diff3", "-m", local_name, base_name, cand_name], capture_output=True)
            for p in (local_name, base_name, cand_name):
                try:
                    os.remove(p)
                except OSError:
                    pass
            return proc.returncode == 0
        except Exception:
            return False

    def apply_update(self, pkg_id: str) -> dict:
        """Applies verified staged candidate update, preserving local edits."""
        record = self.records.get(pkg_id)
        if not record:
            return {"ok": False, "error": f"Package '{pkg_id}' not found."}

        slug = pkg_id.replace("/", "-")
        meta_path = os.path.join(self.updates_dir, slug, "meta.json")
        cand_dir = os.path.join(self.updates_dir, slug, "candidate")
        if not os.path.isfile(meta_path) or not os.path.isdir(cand_dir):
            return {"ok": False, "error": "No prepared update found for this package."}

        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        if meta.get("conflicts"):
            return {"ok": False, "error": f"Cannot apply update: conflicts in {', '.join(meta['conflicts'])}. Local files left intact."}

        # Backup current files before applying
        self._backup_item("package", slug, pkg_id)

        # Apply to package store
        target_store = os.path.join(self.packages_dir, slug)
        os.makedirs(target_store, exist_ok=True)
        shutil.copytree(cand_dir, target_store, dirs_exist_ok=True)

        # If mod was enabled in active mods/, update active files as well
        if record.get("enabled"):
            for mod_name in record.get("mods", []):
                src = os.path.join(cand_dir, "mods", mod_name)
                dst = os.path.join(self.root, "mods", mod_name)
                if os.path.isdir(src):
                    shutil.copytree(src, dst, dirs_exist_ok=True)

        # Update record
        record["commit"] = meta["latest_commit"]
        record["files"] = meta["cand_hashes"]
        record["has_update"] = False
        self._save_records()

        # Clean up update candidate
        rmtree(os.path.join(self.updates_dir, slug))

        return {"ok": True, "message": f"Updated package '{pkg_id}' to revision {short_sha(meta['latest_commit'])}"}

    # -------------------------------- Settings & Overdue --------------------------------

    def get_settings(self) -> dict:
        now = time.time()
        last = self.settings.get("last_check")
        interval_secs = self.settings.get("interval_hours", 24) * 3600
        overdue = bool(self.settings.get("auto_update") and (last is None or (now - last) >= interval_secs))

        # Check prepared updates
        prepared_count = len([d for d in os.listdir(self.updates_dir) if os.path.isdir(os.path.join(self.updates_dir, d))])

        return {
            **self.settings,
            "overdue": overdue,
            "prepared_updates_count": prepared_count,
        }

    def update_settings(self, **kwargs) -> dict:
        for k, v in kwargs.items():
            if k in self.settings:
                self.settings[k] = v
        self._save_settings()
        return self.get_settings()


def main():
    parser = argparse.ArgumentParser(description="Mods Plus local package manager helper.")
    parser.add_argument("--app-home", default=HERDR_APP, help="Path to Herdr app configuration directory")
    parser.add_argument("--json", action="store_true", help="Format output as JSON")

    sub = parser.add_subparsers(dest="command")

    # catalog
    p_catalog = sub.add_parser("catalog")
    p_catalog.add_argument("--query", "-q", default="")
    p_catalog.add_argument("--kind", choices=["mod", "layout"])
    p_catalog.add_argument("--filter", choices=["all", "installed", "not_installed"], default="all")

    p_media = sub.add_parser("media")
    p_media.add_argument("ids", help="JSON array of package IDs")

    # details
    p_details = sub.add_parser("details")
    p_details.add_argument("id")

    # install
    p_install = sub.add_parser("install")
    p_install.add_argument("repo")
    p_install.add_argument("subdir", nargs="?", default="")
    p_install.add_argument("--ref")

    # enable
    p_enable = sub.add_parser("enable")
    p_enable.add_argument("id")

    # use-layout
    p_layout = sub.add_parser("use-layout")
    p_layout.add_argument("id")

    # prompt
    p_prompt = sub.add_parser("prompt")
    p_prompt.add_argument("id")

    # copy-prompt
    p_copyprompt = sub.add_parser("copy-prompt")
    p_copyprompt.add_argument("id")
    p_copyprompt.add_argument("--catalog", action="store_true")

    # remove
    p_remove = sub.add_parser("remove")
    p_remove.add_argument("id")
    p_remove.add_argument("--force", action="store_true")

    # check-updates
    sub.add_parser("check-updates")

    # apply-update
    p_apply = sub.add_parser("apply-update")
    p_apply.add_argument("id")

    # settings
    p_settings = sub.add_parser("settings")
    p_settings.add_argument("--auto-update", type=lambda x: (str(x).lower() == 'true'))
    p_settings.add_argument("--interval", type=int)
    p_settings.add_argument("--agent")

    args = parser.parse_args()
    mgr = PackageManager(args.app_home)

    with file_lock(mgr.lock_file):
        result = None
        if args.command == "catalog":
            pkgs = mgr.build_catalog(query=args.query, kind_filter=args.kind, status_filter=args.filter)
            result = {"packages": pkgs, "count": len(pkgs), "warnings": getattr(mgr, "catalog_errors", [])}
        elif args.command == "media":
            result = {"media": gallery.media(mgr, json.loads(args.ids))}
        elif args.command == "details":
            result = mgr.get_details(args.id)
        elif args.command == "install":
            result = mgr.install(args.repo, args.subdir, ref=args.ref)
        elif args.command == "enable":
            result = mgr.enable(args.id)
        elif args.command == "use-layout":
            result = mgr.use_layout(args.id)
        elif args.command == "prompt":
            result = mgr.generate_prompt(args.id)
        elif args.command == "copy-prompt":
            if args.catalog:
                pkg = next(p for p in gallery.official_packages(mgr) if p["id"] == args.id)
                p = {"text": pkg["install_prompt"]}
            else:
                p = mgr.generate_prompt(args.id)
            # Copy to clipboard
            text = p["text"]
            copied = False
            for cmd in (["pbcopy"], ["xclip", "-selection", "clipboard"], ["wl-copy"], ["clip"]):
                if shutil.which(cmd[0]):
                    try:
                        subprocess.run(cmd, input=text.encode("utf-8"), check=True)
                        copied = True
                        break
                    except Exception:
                        pass
            result = {"ok": copied, "message": "Copied to clipboard" if copied else "Failed to copy"}
        elif args.command == "remove":
            result = mgr.remove(args.id, force=args.force)
        elif args.command == "check-updates":
            result = mgr.check_updates()
        elif args.command == "apply-update":
            result = mgr.apply_update(args.id)
        elif args.command == "settings":
            updates = {}
            if args.auto_update is not None:
                updates["auto_update"] = args.auto_update
            if args.interval is not None:
                updates["interval_hours"] = args.interval
            if args.agent is not None:
                updates["default_agent"] = args.agent
            result = mgr.update_settings(**updates) if updates else mgr.get_settings()
        else:
            parser.print_help()
            sys.exit(1)

        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
