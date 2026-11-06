# Mods Plus

Browse Herdr mods and layouts, import public GitHub packages, and review files and shortcuts before installing or updating. Installation stores a checked package; Enable or Use layout activates it separately.

![Mods Plus](preview.png)

## Browse and install

Open Plugins from the sidebar or its configured shortcut. Browse Community and Examples, switch between Mods and Layouts, filter by installation status, or search and sort the catalog. Details show the recipe, source, preview and available actions.

Choose Review install to see the source revision, file changes, mods, layouts and shortcuts. Cancel leaves the installation unchanged. Confirming Install runs `herdr-app check` and stores the package outside the active mod and layout directories. Enable or Use layout then activates it while preserving existing shortcut conflicts.

Add from GitHub accepts `owner/repo[/folder]` or an HTTPS GitHub repository or default-branch folder URL. If a repository contains several packages, choose one before reviewing it. Installed imports remain listed under Imported during catalog outages.

Import supports public repositories on their default branch. The selected branch remains the source for later update checks. Other hosts, non-default refs, ambiguous URLs, encoded paths, symlinks and submodules are unsupported. Use shorthand when the default branch name contains `/`. Each package needs `RECIPE.md` and runtime mods or layouts. Direct imports show source links and recipe text without downloading unmoderated preview images.

## Update and remove

Checks download and validate update candidates without changing active files. Review update shows the prepared changes before Apply update. A three-way merge preserves compatible local edits; conflicts or changes since review block application. Mods Plus backs up managed files before changing them.

Checks are manual by default. Settings can enable automatic checks with an interval in minutes or hours. The Plugins sidebar entry schedules checks while its layout is loaded. Checks pause when that layout closes or Herdr quits. Long operations run as bounded tasks, with progress and errors in the dialog. The sidebar count shows verified update candidates.

Removal checks every local layout for references. It retains shared mods and blocks removal when a layout still uses the package. When integration needs an agent, Copy copies the displayed prompt and Open Agent tab passes the package and target context to the configured agent.

Reviews read metadata and files without running downloaded code. Install confirmation and update preparation run native mod checks. These checks do not establish that community code is safe.

## Install Mods Plus

Requires Python 3, `curl`, `diff3` and `herdr-app`. Use `${HERDR_APP_HOME:-$HOME/.config/herdr-app}` as the app home.

Check for an existing `mods/mods-plus/` first. Back up a previous installation and compare local changes before updating it. For a fresh installation, or an update after that comparison, run from the repository root:

```sh
./mods-plus/install.sh
```

The script copies the runtime, adds `cmd-shift-x` only when unbound, and places Plugins above Settings in a compatible personal layout. It leaves bundled layouts unchanged.

To install manually:

1. Copy `main.js`, `mod.json`, `helper.py`, `catalog.py`, `review.py`, `jobs.py` and `star.svg` into `<app-home>/mods/mods-plus/`.
2. Add `"cmd-shift-x": "mod.open:mods-plus"` to the `global` section of `keys.json` only if that key is available. This is `Cmd+Shift+X` on macOS.
3. In a personal layout, set `sidebar-footer` content to `{"mod":"mods-plus","props":{"entry":true,"footer":true}}` and its height to 97px. The footer contains Plugins, Settings and Add machine. Remove an older Plugins header entry if present.
4. Run `herdr-app check <app-home>/mods/mods-plus` and inspect `herdr-app status`.

## Development checks

```sh
python3 mods-plus/tests/helper.test.py
python3 mods-plus/tests/catalog.test.py
python3 mods-plus/tests/updates.test.py
python3 mods-plus/tests/review.test.py
python3 mods-plus/tests/jobs.test.py
python3 mods-plus/tests/acceptance.test.py
node --test mods-plus/tests/ui.test.cjs
herdr-app check mods-plus/mods/mods-plus
```

The jobs suite includes a real 31-second operation. UI event tests require Node.js 18 or newer and no extra dependencies.

For native checks, `node mods-plus/tests/native-fixture.mjs` prepares a disposable home and prints its session file. It does not start Herdr or herdr-core. Launch that home with the printed environment, then run `node mods-plus/tests/native-verify.mjs <session.json>`. The driver uses the production view and helper with a local fixture repository. It records results and screenshots. Keep it out of the normal app home.

See the [recipe](RECIPE.md) for implementation contracts and acceptance criteria. The [verification record](../docs/plans/mods-plus.md#review-and-direct-import-2026-11-06) covers the combined review, import and background-task implementation. Physical input and additional sizing/theme combinations remain unverified for this release.
