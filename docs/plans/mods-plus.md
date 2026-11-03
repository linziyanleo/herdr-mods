# Mods Plus implementation plan

Status: implemented locally. The 2026-11-03 gallery repair uses the official catalogs, corrects installed detection, and renders the official gallery structure with native GPUI. The subsequent user request authorizes committing and pushing Mods Plus to `main`, including the user-updated preview image.

## Goal and delivery

Provide a **Plugins** dialog for browsing, installing, enabling, updating, and removing community Herdr mods and layouts. Keep package management in scripts and show only the information needed to choose and use a package.

Deliver one independent mod under `mods-plus/mods/mods-plus/`, with an installation script and local package helper. Add the Plugins entry to the current personal layout. This package is a mod, not a whole-window layout, and requires no Herdr core changes.

## Entry and dialog

- Put a **Plugins** row above **Settings** in the current personal layout's sidebar footer, using the same native row styling. Remove the former header entry.
- Provide a shortcut that opens the dialog from any layout. Check existing bindings before choosing the shortcut.
- Other layouts do not need an injected button. Clone bundled layouts or mods before changing their structure or code.
- At the top of the dialog, show **Mod** and **Layout** tabs. Put an **All / Installed / Not installed** filter at the right of the tab row.
- Place a native **Settings** icon directly left of the right-aligned search field. Settings opens a page inside the dialog with a way back to the catalog.
- Include **Community / Examples**, author avatars, and a right-aligned **Popular / Newest** dropdown. Use the official gallery indexes and moderated preview URLs; do not reconstruct the catalog with independent GitHub topic searches.
- In **All**, place installed packages first. Apply the filter separately within each tab.
- Match the official [Mods](https://herdr.dev/mods/) and [Layouts](https://herdr.dev/layouts/) gallery style with native GPUI preview cards, package names, authors, and descriptions.
- Mark installed cards **Installed** at the bottom right. Clicking a card opens its details.
- Details show the preview, description, source, recipe, and applicable actions: **Install**, **Enable** or **Use layout**, **Update**, and **Remove**. Keep the distinction between installing files and changing the current window clear.
- Show operation progress and actionable failures without adding a separate maintenance dashboard. Do not expose Adopt, clone, personal, or untracked as catalog statuses.

## Catalog and existing installations

Use the official Herdr mod and layout catalogs and their package source links. Support repositories with multiple package directories, and packages that contain both mods and layouts. Cache catalog metadata and previews so reopening the dialog does not require a full scan.

Scan the current app home for existing installations. Automatically associate packages whose source can be established from package identity and file evidence. A matching folder name alone does not establish ownership. Protect local modifications and leave ambiguous name collisions untouched, with an explanation in details. No manual Adopt step is required.

Keep minimal internal records for source repository and subdirectory, installed revision, file ownership and baseline hashes, integration changes, and pending updates. These records support safe actions without becoming extra user-facing statuses. Keep bundled Herdr files outside community-package update and removal operations.

## Install and enable

Installation, updates, and removal run through the local helper without model calls. Separate installation from activation:

1. Resolve the selected package to a specific source revision and stage its files.
2. Check names, package contents, shared files, and shortcut conflicts. Preserve existing files and bindings when ownership is uncertain.
3. Run `herdr-app check` for the package's runtime mods before making them available for use.
4. Record the successful installation and mark the card Installed.
5. Let the person choose **Enable** or **Use layout** separately.

Keep newly installed packages outside the active `mods/` and `layouts/` directories until activation. Herdr can dock a new mod as soon as its folder appears, so copying directly into those directories would bypass the separate Enable action.

For existing installations, preserve their current placement and behavior. Scripted activation uses a known integration rule or an explicit package declaration. It may add a panel, open a mod, or switch layouts only after the person selects the corresponding action. Preserve unrelated layout nodes and bindings.

When activation requires interpreting natural-language instructions in `RECIPE.md`, offer:

- **Copy activation prompt**: copy a complete prompt to the clipboard.
- **Open Agent tab**: create a new tab, start the configured default agent, and pass it the same prompt.

The prompt includes the package source and revision, installed paths, recipe, target app home and layout, required result, and instructions to preserve existing configuration and verify the result. Starting the agent is an explicit user action. If no default agent is configured, resolve that choice before launching one.

Do not treat an agent launch as completed activation. Re-read the resulting files and layout references before reporting the package as in use. Installation itself does not require an agent, and arbitrary recipes are not assumed to be scriptable.

## Remove and protect references

- Before removal, inspect all local layouts and package records for references to the package's mods and shared files.
- Automatically undo integration only when the script can safely identify and reverse the relevant changes. Preserve later user edits.
- If safe deactivation cannot be established, keep the package installed and provide a cleanup prompt. Do not delete files still used by a layout.
- Removing a layout must retain mods that another layout or package still uses.
- Preserve user configuration and data. Keep a recoverable copy of managed files changed or removed by the operation.
- Do not assume an agent's earlier layout edits can be reversed by restoring an entire old layout snapshot.

## Updates and settings

Manual updates are the default. Settings provides an automatic-update switch and a configurable check interval.

For automatic updates, download and verify a candidate first. Apply it on the next explicit activation or the next Herdr start when Mods Plus loads. Also provide a manual action to apply a prepared update immediately. Do not apply a scheduled update to the running interface as soon as the download finishes.

Protect local modifications in both manual and automatic updates. Automatically apply only changes that can be made without losing local edits. Leave the current installation intact when a merge, validation, or ownership check fails, and explain what needs attention in details. Recheck files before applying a prepared update because they may have changed since download.

Stage and check candidates before changing active files, retain a backup, and preserve Herdr's directory-watching behavior when updating an existing mod. Keep package records consistent with the files actually applied. Coordinate the entry and dialog so they cannot perform competing mutations.

The Plugins entry runs the scheduled checks while its layout is loaded. Closing Herdr or switching to a layout without that entry pauses scheduling. Check whether work is overdue when the entry loads again or the dialog opens. Do not install an independent background service.

Catalog or update-check failures must not change installed detection or report unchecked packages as up to date. Keep the last usable catalog available with a clear refresh error.

## Implementation boundaries

- Use native GPUI and Herdr's documented APIs. Run slow file and network operations through the local helper with `exec`.
- Resolve the active app home through `appHome()` and support `HERDR_APP_HOME` in scripts.
- Store package contents, records, prepared updates, and backups under the app's `data/mods-plus/` directory.
- Reuse existing download, comparison, validation, and merge mechanisms where suitable. Preserve required attribution if third-party code is reused.
- Include `RECIPE.md`, a real `herdr-app shot` preview, and reproducible installation instructions when the mod is implemented, following [Contributing](../../CONTRIBUTING.md).
- Implement Mods Plus independently. Any replacement or removal of the installed herdr-pkg is a separate action.

## Implementation sequence

1. Build the Plugins entry, dialog, catalog cards, details, filters, and installed detection.
2. Add scripted installation, separate activation, and the two activation-prompt actions.
3. Add protected removal, manual updates, prepared updates, settings, and scheduled checks.
4. Verify the complete flows in a disposable Herdr instance before any authorized installation into the working app.

## Acceptance

These checks define the release acceptance scope. The repair verification below distinguishes completed checks from unverified live operations.

1. The button opens the dialog in the target personal layout. The shortcut opens it from another layout without replacing existing bindings.
2. Both tabs, all three filters, installed-first ordering, the Installed marker, card details, and Settings work in the native window.
3. Existing packages are recognized without Adopt. Modified copies and ambiguous name collisions remain intact, and offline refresh does not misclassify them.
4. Install completes through scripts without a model call or an unintended layout change. Failed checks preserve the previous working files and records.
5. Enable and Use layout perform the selected integration. Both prompt actions include the correct package and target context, and an agent tab uses the configured agent.
6. Removal checks references across layouts, retains shared mods and user data, and blocks unsafe deletion with a cleanup prompt.
7. Manual updates are the default. Automatic checks honor the selected interval, avoid duplicate work, and resume overdue checks after scheduling pauses.
8. Prepared updates leave the running interface intact until an agreed application point. Local edits and failed merges remain protected.
9. Run `herdr-app check` for every runtime mod, verify affected interactions and error states, confirm `herdr-app status` has no new errors, and capture the UI with `herdr-app shot`.

## Gallery repair verification (2026-11-03)

- Herdr 0.1.12 on macOS. Source and the existing local installation contain the same five runtime files. No layout, shortcut, Git commit or remote publication was changed by this repair.
- The official mod index returned 238 community items and one example. The refreshed layout index returned 130 community items and seven examples; counts can change with the upstream hourly crawl.
- Local file verification recognizes Files Plus, Preview Plus, Git Changes and Packages. Nested package roots, additional cache/license files, missing installations, staged packages, local edits and failed network verification are covered by catalog tests. Earlier heuristic association records are revalidated before being trusted.
- `helper.test.py` (4 tests), `catalog.test.py` (10 tests) and `acceptance.test.py` (1 flow) pass. The acceptance flow uses a disposable app home and intercepts the layout-switch command; it does not switch the working window.
- `herdr-app check` passes for source and installed runtime. The working app reports no mod errors. Native screenshots confirmed the gallery, author images and the details structure. A temporary native renderer exercised the examples category and open sort menu. It was closed after verification.
- Full pointer/keyboard acceptance remains pending: the working window was actively used during verification, and the secondary background window returned stale frames for some asynchronous image states. The user subsequently supplied the updated `preview.png` for Git delivery; that image is preserved unchanged. Installation, removal and update actions were not exercised on real user packages.

The subsequent user-requested placement change moves Plugins to the personal sidebar footer above Settings. Mods Plus renders all three footer rows, preserving Settings, Add machine, collapsed-rail behavior and update badges. The bundled workspace-chrome files remain unchanged. The installer performs the same migration on personal layouts.
