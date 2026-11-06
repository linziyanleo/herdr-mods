# Mods Plus

Browse Herdr catalogs or import a public GitHub package. Review the files, revision and shortcuts before installing or updating. Install stores the checked package; Enable or Use layout activates it. The Plugins sidebar entry opens the manager and shows available updates.

![Mods Plus](preview.png)

## What you see

- The sidebar footer shows Plugins above Settings and Add machine. Each row uses a 14px native icon, 13px text, 28px height and the native hover style. The 97px footer preserves update badges and hides labels when the sidebar is collapsed. The shortcut is preserved; there is no header entry.
- The dialog uses the native theme, 0.5px borders and four text sizes, 12, 13, 16 and 28px. Mods / Layouts and All / Installed / Not installed occupy the first row.
- Community and Examples appear below with the official category counts. On the right, a settings icon sits immediately before search, followed by the Popular / Newest dropdown.
- Responsive one-to-three-column cards show a 16:10 preview, the author's avatar, title, author and stars. Installed and update markers sit at the right. Each page reveals 24 cards; images arrive four cards at a time. Unavailable images do not block later cards.
- Details show a large, uncropped preview above the title, author, stars and description. The adjacent Tell your agent box copies exactly its displayed installation prompt. GitHub links open the package's source folder. Package actions and the rendered recipe remain available below.
- Review update and Remove sit beside the detail title using the Herdr theme accent and matching foreground colors. Review install appears for an uninstalled package. The action group wraps below the title on narrow panels. Remove keeps its existing second-click confirmation and uses the theme warning color while confirming.
- Add from GitHub opens an inline native input with a Find packages action; Enter submits it. Results use the same cards and Mod/Layout tabs under Imported. A repository can yield several independently selectable packages.
- Reviews stay in details and hide the large preview to bring the changes into view. They show the source branch and commit, file additions/changes/removals, mod/layout changes, local edits and each proposed shortcut with any preserved conflict. Confirm, Refresh review and Cancel follow the list. The review uses 12px body text, a 16px heading and 0.5px borders in the current theme.
- Settings has an automatic-check switch and a custom interval: a positive whole number followed by min / hr controls. Enter or leaving the number field saves the interval; clicking a unit saves the final number/unit pair. Existing hour settings are preserved. Saving disables repeated actions and displays failures. Loading and checking use native rotating indicators.
- Plugins shows a right-aligned count of verified update candidates. The count refreshes after automatic or manual checks, application and removal. In the collapsed rail the count replaces the Plugins icon when updates are available.
- Card status occupies one line: Update Available replaces Installed when a candidate is available. Settings uses an arrow-only Back button. The footer count uses a 12px-high badge and 8px text.

## How it behaves

### Background tasks and loading

- Cached catalog entries appear before network refresh. Four official feeds refresh concurrently; media reads cached metadata without refreshing the feeds again.
- Long helper operations run as one-shot tasks. Herdr's 30-second `exec` calls only start tasks and read their results; the view polls every 500ms while waiting. Matching in-flight requests share a task, including manual and scheduled update checks.
- Each task has a five-minute deadline, native validation has a 45-second deadline, and each image request has a six-second deadline. Task timeout stops the helper process group. Failures include the operation name.
- Closing a view stops its polling. An already-started task can finish within its deadline; no daemon schedules new work. Completed task receipts are retained for one day and cleaned on subsequent starts.
- Candidate metadata is published atomically only after validation. Caught preparation failures remove their partial candidate without changing active files or recording a successful check. A hard-stopped task may leave partial files; they receive no badge and the next check replaces them.

### Install and activate

- Review install reads a fresh file list and the proposed keys, without executing downloaded code or changing installations. Confirming Install downloads the reviewed files into `data/mods-plus/stage/`, runs `herdr-app check` on runtime mods, and saves verified files to `data/mods-plus/packages/<pkg-id>/`.
- Files are kept outside `~/.config/herdr-app/mods/` and `layouts/` until the user explicitly selects Enable or Use layout.
- A review token binds the commit, manifest, relevant records, active files and current shortcuts. Source or local drift requires another review. Activation rechecks name ownership and stored file hashes. Existing shortcut conflicts are preserved; added bindings are tracked, and later rebindings survive update/removal.

### Direct sources

- Accept public `owner/repo[/folder]`, `https://github.com/owner/repo`, and `/tree/<default-branch>/folder` URLs. Ref overrides, non-GitHub hosts, traversal, encoded paths and ambiguous branch URLs are refused explicitly. Use shorthand for a default branch containing `/`.
- Find package roots by `RECIPE.md` plus runtime mods or layout JSON files; exclude nested packages from their parent's manifest. Every runtime mod folder needs `main.js`. Files are read via GitHub blob identities; commit identity is kept separately from the Git tree hash.
- Install saves source metadata, the selected default branch, revision and file ownership in the existing package record. Checks continue to follow that recorded branch. Installed direct sources remain browsable during official catalog outages and reuse the existing enable/update/removal flows. Uninstalled discoveries remain local to the current dialog. Direct previews are omitted.

### Recognize existing installations

The helper scans `mods/` and `layouts/`. It associates a package only when every upstream runtime file matches its Git blob hash. Extra caches and attribution files do not invalidate the match and remain outside the ownership baseline. Verified ownership survives later local edits. A record without staged or active entry files does not count as installed.

Same-name collisions leave existing files untouched. If offline verification cannot establish installation, the package appears in neither Installed nor Not installed. Details explain the unknown state.

### Remove packages

Before removing a mod, the helper checks every file in `layouts/`. A remaining reference blocks deletion and provides a cleanup prompt. Removing a layout retains companion mods used by other layouts or packages. The helper backs up managed files under `data/mods-plus/backups/<pkg-id>-<timestamp>/`.

### Update and merge

Update checks download candidates into `data/mods-plus/updates/<pkg-id>/candidate/` and validate their mods with `herdr-app check`. A three-way merge compares the baseline, local active files and candidate files. Conflicts leave active files unchanged.

Review update describes the prepared candidate. Apply update verifies its file set and hashes, rechecks local state, validates the merged mods and writes the merged files. It applies compatible local layout edits, removes files the package owns and no longer ships, and retains unmanaged files. Only layouts recorded as activated can change. Stored packages stay inactive. An update can use the reviewed candidate even if upstream has since advanced.

### Schedule checks

- While the layout with the Plugins entry is active, `cx.timer` checks for overdue work once per minute, supporting intervals as short as one minute.
- Switching layouts or quitting Herdr pauses scheduling without background daemon services.
- Up to four upstream lookups or package preparations run concurrently; packages sharing a source use one fresh tree lookup. A shared pool downloads up to eight files concurrently, including files within a single package. Checks bypass the catalog's cached tree. Failed packages are reported separately and never treated as up to date.
- A completed check returns settings and verified candidate IDs together. Cards and the footer update in place without reloading the catalog or resetting the current search/filter.
- Package mutations remain locked across helper processes. A lock timeout returns an error; it never proceeds unlocked. Catalog, details, settings reads and image downloads do not wait for package mutations. Newly verified ownership is saved under a short lock only if its prior record is unchanged; a busy operation defers that write.

### Agent prompts

The agent-tab activation prompt includes the repository, revision, installed paths, app home, active layout, recipe and `herdr-app check` instructions.

## Built from

- GPUI elements. `View`, `div`, `image`, `svg` from `gpui-kit`; `h_flex`, `v_flex`, `Input`, `InputState`, `Switch`, `TextView` from `gpui-base`.
- Herdr APIs. `exec`, `appHome`, `props`, `closeOverlay`, `notify`, `theme`, `window`, `run`, `knownAgents`, `shared`, `setShared`. Async settings and update actions receive the context from `cx.spawn`; native `spin` and opacity transitions provide feedback without animation timers.
- Official catalog. `https://assets.herdr.dev/mods/index.json` and `https://assets.herdr.dev/layouts/index.json`. Examples use the cards embedded in `https://herdr.dev/mods/` and `https://herdr.dev/layouts/`, enriched with identities from those same indexes. Community previews use only the official moderated URLs; avatars use GitHub. Metadata is cached for one hour with stale-cache warnings on refresh failure. Search, status filters and sorting run locally.
- Helper. `helper.py`, `catalog.py`, `review.py` and `jobs.py` use Python 3.8 or newer with `urllib.request`, `subprocess`, `hashlib`, `shutil` and `fcntl`. `diff3` merges local text edits.
- Network transport. `curl` is required for official catalog, preview and avatar requests. GitHub file evidence uses the existing GitHub API client. No credentials are sent to the gallery or avatar endpoints.
- Icons use bundled Herdr SVGs through `svg()`. The star outline is an original local SVG.
- Storage. `<appHome>/data/mods-plus/` for `packages.json`, `settings.json`, `cache/`, `stage/`, `packages/`, `updates/`, `backups/`, and bounded task receipts in `jobs/`.

## Watch out

- Never copy newly installed mods directly into `<appHome>/mods/` during installation; Herdr automatically docks new folders on appearance.
- Bundled Herdr mods and layouts listed in `installed.json` must remain read-only and excluded from community package management.
- Always check layout references across all layout files before deleting any mod folder.
- Review is a concrete change list, not a security assessment. Community mods are trusted code. Preview runs no downloaded code; install confirmation and the existing update preparation stage run `herdr-app check`.
- Direct import currently refuses repositories containing symlinks or submodules, and supports no non-default ref override. GitHub availability is required for discovery and fresh installation reviews. The recorded branch is retained if the repository later changes its default branch.

## Done when

1. `herdr-app check mods-plus/mods/mods-plus` passes.
2. `python3 mods-plus/tests/helper.test.py` passes.
3. `python3 mods-plus/tests/acceptance.test.py` and `python3 mods-plus/tests/catalog.test.py` pass.
4. The Plugins row renders above Settings, and the header has no duplicate entry.
5. The dialog opens via the button and via `Cmd+Shift+X`.
6. Tabs and filters show the matching catalog entries, and installed packages appear first in All.
7. Install stores checked files outside the active directories until Enable or Use layout.
8. Enable adds the chosen mod; Use layout activates the chosen layout. Existing shortcut conflicts keep their bindings.
9. Copy matches the displayed prompt. Open Agent tab receives the selected package and target context.
10. Mod removal is protected when layouts still reference the mod.
11. `python3 mods-plus/tests/updates.test.py` and `node --test mods-plus/tests/ui.test.cjs` pass. The UI event tests require Node.js 18 or newer.
12. `python3 mods-plus/tests/review.test.py` passes for multi-package discovery, preview without installation writes, invalid source rejection, revision/local drift, shortcut preservation, persisted sources, actual merges and stored-only updates.
13. In an isolated native home, enter a source, select both package kinds, cancel and refresh reviews, confirm install, enable separately, review/apply an update and remove it. Inspect narrow/wide and light/dark states plus a `herdr-app shot` screenshot. `tests/native-fixture.mjs` prepares the home without launching it; `tests/native-verify.mjs` drives its production handlers after the coordinating agent launches it. Pointer/keyboard acceptance is separate from handler automation.
14. `python3 mods-plus/tests/jobs.test.py` passes, including a real 31-second task after its launcher exits, duplicate requests, failed-task retry, and timeout cleanup of descendants.

## Verification record

The combined review, import and background-task implementation passed 48 Python cases and 13 UI event cases on macOS with Herdr 0.1.13. Nine isolated native checks covered discovery, review cancellation, install, separate activation, update and removal. The preview shows an inspected install review with preserved shortcut conflicts. A live public GitHub discovery and install review also completed without installing the package.

Only layouts recorded as activated may be updated or removed. Older records without that evidence preserve existing layouts; matching source bytes do not establish ownership. The ownership follow-up passed 20 affected Python cases.

Physical input and additional sizing/theme combinations remain unverified for this release. The [implementation record](../docs/plans/mods-plus.md#review-and-direct-import-2026-11-06) retains the detailed results, earlier repairs and measurement limits.

Interaction references are [herdr-customize](https://github.com/wapenshaw/herdr-customize/blob/main/docs/app.md) for direct input and commit review, and [herdr-app-mod-manager](https://github.com/jacksonpires/herdr-app-mod-manager) for change review and shortcut preservation. This implementation uses its existing Python and GPUI code. It copies no code or assets from those projects and adds no runtime library.
