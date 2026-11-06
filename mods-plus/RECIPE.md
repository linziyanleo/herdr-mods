# Mods Plus

A comprehensive package manager dialog and entry mod for browsing, installing, enabling, updating, and removing community Herdr mods and layouts safely.

![Mods Plus](preview.png)

## What you see

- The sidebar footer shows Plugins above Settings and Add machine. Each row uses a 14px native icon, 13px text, 28px height and the native hover style. The 97px footer preserves update badges and hides labels when the sidebar is collapsed. The shortcut is preserved; there is no header entry.
- The dialog uses the native theme, 0.5px borders and four text sizes (12, 13, 16 and 28px). Mods / Layouts and All / Installed / Not installed occupy the first row.
- Community and Examples appear below with the official category counts. On the right, a settings icon sits immediately before search, followed by the Popular / Newest dropdown.
- Responsive one-to-three-column cards show a 16:10 preview, the author's avatar, title, author and stars. Installed and update markers sit at the right. Images load in batches of 24 as more cards are requested.
- Details show a large, uncropped preview above the title, author, stars and description. The adjacent Tell your agent box copies exactly its displayed installation prompt. GitHub links open the package's source folder. Package actions and the rendered recipe remain available below.
- Review update and Remove sit beside the detail title using the Herdr theme accent and matching foreground colors. Review install appears for an uninstalled package. The action group wraps below the title on narrow panels. Remove keeps its existing second-click confirmation and uses the theme warning color while confirming.
- Add from GitHub opens an inline native input with a Find packages action; Enter submits it. Results use the same cards and Mod/Layout tabs under Imported. A repository can yield several independently selectable packages.
- Reviews stay in details and hide the large preview to bring the changes into view. They show the source branch and commit, file additions/changes/removals, mod/layout changes, local edits and each proposed shortcut with any preserved conflict. Confirm, Refresh review and Cancel follow the list. The review uses 12px body text, a 16px heading and 0.5px borders in the current theme.
- Settings has an automatic-check switch and a custom interval: a positive whole number followed by min / hr controls. Enter or leaving the number field saves the interval; clicking a unit saves the final number/unit pair. Existing hour settings are preserved. Saving disables repeated actions and displays failures. Loading and checking use native rotating indicators.
- Plugins shows a right-aligned count of verified update candidates. The count refreshes after automatic or manual checks, application and removal. In the collapsed rail the count replaces the Plugins icon when updates are available.
- Card status occupies one line: Update Available replaces Installed when a candidate is available. Settings uses an arrow-only Back button. The footer count uses a 12px-high badge and 8px text, reduced at the user's request.

## How it behaves

- **Separation of Install and Activation**:
  - **Review install** reads a fresh file list and the proposed keys, without executing downloaded code or changing installations. Confirming **Install** downloads the reviewed files into `data/mods-plus/stage/`, runs `herdr-app check` on runtime mods, and saves verified files to `data/mods-plus/packages/<pkg-id>/`.
  - Files are kept outside `~/.config/herdr-app/mods/` and `layouts/` until the user explicitly selects **Enable** or **Use layout**.
  - A review token binds the commit, manifest, relevant records, active files and current shortcuts. Source or local drift requires another review. Activation rechecks name ownership and stored file hashes. Existing shortcut conflicts are preserved; added bindings are tracked, and later rebindings survive update/removal.
- **Direct sources**:
  - Accept public `owner/repo[/folder]`, `https://github.com/owner/repo`, and `/tree/<default-branch>/folder` URLs. Ref overrides, non-GitHub hosts, traversal, encoded paths and ambiguous branch URLs are refused explicitly. Use shorthand for a default branch containing `/`.
  - Find package roots by `RECIPE.md` plus runtime mods or layout JSON files; exclude nested packages from their parent's manifest. Every runtime mod folder needs `main.js`. Files are read via GitHub blob identities; commit identity is kept separately from the Git tree hash.
  - Install saves source metadata, the selected default branch, revision and file ownership in the existing package record. Checks continue to follow that recorded branch. Installed direct sources remain browsable during official catalog outages and reuse the existing enable/update/removal flows. Uninstalled discoveries remain local to the current dialog. Direct previews are omitted.
- **Automatic Association without Manual Adopt**:
  - Scans installed files in `mods/` and `layouts/`.
  - Associates a complete package only when every upstream runtime file matches its git blob hash. Additional local caches and attribution files do not invalidate the match and are not added to the ownership baseline.
  - Previously verified ownership survives local edits. A record without staged or active entry files is not treated as installed.
  - Same-name collisions remain untouched. An offline verification failure is unknown, excluded from both Installed and Not installed, with an explanation in details.
- **Reference-Safe Removal**:
  - Before removing a mod, inspects all local layouts (`layouts/*.json`).
  - If any layout references the mod, deletion is blocked and a cleanup prompt is provided.
  - If a layout is removed, companion mods used by other layouts or packages are retained.
  - A recoverable backup of managed files is stored under `data/mods-plus/backups/<pkg-id>-<timestamp>/`.
- **Protected Updates and 3-Way Merge**:
  - Update checks download candidates into `data/mods-plus/updates/<pkg-id>/candidate/`.
  - Candidates are validated with `herdr-app check`.
  - A three-way merge check compares baseline hashes, local active files, and candidate files.
  - Local edits are preserved. If a conflict occurs, the candidate is held back without touching active files.
  - **Review update** describes the prepared candidate. Applying verifies its exact file set/hashes and rechecks local state. The merged bytes are checked and written, including compatible layout edits, instead of discarding the merge result. Removed owned files are removed; unmanaged extra files are retained. Stored-only packages stay inactive. A prepared candidate can be applied at its reviewed commit even if upstream subsequently advances.
- **Scheduled Background Checks**:
  - While the layout with the Plugins entry is active, `cx.timer` checks for overdue work once per minute, supporting intervals as short as one minute.
  - Switching layouts or quitting Herdr pauses scheduling without background daemon services.
  - Up to four upstream lookups or package preparations run concurrently; packages sharing a source use one fresh tree lookup. A shared pool downloads up to eight files concurrently, including files within a single package. Checks bypass the catalog's cached tree. Failed packages are reported separately and never treated as up to date.
  - A completed check returns settings and verified candidate IDs together. Cards and the footer update in place without reloading the catalog or resetting the current search/filter.
  - Package mutations remain locked across helper processes. A lock timeout returns an error; it never proceeds unlocked. Settings reads and image downloads do not wait for package mutations.
- **Prompt Actions**:
  - The agent-tab activation prompt includes repository source, revision, installed paths, target app home, active layout name, recipe text, and validation instructions (`herdr-app check`).

## Built from

- **GPUI Elements**: `View`, `div`, `image`, `svg` from `gpui-kit`; `h_flex`, `v_flex`, `Input`, `InputState`, `Switch`, `TextView` from `gpui-base`.
- **Herdr APIs**: `exec`, `appHome`, `props`, `closeOverlay`, `notify`, `theme`, `window`, `run`, `knownAgents`, `shared`, `setShared`. Async settings and update actions receive the context from `cx.spawn`; native `spin` and opacity transitions provide feedback without animation timers.
- **Official Gallery**: `https://assets.herdr.dev/mods/index.json` and `https://assets.herdr.dev/layouts/index.json`. Examples use the cards embedded in `https://herdr.dev/mods/` and `https://herdr.dev/layouts/`, enriched with identities from those same indexes. Community previews use only the official moderated URLs; avatars use GitHub. Metadata is cached for one hour with stale-cache warnings on refresh failure. Search, status filters and sorting run locally.
- **Backend Helper**: `helper.py`, `catalog.py` and `review.py` (Python 3.8+ standard library, `urllib.request`, `subprocess`, `hashlib`, `shutil`, `fcntl`); `diff3` merges local text edits.
- **Network transport**: `curl` is required for official catalog, preview and avatar requests. GitHub file evidence uses the existing GitHub API client. No credentials are sent to the gallery or avatar endpoints.
- **Icons**: bundled Herdr SVGs rendered through native `svg()`; the star outline is an original local SVG.
- **Data Storage**: `<appHome>/data/mods-plus/` for `packages.json`, `settings.json`, `cache/`, `stage/`, `packages/`, `updates/`, and `backups/`.

## Watch out

- Never copy newly installed mods directly into `<appHome>/mods/` during installation; Herdr automatically docks new folders on appearance.
- Bundled Herdr mods and layouts (recorded in `installed.json`) must remain read-only and excluded from community package management.
- Always check layout references across all layout files before deleting any mod folder.
- Review is a concrete change list, not a security assessment. Community mods are trusted code. Preview runs no downloaded code; install confirmation and the existing update preparation stage run `herdr-app check`.
- Direct import currently refuses repositories containing symlinks or submodules, and supports no non-default ref override. GitHub availability is required for discovery and fresh installation reviews. The recorded branch is retained if the repository later changes its default branch.

## Done when

1. `herdr-app check mods-plus/mods/mods-plus` passes.
2. `python3 mods-plus/tests/helper.test.py` passes.
3. `python3 mods-plus/tests/acceptance.test.py` and `python3 mods-plus/tests/catalog.test.py` pass.
4. The Plugins row renders above Settings, and the header has no duplicate entry.
5. The dialog opens via the button and via `Cmd+Shift+X`.
6. Catalog browsing, Mod/Layout tabs, and All/Installed/Not-installed filters work smoothly.
7. Install stages files safely without premature activation.
8. Enable and Use layout integrate the package correctly.
9. Prompt copy and Agent tab launch functions work as expected.
10. Mod removal is protected when layouts still reference the mod.
11. `python3 mods-plus/tests/updates.test.py` and `node --test mods-plus/tests/ui.test.cjs` pass (Node.js 18+ is needed only for the UI event tests).
12. `python3 mods-plus/tests/review.test.py` passes for multi-package discovery, preview without installation writes, invalid source rejection, revision/local drift, shortcut preservation, persisted sources, actual merges and stored-only updates.
13. In an isolated native home, enter a source, select both package kinds, cancel and refresh reviews, confirm install, enable separately, review/apply an update and remove it. Inspect narrow/wide and light/dark states plus a `herdr-app shot` screenshot. `tests/native-fixture.mjs` prepares the home without launching it; `tests/native-verify.mjs` drives its production handlers after the coordinating agent launches it. Pointer/keyboard acceptance is separate from handler automation.

## Review and import verification (2026-11-06)

On macOS 27.2 with Herdr 0.1.13, the source and disposable review-render checks pass. The Python suites cover 36 cases and the Node event suite covers nine. Nine native production-view/helper checks passed in an isolated home, covering discovery through reviewed install, activation, update and removal, with conflict/local-drift preservation and no runtime errors. The current preview is an inspected native install-review capture. Live public GitHub discovery and read-only manifest review also passed without installation. Physical pointer/keyboard dispatch and additional sizing/theme combinations remain unverified; no real user package or shortcut was changed.

UX references: [herdr-customize app documentation](https://github.com/wapenshaw/herdr-customize/blob/main/docs/app.md) for direct input and review of a specific commit, and [herdr-app-mod-manager](https://github.com/jacksonpires/herdr-app-mod-manager) for review and preserving shortcut conflicts. This implementation reuses Mods Plus's own Python/GPUI architecture; no source code or assets were copied from those projects and no new runtime library was added.

## Repair verification

The gallery type repair filters example cards by their official `data-type`, with a new examples cache key to discard previously mixed classifications. The repository preview is now encoded as PNG, matching its filename. The official Mods Plus index currently omits `previewUrl`; publishing the corrected asset and upstream gallery reprocessing are still required before the community card can display it. The client retains the official moderated-preview policy.

On 2026-11-03, Herdr 0.1.12 passed the source and installed runtime checks. All 15 Python tests passed. Live catalog and local installation readbacks were checked, and native gallery/details renders were inspected. The preview image was updated by the user. Full pointer/keyboard acceptance remains pending; see the [repair record](../docs/plans/mods-plus.md#gallery-repair-verification-2026-11-03). No real user package was installed, removed or updated during these checks.

The subsequent update-check repair passes 20 Python tests and four JavaScript event tests, including parallel preparation with a failed source, stale candidate cleanup, lock exclusion, expiring click contexts, settings refresh and automatic/manual badge synchronization. Source and installed runtime checks pass on Herdr 0.1.12. Live pointer and animation acceptance remains unverified: the window capture returned a stale frame and native clicks returned `noWindowsAvailable`. The existing preview is retained because that capture does not show the repaired UI. See the [update repair record](../docs/plans/mods-plus.md#update-check-repair-2026-11-03).

The custom-interval and download-concurrency follow-up passes 23 Python tests and six JavaScript tests. A native settings-render fixture checks the actual switch and interval controls, in addition to the normal source check. A live-network comparison in disposable app homes took 22.93s before and 6.44s after, with matching candidate revisions/hashes, the same 21 uncached blob requests, two verified candidates and no check errors. This is one paired measurement, not a network latency guarantee. See the [follow-up record](../docs/plans/mods-plus.md#custom-interval-and-check-latency-2026-11-03).
