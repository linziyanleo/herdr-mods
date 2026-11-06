# Mods Plus

A native Herdr desktop mod and local package manager for browsing, installing, enabling, updating, and removing community mods and layouts.

![Mods Plus](preview.png)

See [the recipe](RECIPE.md) for detailed UI specifications, interactions, safety contracts, and acceptance checks. The [implementation plan](../docs/plans/mods-plus.md) defines the agreed release architecture.

## Features

- **Plugins Dialog**: Browse the official Community and Examples catalogs with large preview cards, author avatars, stars, local search and Popular / Newest sorting.
- **Mod and Layout Tabs**: Dedicated tabs with **All**, **Installed**, and **Not installed** filters. Installed packages appear first in **All**.
- **Separate Install and Activation**: Package files are staged, checked with `herdr-app check`, and recorded outside active directories until explicit **Enable** or **Use layout** is selected.
- **Reference-Safe Removal**: Inspects all local layouts before removing a mod. If an active layout still references a mod, removal is blocked with a guided cleanup prompt. Shared mods are retained.
- **Protected Updates**: Manual updates by default, with an automatic-check switch and a custom numeric interval in min or hr. Package checks and file downloads run with bounded concurrency. Candidates are staged and checked first without modifying running files. Three-way merge protects local edits.
- **Details**: Large previews, descriptions, author information, a copyable installation prompt, source links, package actions and the rendered recipe.
- **Review before changes**: Review install or update inside details. See the exact revision, file additions/changes/removals, mods, layouts, local edits and shortcut conflicts before confirming. A stale review is rejected. Conflicting shortcuts stay bound to their existing actions.
- **Add from GitHub**: Enter `owner/repo[/folder]` or an HTTPS GitHub repository/default-branch folder URL. Choose a discovered package, review it, then install. Installed sources remain available under Imported even outside the official catalog or during a catalog outage.
- **Agent Integration Actions**: **Copy** copies the displayed installation prompt; **Open Agent tab** passes the fuller activation context to the configured agent.
- **Sidebar Plugins Entry**: A native icon-and-label row above Settings, with a synchronized update count on the right. A collapsed sidebar shows the count when updates are available and the icon otherwise.
- **Universal Shortcut**: Global shortcut (`Cmd+Shift+X` on macOS) to open the dialog from any layout.

## Installation

Run the provided installation script:

```sh
./mods-plus/install.sh
```

Or install manually:

1. Check `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/mods-plus` for conflicts.
2. Copy only `main.js`, `mod.json`, `helper.py`, `catalog.py`, `review.py`, `jobs.py` and `star.svg` into `mods/mods-plus/`. Python 3, `curl` and `diff3` must be available.
3. In `keys.json`, add `"cmd-shift-x": "mod.open:mods-plus"` under `"global"`.
4. In your personal layout, set the `sidebar-footer` content to `{"mod":"mods-plus","props":{"entry":true,"footer":true}}` and its height to 97px. This footer contains Plugins, Settings and Add machine. Remove any previous header entry.
5. Verify the installation:
   ```sh
   herdr-app check ~/.config/herdr-app/mods/mods-plus
   ```

## Verification

Run the automated test suites:

```sh
# Unit tests
python3 mods-plus/tests/helper.test.py
python3 mods-plus/tests/catalog.test.py
python3 mods-plus/tests/updates.test.py
python3 mods-plus/tests/review.test.py
python3 mods-plus/tests/jobs.test.py # includes a real 31-second operation

# Async UI event tests (Node.js 18+, no dependencies)
node --test mods-plus/tests/ui.test.cjs

# Acceptance test suite
python3 mods-plus/tests/acceptance.test.py

# Mod structure check
herdr-app check mods-plus/mods/mods-plus
```

Direct import supports public repositories and the repository's default branch at installation. That branch is persisted for subsequent update checks. Other hosts, explicit non-default refs, ambiguous branch URLs, encoded paths and traversal are refused. For a default branch containing `/`, use `owner/repo[/folder]`. A package needs `RECIPE.md` and at least one `mods/*/main.js` or `layouts/*.json`; repositories containing symlinks or submodules are currently refused. Imported packages use source links and recipe text, without downloading unmoderated preview images.

Review only reads metadata/content and may fill the download cache. It does not run downloaded code, install files, merge keys or switch layouts. Confirming Install runs the existing native checks and stores the reviewed files. Enable/Use layout adds available shortcuts while retaining conflicts. Update checks may run the existing candidate check stage; applying still requires a review of that candidate. These checks do not establish that community code is safe.

For isolated native acceptance, `node mods-plus/tests/native-fixture.mjs` prepares a disposable home and prints its session file without starting Herdr or herdr-core. After the coordinating agent launches that home with the printed environment, run `node mods-plus/tests/native-verify.mjs /tmp/mp.<id>/session.json`. The driver uses the production view/helper with a local fake repository. It produces screenshots and a result file; physical pointer/keyboard and light/dark appearance still require inspection. Do not point the fixture at a normal app home.
