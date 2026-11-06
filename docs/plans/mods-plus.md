# Mods Plus implementation plan

Status: install/update review and direct GitHub import are implemented and verified in the combined source release. Development used `agent/mods-plus-community`, based on `1f82759aea1cd8c78c9de36fe624a27cab5c2253`, under the user's authorization to verify, integrate into `main` and push. Normal-home installation and layout switching are excluded.

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

Automatic checks download and verify candidates. Applying a candidate requires an explicit review and confirmation in details; activation and app startup do not silently apply updates. Scheduled downloads leave the running interface unchanged.

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

## Review and direct import (2026-11-06)

The user requested install/update review and direct public GitHub import. The unrelated `mods-plus-timeout` worktree owns execution/timeout work; this task does not absorb it or redesign helper dispatch.

The existing details flow now exposes Review install/Review update, then the concrete files, mods, layouts, keys and local edits, followed by confirmation or cancellation. Preview reads GitHub metadata/blobs and may populate caches; it does not modify package records, installed files, keys or layouts, or run downloaded code. Install confirmation retains the native staged checks and separate activation. Review tokens bind the exact commit/manifest and relevant current local state. Installation refuses a moved source; updates apply the exact reviewed prepared candidate and reject replaced candidates or local drift.

Add from GitHub accepts a public repository or subfolder on its default branch. Discovery lists each valid recipe/runtime package separately and excludes nested packages from parent manifests. Other hosts, traversal, encoded paths and non-default/ambiguous refs produce explicit failures. The selected branch is stored and followed on future checks. Source descriptors live in the existing `packages.json` records and reappear under Imported when absent from the official catalog, including during outages. GitHub remains necessary for discovery and new install reviews. Symlinks/submodules are currently unsupported; unmoderated preview images are not downloaded.

The apply path now writes the actual three-way merge result and checks the merged mods before active writes. It also handles additions/removals and layout content, preserves local/unmanaged files, backs up affected files, verifies candidate contents and rechecks state after validation. Available package shortcuts are added only on activation (or an explicitly applied active update); conflicts and later user rebindings remain unchanged. Removal reverses only bindings the package still owns. Stored-only packages cannot claim active same-name files.

CLI integration contracts: `discover SOURCE` returns package descriptors; `review ID [--update]` returns a review with `token`; `install REPO [SUBDIR] --review TOKEN` and `apply-update ID --review TOKEN` require it. The runtime distribution gains `review.py`; the installer copy list and manual instructions include it. Existing helper execution and mutation locking remain in place. These are the contracts the coordinating agent must preserve when integrating execution/timeout changes.

Validation: 36 Python cases (helper 4, catalog 12, updates 8, acceptance 1, review/import 11) and nine Node event cases pass. The added cases verify source parsing, multiple packages, no preview writes/execution, shortcut conflicts, commit versus tree identity, source persistence/offline catalog access, reviewed revision/candidate/local drift, merge output, layout edits and install versus activation. Herdr 0.1.13 on macOS 27.2 passes the source check and isolated native driver/review-render checks. `git diff --check` passes. The eager native review check verifies renderable controls, not actual pointer interaction.

Native acceptance in `/tmp/mp.lBl5xK` passed nine production-view/helper checks: multi-package discovery, review cancellation, installation without activation, shortcut conflicts, enable, prepared update review, refusal after local drift, reviewed apply and removal preserving rebound keys. `herdr-app status` reported no errors. The inspected `review-delivery.png` is the current `preview.png` and shows the concrete file changes and both preserved shortcut conflicts. The fixture resizes its own window before captures because this environment can retain an old frame.

A live public GitHub discovery of this repository found Files Plus, Mods Plus and Preview Plus as separate packages. A read-only Files Plus install review resolved commit `1f82759aea1cd8c78c9de36fe624a27cab5c2253` and returned its manifest and change list. No live package was installed. Physical pointer/keyboard dispatch, scrolling and additional narrow/theme combinations remain unverified: CUA could not locate the isolated window. The existing normal app home and user bindings remain unchanged.

Independent review reproduced an ownership defect in multi-layout packages: enabling one layout could allow an update to modify an unrelated same-name file for another layout. Fix `5a1ebfa` records only actually activated layouts in `active_layouts`; updates and removal honor that set. Legacy records without this evidence preserve local layouts rather than inferring ownership from matching bytes. Twenty relevant Python cases and the native source check pass, including update/removal preservation of an independently created second layout and conservative legacy handling. The earlier native mod/shortcut flow does not depend on layout ownership and remains applicable.

Final integration preserves concurrent main commit `3451c39` (the helper timeout repair described below). Merge `f0f4636` passes the spawned context and reviewed token through discovery/review/install/update jobs, retains both `jobs.py` and `review.py` in installation and native fixtures, preserves cache-only imported metadata, and combines app-home isolation with native-check deadlines. The integrated checks pass 48 Python cases and 13 UI event cases, including the real 31-second worker and new job-dispatch/cache-only import regressions. Source, shell syntax, whitespace and local documentation-link checks pass. A real one-shot job also completed a read-only public Files Plus install review at commit `3451c394128585a70d6e41b73a3478e254b1135b`, returning 48 files and a review token without installation. This integration does not reload the normal app.

Final independent review of runtime commit `a4188ffe2feb40f8d40fc727eef62f7767acc5e2` found no validated defects. It separately passed 13 UI cases, six targeted Python cases, a real cached-query job from a temporary runtime package and association-record persistence assertions. Final changes after that review are documentation only.

Attribution: UX references are [herdr-customize/docs/app.md](https://github.com/wapenshaw/herdr-customize/blob/main/docs/app.md) and [herdr-app-mod-manager](https://github.com/jacksonpires/herdr-app-mod-manager). No third-party code/assets were copied, and no license decision or new library dependency is introduced. Review/check output is not a security certification.

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

## Update-check repair (2026-11-03)

The user requested a fix for expired `cx` errors, settings click/refresh failures, loading and check animations, parallel update checks, and a numeric update badge beside Plugins. The repair uses the existing helper and native view, with no new runtime dependencies.

- Settings writes and manual checks now run inside `cx.spawn`. Saving/checking state prevents repeated actions, errors restore the controls, and nested refreshes retain the busy indicator until completion. Native spinners and a 250ms ease-out opacity transition provide feedback without render timers.
- Upstream lookups and candidate preparations run with at most four workers. Packages sharing a repository/ref reuse one fresh lookup. Network failures are reported per package; a failed check does not advance the successful-check timestamp. Runtime files remain unchanged by preparation.
- The helper reloads state after acquiring the mutation lock and refuses to proceed when the lock times out. Settings reads and media downloads bypass this lock. Blob cache writes use atomic replacement because concurrent package workers can download the same blob.
- Shared state publishes the verified candidate count to the footer after checks, apply and removal. Incomplete/stale candidate directories are excluded. The expanded footer aligns the count to the right; the collapsed rail replaces the icon with the number.

Verification: `herdr-app check` passes for source and the existing installation on Herdr 0.1.12. The three existing Python suites pass (15 tests); update regression coverage adds five tests, using real candidate checks in a disposable app home and barriers proving concurrent execution. Four JavaScript tests exercise the actual event handlers with expiring click contexts and deferred helper replies, including automatic badge publication and partial failures. `git diff --check` passes.

The two changed runtime files were synchronized to the existing local Mods Plus installation after confirming it matched the baseline. Herdr reports no mod errors. The verification overlay was closed. Native screenshot capture returned the prior screen despite the reported overlay, and pointer automation returned `noWindowsAvailable`; live animation and pointer acceptance remain unverified. The existing preview is retained. No real package update was applied, and no layout or shortcut was changed.

The user subsequently authorized commit, push and local Herdr installation. Implementation and regression tests are committed as `9f2ef9b4786b9500d77371bdcc00528482a604d6` on `agent/mods-plus-update-fix`, based on `061d14ed99f1d3406ff038935bcd30b134811933`. Delivery targets `linziyanleo/herdr-mods` on `main`. All five installed runtime files match the delivery source byte for byte, the installed runtime check passes, and Herdr reports no mod errors. Existing test evidence remains applicable because the implementation has not changed since those checks; the live pointer/animation limitation above remains open.

## Custom interval and check latency (2026-11-03)

The user requested a switch for automatic checks, a numeric interval followed by min / hr, and investigation and repair of slow update checks. This continues the same Mods Plus delivery and local installation scope.

- A native controlled Switch shows the saved on/off state. The interval saves on Enter, blur or a unit click. Blur and the adjacent unit click coalesce into one write. Invalid values leave persisted settings unchanged. Existing `interval_hours` settings migrate to the value/unit pair without changing the interval; the legacy CLI option remains supported. The footer checks due work once per minute so short intervals are honored.
- Profiling four installed packages from two repositories in a disposable app home measured 22.93s for checking/preparation. Twenty-one uncached blob requests accounted for 21.18s of serial request time; the subsequent cached catalog refresh took 0.03s. Package-level concurrency did not help the slow package's internal serial download loop.
- A shared pool now downloads up to eight files concurrently across the package workers. All submitted downloads finish before candidate validation or lock release. The response includes current settings and candidate IDs, so the view updates existing cards and the footer directly instead of calling settings and catalog again.
- The paired live-network run with the same initial cache and matching candidate revisions/file hashes completed in 6.44s (about 72% less wall time). Both runs made two tree requests and 21 uncached blob requests and returned the same two verified candidates without errors. No active user package files were changed. Network variation still affects individual checks.

Verification: 23 Python tests and six JavaScript event tests pass. New coverage proves parallel file downloads within one package, minute-based scheduling, legacy migration, invalid-input rejection, blur/unit coalescing and card/badge refresh without a catalog request. The normal `herdr-app check` and a disposable native fixture rendering the actual settings controls pass on Herdr 0.1.12. The fixture uses controlled helper responses and does not claim pointer acceptance.

Local installation: all five runtime files match the task source, the installed check passes, and Herdr reports no mod errors. The running-window capture shows the Plugins count of 2. The settings overlay was not available in the captured frame, so switch/input pointer acceptance and animation inspection remain unverified; the existing preview is preserved. Delivery continues to `linziyanleo/herdr-mods` on `main` under the user's prior commit/push/install authorization.

## Helper timeout repair (2026-11-06)

Scope: the user authorized the minimal timeout repair, tests, a local commit and reloading the installed Mods Plus, followed by inspection of an incomplete update candidate. This delivery uses `agent/mods-plus-timeout`, based on local main `1f82759aea1cd8c78c9de36fe624a27cab5c2253`. Remote push and mainline integration are outside this request; the primary checkout's existing `.gitignore` edit is preserved.

Herdr 0.1.13 documents a fixed 30-second `exec` limit with no timeout override. Catalog loading previously serialized four 20-second fetches, media waited for up to 48 downloads, and update preparation included downloads and native checks in one invocation. Parallel downloads alone did not remove that boundary.

The installed contract now uses short start/status calls to bounded, one-shot Python jobs for long operations. Matching requests share an active job; manual and scheduled checks share the same identity. The supervisor enforces a five-minute deadline and terminates the helper process group on timeout. Native checks have a 45-second deadline. Job results are published atomically and old finished receipts expire after one day. Existing package locks and conflict protection remain in place.

Catalog browsing returns cached entries first, then refreshes four feeds concurrently. Media uses cached metadata and loads four cards per batch, with six-second image requests and per-batch failure isolation. Browsing does not hold the package mutation lock; newly proven ownership is persisted under a short lock only when the existing record still matches the inspected snapshot. This also fixes a lock timeout observed while an actual long update ran during catalog refresh.

Verification:

- 34 Python tests pass across helper, catalog, updates, acceptance and jobs suites. Coverage includes a real 31-second task surviving launcher exit, deduplication, failure retry, descendant termination on deadline, catalog reads during a held mutation lock, concurrent-record preservation, cached/offline reads and failed native validation.
- Nine JavaScript tests pass, including short-RPC polling, cache-first presentation, four-card batches that continue after a failed batch, and existing settings/update behavior. Source and installed `herdr-app check` pass; `git diff --check` passes.
- The reloaded native mod launched an update check that finished in 46.44 seconds with one prepared candidate and zero package errors. Cached catalog loading returned entries in under one second. A subsequent full catalog job returned 627 entries with no warnings or errors. These are single local observations, not network latency guarantees.
- Six installed runtime files match the task source byte for byte. Herdr reports the Mods Plus overlay open and no mod errors. No layout, shortcut or other active package was changed. `herdr-app shot` returned a stale frame; native computer use failed with `cgWindowNotFound`. Pointer and current-image acceptance remains unverified, and the existing preview is retained.

Candidate inspection: the original `updates/linziyanleo-herdr-mods-mods-plus` contained 14 files without `meta.json`, with `has_update` false. Under the package lock, all 14 files matched their immutable blob-cache copies. The successful check replaced it with a complete 15-file candidate at upstream revision `1f82759aea1cd8c78c9de36fe624a27cab5c2253`; every file matched the published candidate hashes. The new candidate contains a local-edit conflict and was not applied. It is no longer an incomplete residual directory, so it is retained rather than manually deleted. The repaired local runtime remains installed.
