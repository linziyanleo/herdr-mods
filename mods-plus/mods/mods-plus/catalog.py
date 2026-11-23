"""The official gallery contract, with local installation evidence kept separate."""

import hashlib
import json
import os
import re
import subprocess
import struct
import tempfile
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path

import review


CATALOG_TRANSFER_TIMEOUT = 180
CATALOG_CONNECT_TIMEOUT = 5
CATALOG_STALL_SECONDS = 8
EXAMPLES_URL = "https://herdr.dev/gallery/"
EXAMPLES_REPO = "herdrdev/herdr-layout-examples"
KINDS = ("mod", "layout")


def download(url, timeout=None):
    options = ["curl", "--fail", "--silent", "--show-error", "--location"]
    if timeout is None:
        result = metadata_transfer(url, options + ["--compressed", "--no-buffer",
                                   "--connect-timeout", str(CATALOG_CONNECT_TIMEOUT),
                                   "--max-time", str(CATALOG_TRANSFER_TIMEOUT), url])
    else:
        result = subprocess.run(options + ["--max-time", str(timeout), url],
                                capture_output=True, timeout=timeout + 2)
    if result.returncode:
        raise LookupError(f"Could not load {url}: {result.stderr.decode('utf-8', 'replace').strip()}")
    return result.stdout


def metadata_transfer(url, args):
    # Watch actual body growth so a fast start cannot mask a subsequent stall.
    with tempfile.TemporaryFile() as body, tempfile.TemporaryFile() as errors, \
            subprocess.Popen(args, stdout=body, stderr=errors) as curl:
        size = 0
        last_progress = time.monotonic()
        deadline = last_progress + CATALOG_TRANSFER_TIMEOUT + 2
        try:
            while True:
                try:
                    curl.wait(timeout=0.25)
                    break
                except subprocess.TimeoutExpired:
                    pass
                now = time.monotonic()
                received = os.fstat(body.fileno()).st_size
                if received > size:
                    size, last_progress = received, now
                if now >= deadline:
                    raise LookupError(f"Could not load {url}: curl exceeded its {CATALOG_TRANSFER_TIMEOUT}-second transfer limit")
                if now - last_progress >= CATALOG_STALL_SECONDS:
                    raise LookupError(f"Could not load {url}: no download progress for {CATALOG_STALL_SECONDS} seconds ({size} bytes received)")
        finally:
            if curl.poll() is None:
                curl.kill()
        body.seek(0)
        errors.seek(0)
        return subprocess.CompletedProcess(args, curl.returncode, body.read(), errors.read())


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
    def __init__(self):
        super().__init__()
        self.items = {kind + "s": [] for kind in KINDS}

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        plural = d.get("data-type")
        if d.get("data-kind") != "example" or plural not in self.items or not d.get("data-gh"):
            return
        source = urllib.parse.urlparse(d["data-gh"]).path.strip("/").split("/")
        if len(source) < 5 or source[2] != "tree":
            return
        self.items[plural].append(normalize({
            "fullName": "/".join(source[:2]), "path": "/".join(source[4:]),
            "defaultBranch": source[3], "name": d["data-name"],
            "owner": d["data-owner"], "blurb": d.get("data-blurb", ""),
            "previewUrl": urllib.parse.urljoin("https://herdr.dev", d.get("data-pic", "")),
        }, plural[:-1], "example"))


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
    manager.catalog_errors = []

    def cached(name, fetch):
        try:
            return manager._cached(f"official-{name}.json", 3600, fetch)
        except Exception as exc:
            manager.stale = True
            manager.catalog_errors.append(str(exc))
            return []

    def fetch_index(kind):
        plural = kind + "s"
        url = f"https://assets.herdr.dev/{plural}/index.json"

        def load():
            body = download(url)
            try:
                index = json.loads(body)
                items = index[plural]
                if not isinstance(items, list) or index.get(kind + "Count", len(items)) != len(items):
                    raise ValueError("Unexpected package list or count")
                return [normalize(item, kind) for item in items]
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                raise ValueError(f"Invalid official index at {url}: {exc}") from exc

        return cached(f"{plural}-index", load)

    def fetch_examples():
        # Both existing per-kind caches can share one fetch, including a failed attempt.
        @lru_cache(maxsize=1)
        def load():
            try:
                parser = Examples()
                parser.feed(download(EXAMPLES_URL).decode("utf-8"))
                parser.close()
                return parser.items, None
            except Exception as exc:
                return {}, exc

        def for_kind(kind):
            plural = kind + "s"

            def entries():
                items, error = load()
                if error is not None:
                    raise error
                if not items[plural]:
                    raise ValueError(f"No {plural} examples found at {EXAMPLES_URL}")
                return items[plural]

            return cached(f"{plural}-examples-v2", entries)

        return {kind: for_kind(kind) for kind in KINDS}

    with ThreadPoolExecutor(max_workers=3) as pool:
        indexes = {kind: pool.submit(fetch_index, kind) for kind in KINDS}
        examples = pool.submit(fetch_examples).result()
    manager.catalog_errors = list(dict.fromkeys(manager.catalog_errors))
    packages = []
    for kind in KINDS:
        indexed = {p["id"]: p for p in indexes[kind].result()}
        packages.extend(p for p in indexed.values() if p["repo"] != EXAMPLES_REPO)
        # The indexes also carry the current example repository. Keep it
        # browsable on a cold start even if the gallery page cannot load.
        examples_for_kind = examples[kind] or [
            dict(p, collection="example") for p in indexed.values() if p["repo"] == EXAMPLES_REPO
        ]
        for example in examples_for_kind:
            identity = indexed.get(example["id"], {})
            example = dict(example)
            for key in ("mods", "layouts", "commit"):
                if key in identity:
                    example[key] = identity[key]
            packages.append(example)
    return packages


def units_of(package):
    return {(kind, name) for kind in ("mod", "layout") for name in package.get(kind + "s", [])}


def recorded(record):
    return record.get("installed") and (not record.get("associated") or record.get("association_version") == 2)


def active_units(manager, record):
    mods = {("mod", name) for name in record.get("mods", [])} if record.get("enabled") else set()
    return mods | {("layout", name) for name in manager._active_layouts(record)}


def local_state(manager, pkg, local_files=None):
    local_files = local_files or manager.local_files
    record = manager.records.get(pkg["id"], {})
    mods = record.get("mods") or pkg["mods"]
    layouts = record.get("layouts") or pkg["layouts"]
    tree = None
    # Layout indexes list layout files, not companion mod folders.
    if not recorded(record) and layouts and not mods and any(local_files("layout", n) for n in layouts):
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
              for k, n in units for p, sha in local_files(k, n).items()}
    complete = bool(units) and all("main.js" in local_files(k, n) if k == "mod"
                                  else bool(local_files(k, n)) for k, n in units)
    store = os.path.join(manager.packages_dir, pkg["id"].replace("/", "-"))
    staged = bool(units) and all(os.path.isfile(os.path.join(store, "mods", n, "main.js"))
                                if k == "mod" else os.path.isfile(os.path.join(store, "layouts", n + ".json"))
                                for k, n in units)
    state = {"installed": False, "enabled": False, "has_update": False, "collision": None}
    # Older heuristic associations did not record package-relative baselines.
    # Revalidate them; they cannot grant ownership of similarly named files.
    if recorded(record):
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
            state["match"] = {
                "id": pkg["id"], "repo": pkg["repo"], "subdir": pkg["subdir"],
                "commit": pkg.get("commit") or tree.get("HEAD", "unknown"),
                "ref": pkg["branch"], "source": dict(pkg),
                "mods": mods, "layouts": layouts, "files": expected,
                "active_layouts": list(layouts),
                "installed": True, "enabled": True, "associated": True, "association_version": 2,
            }
            state.update(installed=None, collision="Local files match this source. Ownership has not been recorded.")
        else:
            state["collision"] = "Local mod folder or layout exists, but the complete package does not match this source. Local files are preserved."
    except Exception as exc:
        state.update(installed=None, collision=f"Could not verify local installation: {exc}")
    return state


def build_catalog(manager, query="", kind_filter=None, status_filter="all"):
    local_files = lru_cache(maxsize=None)(manager.local_files)
    packages = available_packages(manager)
    cache_only = manager.cache_only
    # Incomplete feeds cannot establish new ownership. Avoid serial GitHub
    # lookups after a gallery failure and use whatever file evidence is cached.
    manager.cache_only = cache_only or bool(getattr(manager, "catalog_errors", []))
    try:
        inspected = [(pkg, local_state(manager, pkg, local_files)) for pkg in packages]
    finally:
        manager.cache_only = cache_only
    matches = {}
    claimed = set().union(*(units_of(rec) for rec in manager.records.values() if recorded(rec)))
    incomplete = any(state["installed"] is None and "match" not in state for _pkg, state in inspected)
    for _pkg, state in inspected:
        if "match" in state:
            match = state["match"]
            for unit in units_of(match):
                matches.setdefault(unit, set()).add((match["id"], match["ref"]))
    proposals = {}
    for _pkg, state in inspected:
        if "match" not in state:
            continue
        match = state["match"]
        units = units_of(match)
        if any(len(matches[unit]) > 1 for unit in units):
            state["collision"] = "Local files match multiple catalog sources. Ownership has not been recorded."
        elif not units & claimed:
            proposals[match["id"]] = match
    confirmed = set()
    if proposals:
        if manager.cache_only:
            manager.stale = True  # Let the ordinary catalog refresh evaluate fresh source coverage.
        elif not incomplete and not manager.stale and not getattr(manager, "catalog_errors", []):
            confirmed = manager.associate(proposals)

    packages = []
    for pkg, state in inspected:
        if kind_filter and pkg["kind"] != kind_filter:
            continue
        if state.pop("match", None) and pkg["id"] in confirmed:
            state.update(installed=True, enabled=True, collision=None)
        pkg.update(state)
        if status_filter == "installed" and pkg["installed"] is not True:
            continue
        if status_filter == "not_installed" and pkg["installed"] is not False:
            continue
        if query.lower() not in f"{pkg['name']} {pkg['author']} {pkg['description']}".lower():
            continue
        packages.append(pkg)
    return sorted(packages, key=lambda p: (p["installed"] is not True, -p["stars"], p["name"]))


def available_packages(manager):
    try:
        packages = official_packages(manager)
    except Exception as exc:
        manager.catalog_errors = [str(exc)]
        packages = []
    ids = {p["id"] for p in packages}
    for pkg_id, record in manager.records.items():
        if record.get("installed") and record.get("source") and pkg_id not in ids:
            pkg = dict(record["source"])
            pkg.update(commit=record.get("commit"), mods=record["mods"], layouts=record["layouts"])
            packages.append(pkg)
    return packages


def source_evidence(package):
    return {key: package.get(key) for key in ("repo", "subdir", "branch", "commit")}


def installed_packages(manager):
    """One local snapshot. Cached matches are evidence only and never become records here."""
    root = Path(manager.root)
    present = {("mod", p.parent.name) for p in root.glob("mods/*/main.js") if p.is_file()}
    present.update(("layout", p.stem) for p in root.glob("layouts/*.json") if p.is_file())
    shipped = {(kind, name) for kind, name in present
               if (name if kind == "mod" else f"layout:{name}") in manager.shipped}
    records = {pkg_id: record for pkg_id, record in manager.records.items() if recorded(record)}
    owned = set().union(*(active_units(manager, record) for record in records.values()))
    loose = present - owned - shipped
    local_files = lru_cache(maxsize=None)(manager.local_files)
    matches = {}
    incomplete = False
    for pkg in available_packages(manager):
        if not units_of(pkg) & loose:
            continue
        state = local_state(manager, pkg, local_files)
        if match := state.get("match"):
            evidence = source_evidence({**match, "branch": match["ref"]})
            for unit in units_of(match) & loose:
                matches.setdefault(unit, {})[(pkg["id"], match["ref"])] = evidence
        elif state["installed"] is None:
            incomplete = True

    last_check = manager.settings.get("last_check_results") or {}
    rows = [installed_record(manager, pkg_id, rec, last_check) for pkg_id, rec in records.items()]
    for kind, name in sorted(loose | shipped):
        builtin = (kind, name) in shipped
        evidence = list(matches.get((kind, name), {}).values())
        provenance = "built-in" if builtin else "ambiguous" if len(evidence) > 1 else "match" if evidence else "unknown"
        rows.append({"id": f"local:{kind}:{name}", "name": name, "kind": kind, "activation": "active",
                     "provenance": provenance, "matches": evidence, "attention": not builtin})
    rows.sort(key=lambda row: (not row["attention"], not row.get("recorded"), row["name"].casefold(), row["id"]))
    cache = "incomplete" if incomplete or getattr(manager, "catalog_errors", []) else "stale" if manager.stale else "cached"
    return {"packages": rows, "cache": cache, "count": sum(row["attention"] for row in rows)}


def installed_record(manager, pkg_id, record, last_check):
    source = record.get("source") or {}
    active = active_units(manager, record)
    baseline = record.get("files") or {}
    expected = {p: sha for p, sha in baseline.items() if any(
        p.startswith(f"mods/{name}/") if kind == "mod" else p == f"layouts/{name}.json" for kind, name in active)}
    issues, drift = [], []
    try:
        snapshot = review.local_snapshot(manager, {"files": expected}, {})
        actual = {path: sha for path, sha in snapshot.items() if sha is not None}
        drift = [entry for entry in review.changes(expected, actual) if entry["status"] != "unchanged"]
    except (OSError, ValueError) as error:
        issues.append(f"Active files could not be inspected: {error}")

    def entry_path(kind, name):
        return f"mods/{name}/main.js" if kind == "mod" else f"layouts/{name}.json"

    store = Path(manager.packages_dir) / pkg_id.replace("/", "-")
    stored = any((store / entry_path(kind, name)).is_file() for kind, name in units_of(record))
    if baseline and (stored or not record.get("associated")):
        try:
            manager._verify_files(store, baseline)
        except (OSError, ValueError):
            issues.append("Stored files differ from the recorded package")
    elif not baseline:
        issues.append("File baseline unavailable")
    activation_conflicts = manager._name_conflicts(pkg_id,
        [name for name in record.get("mods", []) if ("mod", name) not in active],
        [name for name in record.get("layouts", []) if ("layout", name) not in active])

    managed_keys = record.get("owned_keys") or {}
    if managed_keys:
        try:
            keys = review.read_keys(os.path.join(manager.root, "keys.json"))
            for section, bindings in managed_keys.items():
                for key, original in bindings.items():
                    current = keys.get(section, {}).get(key)
                    if current != original:
                        drift.append({"path": f"Shortcut {section} / {key}", "status": "remove" if current is None else "change"})
        except (OSError, ValueError):
            issues.append("Managed shortcuts could not be read")

    candidate = None
    if record.get("has_update"):
        try:
            meta, _ = manager._candidate(pkg_id)
            commit = meta["latest_commit"]
            conflicts = meta.get("conflicts", [])
            if meta["id"] != pkg_id or not isinstance(commit, str) or not commit or not isinstance(conflicts, list):
                raise ValueError("Unrecognized prepared update")
            candidate = {"commit": commit, "conflicts": conflicts}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            issues.append("Prepared update cache unavailable or changed")
    report = last_check.get("packages", {}).get(pkg_id)
    check = {"state": "unknown"}
    if report and report["baseline"] == manager.check_baseline(record):
        check = {"state": report["state"], "error": report.get("error"), "at": last_check["at"]}
        if check["state"] == "prepared" and not record.get("has_update"):
            issues.append("Prepared update cache unavailable or changed")
    repo, commit = record.get("repo"), record.get("commit")
    provenance = "match-record" if record.get("associated") else "recorded" if repo else "unknown"
    active_entry = any((Path(manager.root) / entry_path(kind, name)).is_file() for kind, name in active)
    activation = "active" if active_entry else "stored" if stored else "missing"
    compare = None
    if (provenance == "recorded" and candidate and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", repo)
            and repo.split("/", 1)[1] not in (".", "..")
            and all(re.fullmatch(r"[0-9a-fA-F]{40}", rev or "") for rev in (commit, candidate["commit"]))
            and commit != candidate["commit"]):
        compare = f"https://github.com/{repo}/compare/{commit}...{candidate['commit']}"
    return {"id": pkg_id, "name": source.get("name") or pkg_id, "kind": source.get("kind") or
            ("layout" if record.get("layouts") else "mod"), "activation": activation, "recorded": True,
            "enabled": bool(record.get("enabled")),
            "provenance": provenance, "source": source_evidence({**record, "branch": record.get("ref")}),
            "candidate": candidate, "compare": compare, "drift": drift, "issues": issues,
            "activation_conflicts": activation_conflicts, "check": check,
            "managed_layouts": sorted(name for kind, name in active if kind == "layout"),
            "managed_keys": [f"{section} / {key}" for section, bindings in managed_keys.items() for key in bindings],
            "attention": bool(candidate or drift or issues or activation_conflicts or check["state"] != "unchanged" or
                              provenance != "recorded" or activation == "missing")}


def installed_details(manager, pkg_id):
    record = manager.records.get(pkg_id, {})
    if not recorded(record):
        raise LookupError("Installed record is no longer available")
    source = record.get("source") or {}
    folder = Path(manager.packages_dir) / pkg_id.replace("/", "-")
    recipe_file = folder / "RECIPE.md"
    recipe = recipe_file.read_text(encoding="utf-8") if recipe_file.is_file() else source.get("recipe")
    row = installed_record(manager, pkg_id, record, manager.settings.get("last_check_results") or {})
    return {**source, "recipe": recipe, "inventory": row}


def media(manager, ids, progress=None):
    wanted = set(ids)
    # Browsing has already loaded the catalog; media must not refresh four feeds.
    previous = manager.cache_only
    manager.cache_only = True
    try:
        packages = [p for p in available_packages(manager) if p["id"] in wanted]
    finally:
        manager.cache_only = previous
    resources = {}
    results = {pkg["id"]: {"id": pkg["id"], **{field + "_pending": True for field in ("preview", "avatar") if pkg[field + "_url"]}} for pkg in packages}
    for pkg in packages:
        for field in ("preview", "avatar"):
            if pkg[field + "_url"]:
                resources.setdefault(pkg[field + "_url"], []).append((pkg["id"], field))

    def fetch(url):
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
            return url, {"path": relative, "size": image_size(path)}
        except Exception as error:
            return url, {"error": str(error)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = [pool.submit(fetch, url) for url in resources]
        for future in as_completed(pending):
            url, asset = future.result()
            for pkg_id, field in resources[url]:
                result = results[pkg_id]
                result.pop(field + "_pending")
                if "error" in asset:
                    result[field + "_error"] = asset["error"]
                else:
                    result[field + "_path"] = asset["path"]
                    if field == "preview" and asset["size"]:
                        result["preview_width"], result["preview_height"] = asset["size"]
            if progress:
                progress([dict(item) for item in results.values()])
    return list(results.values())


def details(manager, pkg_id):
    record = manager.records.get(pkg_id, {})
    cache_only = manager.cache_only
    manager.cache_only = True
    try:
        pkg = next((p for p in available_packages(manager) if p["id"] == pkg_id), None)
    finally:
        manager.cache_only = cache_only
    if not pkg and not cache_only:
        pkg = next((p for p in available_packages(manager) if p["id"] == pkg_id), None)
    if not pkg:
        pkg = next((p for p in manager.discover(pkg_id)["packages"] if p["id"] == pkg_id), None)
    if not pkg:
        raise LookupError("No package found at this repository folder")
    state = local_state(manager, pkg)
    state.pop("match", None)
    pkg.update(state)
    prefix = pkg["subdir"] + "/" if pkg["subdir"] else ""
    stored_recipe = os.path.join(manager.packages_dir, pkg_id.replace("/", "-"), "RECIPE.md")
    if record.get("installed") and os.path.isfile(stored_recipe):
        with open(stored_recipe, encoding="utf-8") as f:
            recipe = f.read()
    else:
        recipe = pkg.get("recipe") or manager.raw_content(pkg["repo"], pkg["branch"], prefix + "RECIPE.md").decode("utf-8", "replace")
    assets = media(manager, [pkg_id]) if pkg.get("collection") != "direct" else []
    if assets:
        pkg.update(assets[0])
    pkg.update(recipe=recipe, prompt=manager.generate_prompt(pkg_id, recipe, source=pkg)["text"])
    return pkg
