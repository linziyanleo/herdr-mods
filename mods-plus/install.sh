#!/usr/bin/env bash
set -euo pipefail

HERDR_APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_SRC="$SCRIPT_DIR/mods/mods-plus"
DEST_MOD="$HERDR_APP/mods/mods-plus"

echo "=== Installing Mods Plus to $HERDR_APP ==="

# 1. Copy runtime mod
mkdir -p "$DEST_MOD"
cp "$RUNTIME_SRC/main.js" "$RUNTIME_SRC/mod.json" "$RUNTIME_SRC/helper.py" "$RUNTIME_SRC/catalog.py" "$RUNTIME_SRC/jobs.py" "$RUNTIME_SRC/star.svg" "$DEST_MOD/"
chmod +x "$DEST_MOD/helper.py"
echo "✓ Runtime files installed to $DEST_MOD"

# 2. Modify layout and shortcut via python helper
python3 - <<EOF
import json
import os
import subprocess

app_home = os.path.expanduser("$HERDR_APP")

# 1. Merge shortcut into keys.json
keys_file = os.path.join(app_home, "keys.json")
if os.path.isfile(keys_file):
    try:
        with open(keys_file, "r", encoding="utf-8") as f:
            keys = json.load(f)
        glob = keys.setdefault("global", {})
        if "cmd-shift-x" not in glob:
            glob["cmd-shift-x"] = "mod.open:mods-plus"
            with open(keys_file, "w", encoding="utf-8") as f:
                json.dump(keys, f, indent=2)
            print("✓ Added shortcut 'cmd-shift-x' -> 'mod.open:mods-plus' to keys.json")
        else:
            print(f"- Shortcut 'cmd-shift-x' already bound to {glob['cmd-shift-x']}")
    except Exception as e:
        print(f"! Warning: Failed to update keys.json: {e}")

# 2. Update current personal layout (e.g. fanghu)
layout_name = "fanghu"
try:
    proc = subprocess.run(["herdr-app", "status"], capture_output=True, text=True, timeout=2)
    if proc.returncode == 0:
        layout_name = json.loads(proc.stdout).get("layout", "fanghu")
except Exception:
    pass

layout_file = os.path.join(app_home, "layouts", f"{layout_name}.json")
if os.path.isfile(layout_file):
    try:
        with open(layout_file, "r", encoding="utf-8") as f:
            layout = json.load(f)

        def inject_entry(node):
            if not isinstance(node, dict):
                return node
            if node.get("id") == "brand-row":
                children = node.get("children", [])
                if len(children) == 2 and any(c.get("id") == "plugins-entry" for c in children):
                    brand = next((c for c in children if c.get("id") == "brand"), None)
                    if brand:
                        brand["size"] = node.get("size", {"px": 46})
                        return brand
            if node.get("id") == "sidebar-footer" and node.get("content", {}).get("mod") in ("workspace-chrome", "mods-plus"):
                node["content"] = {"mod": "mods-plus", "props": {"entry": True, "footer": True}}
                node["size"] = {"px": 97}
            if "children" in node:
                node["children"] = [inject_entry(child) for child in node["children"]]
            return node

        installed_file = os.path.join(app_home, "installed.json")
        shipped = json.load(open(installed_file)) if os.path.isfile(installed_file) else {}
        if f"layout:{layout_name}" in shipped:
            print(f"- Clone bundled layout '{layout_name}' before adding the Plugins footer")
        else:
            before = json.dumps(layout)
            layout = inject_entry(layout)
            if json.dumps(layout) != before:
                with open(layout_file, "w", encoding="utf-8") as f:
                    json.dump(layout, f, indent=2)
                print(f"✓ Placed Plugins above Settings in '{layout_name}'")
            else:
                print(f"- Footer unchanged in '{layout_name}'")
    except Exception as e:
        print(f"! Warning: Failed to update layout {layout_file}: {e}")
EOF

# 3. Check mod with herdr-app check
echo "Checking mod installation..."
herdr-app check "$DEST_MOD"

echo "=== Mods Plus installation complete! ==="
