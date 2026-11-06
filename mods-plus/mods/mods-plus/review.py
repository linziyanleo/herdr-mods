"""Read-only source discovery and concrete package reviews. No downloaded code runs here."""

import hashlib
import json
import os
import re
import urllib.parse


def safe_path(path):
    if not isinstance(path, str) or not path or "\\" in path or any(ord(c) < 32 for c in path):
        raise ValueError("Invalid package path")
    if any(p in ("", ".", "..") for p in path.split("/")) or ":" in path:
        raise ValueError("Absolute paths and path traversal are not supported")
    return path


def parse_source(value):
    value = value.strip()
    if value.startswith("github.com/"):
        value = "https://" + value
    is_url = "://" in value
    if is_url:
        url = urllib.parse.urlsplit(value)
        if url.scheme != "https" or url.netloc.lower() != "github.com":
            raise ValueError("Use an HTTPS github.com URL or owner/repo[/folder]")
        if url.query or url.fragment:
            raise ValueError("Query strings and fragments are not supported")
        value = url.path[1:].rstrip("/")
    # Ref syntax, encoded separators and escaped traversal must never become paths.
    if any(c in value for c in "%?#@"):
        raise ValueError("Encoded paths and explicit refs are not supported; use the default branch")
    safe_path(value)
    parts = value.split("/")
    if len(parts) < 2 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", parts[0]):
        raise ValueError("Enter owner/repo or owner/repo/folder")
    parts[1] = re.sub(r"\.git$", "", parts[1])
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", parts[1]) or parts[1] in (".", ".."):
        raise ValueError("Invalid GitHub repository name")
    tail = parts[2:]
    tree_ref = None
    if is_url and tail:
        if tail[0] != "tree" or len(tail) < 2:
            raise ValueError("Use a repository URL or /tree/<default-branch>/folder URL")
        tree_ref, tail = tail[1], tail[2:]
    return "/".join(parts[:2]), "/".join(tail), tree_ref


def source(manager, value):
    repo, subdir, tree_ref = parse_source(value)
    info = manager._gh_api(f"repos/{repo}")
    if info.get("private") or info.get("visibility", "public") != "public":
        raise ValueError("Only public GitHub repositories are supported")
    branch = info.get("default_branch")
    if not branch:
        raise ValueError("Repository has no default branch")
    if tree_ref and ("/" in branch or tree_ref != branch):
        raise ValueError("Non-default or ambiguous branch URL; use owner/repo[/folder] for the default branch")
    return repo, subdir, branch


def package_files(manager, tree, subdir):
    if subdir:
        safe_path(subdir)
    prefix = subdir + "/" if subdir else ""
    files = {}
    nested = [p[:-len("RECIPE.md")] for p in tree if p.startswith(prefix) and p != prefix + "RECIPE.md"
              and p.endswith("/RECIPE.md") and not p.startswith(prefix + "mods/")]
    nested = [root for root in nested if any(re.fullmatch(r"(?:mods/[^/]+/main\.js|layouts/[^/]+\.json)", p[len(root):])
                                            for p in tree if p.startswith(root))]
    for path, sha in tree.items():
        if path == "HEAD" or not path.startswith(prefix):
            continue
        rel = safe_path(path[len(prefix):])
        if manager.ignored_file(rel) or any(path.startswith(n) for n in nested):
            continue
        files[rel] = sha
    mods = sorted({p.split("/")[1] for p in files if re.fullmatch(r"mods/[^/]+/main\.js", p)})
    layouts = sorted({p[len("layouts/"):-5] for p in files if re.fullmatch(r"layouts/[^/]+\.json", p)})
    folders = {p.split("/")[1] for p in files if re.match(r"mods/[^/]+/", p)}
    if folders != set(mods):
        raise ValueError("Every runtime mod folder must contain main.js")
    if not mods and not layouts:
        raise ValueError("No valid mods or layouts found in this package folder")
    return files, mods, layouts


def descriptor(manager, repo, subdir, branch, tree):
    files, mods, layouts = package_files(manager, tree, subdir)
    if "RECIPE.md" not in files:
        raise ValueError("Package folder must contain RECIPE.md")
    recipe = manager.blob_bytes(repo, files["RECIPE.md"]).decode("utf-8", "replace")
    title = re.search(r"^#\s+(.+)$", recipe, re.M)
    url = f"https://github.com/{repo}/tree/{urllib.parse.quote(branch, safe='')}/" + urllib.parse.quote(subdir, safe="/")
    kind = "layout" if layouts else "mod"
    return {"id": repo + ("/" + subdir if subdir else ""), "repo": repo, "subdir": subdir,
            "branch": branch, "commit": tree["HEAD"], "name": title[1] if title else subdir or repo,
            "author": repo.split("/")[0], "description": "", "stars": 0, "pushed": "",
            "kind": kind, "collection": "direct", "mods": mods, "layouts": layouts,
            "preview_url": "", "avatar_url": "", "source_url": url, "recipe": recipe,
            "install_prompt": f"Read ~/.config/herdr-app/AGENTS.md, then add this {kind}: {url}"}


def discover(manager, value):
    repo, subdir, branch = source(manager, value)
    tree = manager.branch_tree(repo, branch, refresh=True)
    roots = sorted({p[:-len("RECIPE.md")].rstrip("/") for p in tree
                    if p == "RECIPE.md" or p.endswith("/RECIPE.md")})
    packages = []
    for root in roots:
        if subdir and root != subdir and not root.startswith(subdir + "/"):
            continue
        try:
            pkg = descriptor(manager, repo, root, branch, tree)
        except ValueError:
            continue
        record = manager.records.get(pkg["id"], {})
        pkg.update(installed=bool(record.get("installed")), enabled=bool(record.get("enabled")),
                   has_update=bool(record.get("has_update")))
        packages.append(pkg)
    if not packages:
        raise ValueError("No package folders with RECIPE.md and mods/*/main.js or layouts/*.json were found")
    return {"packages": packages, "branch": branch, "commit": tree["HEAD"]}


def read_keys(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return validate_keys(data)


def validate_keys(data):
    if not isinstance(data, dict) or any(not isinstance(v, dict) for v in data.values()):
        raise ValueError("keys.json must contain sections of bindings")
    return data


def shortcut_review(current, proposed, owned=None):
    owned = owned or {}
    rows = []
    for section, bindings in proposed.items():
        for key, action in bindings.items():
            existing = current.get(section, {}).get(key)
            previous = owned.get(section, {}).get(key)
            status = "add" if existing is None else "unchanged" if existing == action else "update" if previous == existing else "conflict"
            rows.append({"section": section, "key": key, "action": action, "current": existing, "status": status})
    for section, bindings in owned.items():
        for key, action in bindings.items():
            if key not in proposed.get(section, {}):
                rows.append({"section": section, "key": key, "action": None,
                             "current": current.get(section, {}).get(key),
                             "status": "remove" if current.get(section, {}).get(key) == action else "preserve"})
    return rows


def token(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def runtime_file(rel):
    return bool(re.match(r"mods/[^/]+/", rel) or re.fullmatch(r"layouts/[^/]+\.json", rel))


def local_snapshot(manager, record, files):
    snapshot = {}
    for rel in sorted(set(files) | set(record.get("files", {}))):
        if runtime_file(rel):
            path = os.path.join(manager.root, rel)
            # Do not follow a user's symlink while planning writes.
            parent = path
            while parent != manager.root:
                if os.path.islink(parent):
                    raise ValueError(f"Local symlink is not managed: {rel}")
                parent = os.path.dirname(parent)
            snapshot[rel] = manager.file_hash(path)
    return snapshot


def changes(before, after):
    return [{"path": p, "status": "add" if p not in before else "remove" if p not in after
             else "unchanged" if before[p] == after[p] else "change"}
            for p in sorted(set(before) | set(after))]
