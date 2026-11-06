"""The official gallery contract, with local installation evidence kept separate."""

import hashlib
import json
import os
import re
import subprocess
import struct
import tempfile
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser


def download(url, timeout=20):
    result = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", str(timeout), url],
        capture_output=True, timeout=timeout + 2,
    )
    if result.returncode:
        raise LookupError(f"Could not load {url}: {result.stderr.decode('utf-8', 'replace').strip()}")
    return result.stdout


def image_size(path):
    """Read dimensions of the official PNG/JPEG previews without an image dependency."""
    with open(path, "rb") as source:
        data = source.read()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 4 <= len(data):
            if data[offset] != 0xFF:
                break
            marker = data[offset + 1]
            length = int.from_bytes(data[offset + 2:offset + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2) and offset + 9 <= len(data):
                height, width = struct.unpack(">HH", data[offset + 5:offset + 9])
                return width, height
            if length < 2:
                break
            offset += 2 + length
    return None


class Examples(HTMLParser):
    def __init__(self, kind):
        super().__init__()
        self.kind = kind
        self.items = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if d.get("data-kind") != "example" or not d.get("data-gh"):
            return
        if d.get("data-type") and d["data-type"] != self.kind + "s":
            return
        source = urllib.parse.urlparse(d["data-gh"]).path.strip("/").split("/")
        if len(source) < 5 or source[2] != "tree":
            return
        self.items.append(normalize({
            "fullName": "/".join(source[:2]), "path": "/".join(source[4:]),
            "defaultBranch": source[3], "name": d["data-name"],
            "owner": d["data-owner"], "blurb": d.get("data-blurb", ""),
            "previewUrl": urllib.parse.urljoin("https://herdr.dev", d.get("data-pic", "")),
        }, self.kind, "example"))


def normalize(item, kind, collection="community"):
    repo, sub = item["fullName"], item.get("path", "").strip("/")
    branch = item.get("defaultBranch", "main")
    source = f"https://github.com/{repo}" + (f"/tree/{branch}/{sub}" if sub else "")
    preview = item.get("previewUrl", "")
    if collection == "community" and not preview.startswith("https://assets.herdr.dev/previews/"):
        preview = ""
    return {
        "id": f"{repo}/{sub}" if sub else repo, "repo": repo, "subdir": sub,
        "branch": branch, "commit": item.get("headCommit"), "name": item["name"],
        "author": item["owner"], "description": item.get("blurb", ""),
        "stars": item.get("stars", 0), "pushed": item.get("pushedAt", ""),
        "kind": kind, "collection": collection, "mods": item.get("modNames", []),
        "layouts": [os.path.basename(p)[:-5] for p in item.get("layoutFiles", [])],
        "preview_url": preview, "avatar_url": f"https://github.com/{urllib.parse.quote(item['owner'])}.png?size=64",
        "source_url": source,
        "install_prompt": f"Read ~/.config/herdr-app/AGENTS.md, then add this {kind}: {source}",
    }


def official_packages(manager):
    packages = []
    manager.catalog_errors = []
    def fetch_group(source):
        kind, plural, collection = source
        def community():
            index = json.loads(download(f"https://assets.herdr.dev/{plural}/index.json"))
            if not isinstance(index.get(plural), list):
                raise ValueError("Unexpected official catalog response")
            return [normalize(i, kind) for i in index[plural]]

        def examples():
            parser = Examples(kind)
            parser.feed(download(f"https://herdr.dev/{plural}/").decode("utf-8"))
            if not parser.items:
                return []
            return parser.items

        try:
            cache_version = "-v2" if collection == "examples" else ""
            return manager._cached(f"official-{plural}-{collection}{cache_version}.json", 3600,
                                   community if collection == "index" else examples)
        except Exception as exc:
            manager.catalog_errors.append(str(exc))
            return []

    sources = [(kind, plural, collection) for kind, plural in (("mod", "mods"), ("layout", "layouts"))
               for collection in ("index", "examples")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        fetched = dict(zip(sources, pool.map(fetch_group, sources)))
    for kind, plural in (("mod", "mods"), ("layout", "layouts")):
        groups = {collection: fetched[(kind, plural, collection)] for collection in ("index", "examples")}
        indexed = {p["id"]: p for p in groups.get("index", [])}
        packages.extend(p for p in indexed.values() if p["repo"] != "herdrdev/herdr-layout-examples")
        for example in groups.get("examples", []):
            identity = indexed.get(example["id"], {})
            example = dict(example)
            for key in ("mods", "layouts", "commit"):
                if key in identity:
                    example[key] = identity[key]
            packages.append(example)
    if not packages and not manager.cache_only:
        raise LookupError("; ".join(manager.catalog_errors))
    return packages


def local_state(manager, pkg):
    record = manager.records.get(pkg["id"], {})
    mods = record.get("mods") or pkg["mods"]
    layouts = record.get("layouts") or pkg["layouts"]
    tree = None
    # Layout indexes list layout files, not companion mod folders.
    if layouts and not mods and any(manager.local_files("layout", n) for n in layouts):
        try:
            tree = manager.branch_tree(pkg["repo"], pkg.get("commit") or pkg["branch"])
            prefix = pkg["subdir"] + "/" if pkg["subdir"] else ""
            mods = sorted({p[len(prefix):].split("/")[1] for p in tree
                           if p.startswith(prefix + "mods/") and len(p[len(prefix):].split("/")) > 2})
        except Exception as exc:
            return {"installed": None, "enabled": False, "has_update": False,
                    "collision": f"Could not verify local installation: {exc}"}
    units = [("mod", n) for n in mods] + [("layout", n) for n in layouts]
    units = [(k, n) for k, n in units if (n if k == "mod" else f"layout:{n}") not in manager.shipped]
    active = {f"mods/{n}/{p}" if k == "mod" else f"layouts/{p}": sha
              for k, n in units for p, sha in manager.local_files(k, n).items()}
    complete = bool(units) and all("main.js" in manager.local_files(k, n) if k == "mod"
                                  else bool(manager.local_files(k, n)) for k, n in units)
    store = os.path.join(manager.packages_dir, pkg["id"].replace("/", "-"))
    staged = bool(units) and all(os.path.isfile(os.path.join(store, "mods", n, "main.js"))
                                if k == "mod" else os.path.isfile(os.path.join(store, "layouts", n + ".json"))
                                for k, n in units)
    state = {"installed": False, "enabled": False, "has_update": False, "collision": None}
    # Older heuristic associations did not record package-relative baselines.
    # Revalidate them; they cannot grant ownership of similarly named files.
    trusted = record.get("installed") and (not record.get("associated") or record.get("association_version") == 2)
    if trusted:
        state.update(installed=bool(staged or complete), enabled=bool(complete),
                     has_update=bool((staged or complete) and record.get("has_update")))
        return state
    if not active:
        return state
    try:
        tree = tree or manager.branch_tree(pkg["repo"], pkg.get("commit") or pkg["branch"])
        prefix = pkg["subdir"] + "/" if pkg["subdir"] else ""
        expected = {}
        for path, sha in tree.items():
            if not path.startswith(prefix):
                continue
            rel = path[len(prefix):]
            if (re.match(r"mods/[^/]+/", rel) or re.fullmatch(r"layouts/[^/]+\.json", rel)) and not manager.ignored_file(rel):
                expected[rel] = sha
        if complete and expected and all(active.get(path) == sha for path, sha in expected.items()):
            manager.records[pkg["id"]] = {
                "id": pkg["id"], "repo": pkg["repo"], "subdir": pkg["subdir"],
                "commit": pkg.get("commit") or tree.get("HEAD", "unknown"),
                "mods": mods, "layouts": layouts, "files": expected,
                "installed": True, "enabled": True, "associated": True, "association_version": 2,
            }
            if manager.cache_only:
                manager.stale = True
            else:
                manager.associate(pkg["id"], manager.records[pkg["id"]], record)
            state.update(installed=True, enabled=True)
        else:
            state["collision"] = "Local mod folder or layout exists, but the complete package does not match this source. Local files are preserved."
    except Exception as exc:
        state.update(installed=None, collision=f"Could not verify local installation: {exc}")
    return state


def build_catalog(manager, query="", kind_filter=None, status_filter="all"):
    packages = []
    for pkg in official_packages(manager):
        if kind_filter and pkg["kind"] != kind_filter:
            continue
        pkg.update(local_state(manager, pkg))
        if status_filter == "installed" and pkg["installed"] is not True:
            continue
        if status_filter == "not_installed" and pkg["installed"] is not False:
            continue
        if query.lower() not in f"{pkg['name']} {pkg['author']} {pkg['description']}".lower():
            continue
        packages.append(pkg)
    return sorted(packages, key=lambda p: (p["installed"] is not True, -p["stars"], p["name"]))


def media(manager, ids):
    wanted = set(ids)
    # Browsing has already loaded the catalog; media must not refresh four feeds.
    previous = manager.cache_only
    manager.cache_only = True
    try:
        packages = [p for p in official_packages(manager) if p["id"] in wanted]
    finally:
        manager.cache_only = previous
    def fetch(pkg):
        result = {"id": pkg["id"]}
        for field in ("preview", "avatar"):
            url = pkg[field + "_url"]
            if not url:
                continue
            suffix = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".png"
            relative = f"data/mods-plus/cache/media/{hashlib.sha256(url.encode()).hexdigest()}{suffix}"
            path = os.path.join(manager.root, relative)
            try:
                if not os.path.isfile(path):
                    data = download(url, timeout=6)
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=os.path.dirname(path), delete=False) as out:
                        out.write(data)
                    os.replace(out.name, path)
                result[field + "_path"] = relative
                if field == "preview":
                    size = image_size(path)
                    if size:
                        result["preview_width"], result["preview_height"] = size
            except Exception:
                pass
        return result
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(fetch, packages))


def details(manager, pkg_id):
    pkg = next((p for p in build_catalog(manager) if p["id"] == pkg_id), None)
    if not pkg:
        raise LookupError("Package is no longer in the official catalog")
    prefix = pkg["subdir"] + "/" if pkg["subdir"] else ""
    recipe = manager.raw_content(pkg["repo"], pkg["branch"], prefix + "RECIPE.md").decode("utf-8", "replace")
    assets = media(manager, [pkg_id])
    if assets:
        pkg.update(assets[0])
    pkg.update(recipe=recipe, prompt=manager.generate_prompt(pkg_id, recipe)["text"])
    return pkg
