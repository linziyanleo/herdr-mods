# Files Plus implementation plan

Status: the original package was implemented, installed locally and published to GitHub and the official Herdr community catalog on 2026-11-01. The original runtime source commit is `6e586be27e4b06bd3c962bfd02deb58a5a26577c`; its community recipe and preview were published in `bf9125e4414ae43ab1c43a0ba320e295160f7491`. The official catalog entry and served preview are verified below. The [follow-up](#follow-up-display-performance-motion-width-and-drag-to-agent) is implemented in separate feature commits; isolated native acceptance is in progress before loading it into the working Herdr. This follow-up has not been pushed.

The workspace launcher update below is verified locally and awaits installation and publication.

The [Files Plus recipe](../../files-plus/RECIPE.md#folder-context-and-saved-workspaces) defines the workspace config format and persisted shared-state contracts. This plan also defines how `files-plus` optionally hands off rich previews to [Preview Plus](preview-plus.md) while remaining usable on its own.

## Goal

Provide one Files panel (`files-plus`) that combines single-folder browsing, workspace folder browsing and management, read-only source previews, a complete right-click file manager context menu, and optional view handoff to `preview-plus`.

## Design

- Keep the file tree, workspace helpers and config handling in `files-plus/mods/files-plus/`. Retain lazy loading (500 per folder, 5,000 total), Git status marks, symlink handling, `watchFolder` plus 10-second refresh, and read-only `Editor` text preview.
- Keep `files-plus` and `preview-plus` independently installable:
  - **Installed alone**: `files-plus` replaces the Files block (`"mod": "files-plus"`). Clicking any text or Markdown file opens `files-plus`'s built-in read-only `Editor` preview.
  - **Installed with `preview-plus`**: when given `props.previewStack` (for example `{ "previewStack": "files" }` in a 2-child stack `files-plus-tree` + `preview-plus`), clicking `.md`, `.markdown`, supported images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`), or `.pdf` writes `{ file, root, on }` to `shared("preview-plus.target")[spaceId]` and calls `run("layout.select", { stack: props().previewStack, child: "preview-plus" })` to replace the panel view. Other text files stay in `files-plus`'s built-in `Editor` preview.
- Keep workspace actions (`+` Add folder in the header, and root right-click actions) directly in `files-plus`, using the persisted shared-state contract. No additional runtime mod is required for workspace browsing and root actions.
- Keep the context menu and action dialogs inside the `files-plus` runtime, selected by `props().role`:
  - default (no `role`): the Files panel (`place: "right"`, `size: 320`)
  - `role: "menu"`: pointer popup context menu with keyboard navigation (`↑`, `↓`, `Enter`, `Esc`)
  - `role: "dialog"`: centered modal dialog for name prompts (`New file…`, `New folder…`, `Rename…`) and `Move to Trash` confirmation

## Context menu and file actions

### Target and focus capture

Right-clicking a file, folder, or workspace root row captures both the clicked entry and the active terminal context before opening the popup overlay:

```ts
type MenuTarget = {
  space: string;
  path: string;                      // absolute path of clicked row
  kind: "file" | "dir" | "root";
  root: string;                      // owning workspace root or single-folder cwd
  physicalRoot: string;              // derived alias for Herdr's physical terminal cwd
  on: string | null;                 // null for local machine
  active: {
    pane: string | null;
    terminal: string | null;
    cwd: string | null;
  } | null;
};
```

Capturing `active` from `focused()` at right-click time ensures actions target the intended terminal pane even after the popup takes focus. Run asynchronous commands before closing a popup overlay, or hand them off to a dialog, so closing the popup does not cancel in-flight tasks.

### Menu actions

1. **Add to agent (`@`)**
   - Inserts an `@` file reference with a trailing space into `target.active` without pressing Enter. Disabled when the space has no active terminal pane.
   - **Workspace path resolution**:
     - When `target.active.cwd` is inside the same root and `target.path` is under `target.active.cwd`, format as `@<relativePath(target.active.cwd, target.path)> `.
     - When `target.active.cwd` is in another root or outside `target.root`, fall back to the absolute path `@<target.path> ` so cross-root references remain unambiguous.
     - Quote paths that contain whitespace.
   - **Delivery**: save `cx.read_from_clipboard()`, call `cx.write_to_clipboard(reference)`, focus the target pane with `run("pane.focus", { pane: target.active.pane })` (or `{ terminal: target.active.terminal }`), run `run("terminal.paste")`, and restore the previous clipboard text if present.

2. **Copy and Paste**
   - **Copy**: writes `{ path: target.path, kind: target.kind, on: target.on }` to `shared("files-plus.clipboard")`.
   - **Paste**: enabled when `shared("files-plus.clipboard")` holds an entry from the same machine (`on`). Pastes into the clicked directory/root, or into the clicked file's parent directory, using `exec("cp", ["-R", srcPath, destPath], { on })`.
   - **Collision and cycle handling**:
     - Refuse pasting a directory into itself or any of its descendants (`destDir === srcPath || destDir.startsWith(srcPath + "/")`).
     - When the destination directory already contains an entry with the same name (including Copy + Paste in the same directory), automatically pick the first available copy name (`name copy.ext`, `name copy 2.ext` for files; `folder copy`, `folder copy 2` for directories) instead of overwriting existing files.

3. **Copy path and Copy relative path**
   - **Copy path**: writes `target.path` to the system clipboard with `cx.write_to_clipboard`.
   - **Copy relative path**: writes `relativePath(target.root, target.path)` (`.` for a root row) to the system clipboard with `cx.write_to_clipboard`. Always resolves relative to the entry's owning root in both single-folder and workspace modes.

4. **Reveal in Finder / File Explorer**
   - Enabled for local spaces (`target.on === null`).
   - Runs `exec("open", ["-R", target.path])` on macOS, `exec("explorer.exe", [`/select,${winPath}`])` on Windows, or `exec("xdg-open", [dirname(target.path)])` on Linux.

5. **File and folder CRUD (`New file…`, `New folder…`, `Rename…`, `Move to Trash`)**
   - **New file… / New folder…**: opens `role: "dialog"` to prompt for a name and creates inside the clicked folder/root (or the clicked file's parent directory). Rejects empty names, path separators (`/` or `\`), `.` / `..`, and existing names.
   - **Rename…**: opens `role: "dialog"` pre-filled with the current base name and renames in place within the parent directory. Rejects existing names. Disabled on workspace root rows.
   - **Move to Trash**: opens `role: "dialog"` to confirm, then moves the entry to the user's Trash on local macOS (`~/.Trash` with non-colliding name) or removes it after confirmation. Disabled on workspace root rows.
   - Refresh the affected parent folder and git marks after any mutation.

6. **Workspace root actions** (shown on workspace root rows)
   - **New terminal here**: starts a terminal in the captured root and space via `run("tab.new", { space: target.space, folder: target.root })`.
   - **Remove from workspace**: removes `target.root` from `shared("multi-root.spaces")` and updates the workspace file when mapped. Disabled when only one root remains.

## Implementation and verification

Implement the runtime under `files-plus/mods/files-plus/`:

- `main.js`: panel view, popup menu role, and dialog role
- `workspace.js`, `roots.js`, `config.js`: file tree, persisted workspace data, root addition/removal and right-click menu wiring
- `actions.js`: path formatting, `@` terminal insertion, collision-safe copy/paste, CRUD commands, and Finder/Explorer reveal

Verification scope:

1. Run `herdr-app check` on the installed `files-plus` runtime mod.
2. In a disposable two-root workspace and a single-folder space, verify:
   - `Add to agent (@)` inserts `@<relative-path> ` when the active pane is in the same root and `@<absolute-path> ` when the active pane is in the other root, without submitting Enter.
   - `Copy` and `Paste` in the same folder creates `name copy.ext` without overwriting; pasting into another folder copies the item; pasting a folder into its own subdirectory is refused.
   - `Copy path` and `Copy relative path` copy the expected absolute and root-relative paths.
   - `New file…`, `New folder…`, `Rename…`, `Move to Trash`, and `Reveal in Finder` act on the clicked target and refresh the tree.
   - Standalone mode previews text/Markdown in the built-in `Editor`; when `previewStack` is configured with `preview-plus`, clicking `.md`, image, or `.pdf` switches to `preview-plus` and `←` returns to the same tree.
3. Check `herdr-app status` for zero mod/layout errors and capture a screenshot with `herdr-app shot` for `files-plus/preview.png` and `files-plus/RECIPE.md` when implemented.

## Implementation and acceptance

The user's 2026-11-01 requests authorize Files Plus development and testing on `mod/file-plus`, local `main` integration and installation in Herdr, then community publication. Implementation used `/Users/fanghu/Documents/Work/.agent-worktrees/file-plus/herdr-mods`, based on local main `6b715689e7062528627e6813f048575f36be6377`. Other task worktrees remain untouched. The publication scope includes the necessary commits, main integration and push to the existing public repository.

The independently installable runtime is under `files-plus/mods/files-plus/`. It contains the file tree, configuration and read-only editor, plus `actions.js`, internal menu/dialog roles and a Radix palette, and retains the shared workspace format. See [the recipe](../../files-plus/RECIPE.md) for installation and the final behavior.

Implementation decisions:

- Keep all entry and expansion keys absolute in both modes. Workspace focus changes retain the tree and preview. Match a declared root's physical alias when formatting terminal references, because Herdr reports physical cwd paths.
- Capture the active terminal before opening the popup. Yield through the native executor after focus and paste commands so the terminal consumes the temporary clipboard before its previous text is restored. Execute asynchronous actions before closing their owner.
- Use non-overwriting file commands, explicit confirmation for removal, lexical and physical directory-cycle checks, and expected-text workspace writes. Preserve unknown configuration fields and reject a changed or closed captured workspace.
- Bound tree and source loading, reject stale preview/receiver results, and retain the existing editor when preview bytes have not changed. A configured but absent Preview Plus receiver falls back to source preview.
- Give the popup a content-derived height. A percentage height in a pointer popup can collapse to a line even when the mod checker and action methods pass; the native screenshot is the verification for this layout behavior.

Verification on macOS with installed Herdr 0.1.11 and Node.js 22.23.4:

- 26 automated tests pass using `node --experimental-vm-modules --test files-plus/tests/*.test.mjs`. File operations use real disposable directories and POSIX commands; only the host APIs are adapted for Node. Coverage includes references and physical aliases, clipboard restoration, copy naming/cycles/symlinks, CRUD and Trash, machine routing, conflict-safe workspace updates, bounds, missing/binary previews, retained editor state and stale handoff ordering.
- Native `herdr-app check` passes for the source and installed disposable runtime. Initial acceptance uses a separate app home; normal-home installation acceptance is recorded below.
- 12 native acceptance groups pass in `/tmp/fp.bgRLqL`; report: `/tmp/fp.bgRLqL/native-report.json`. These exercise actual GPUI views and filesystem/clipboard/terminal APIs: source preview, file/folder creation, rename and collision errors, same-directory and cross-directory copy, cycle refusal, path copying, two-root focus retention, precise same-root/cross-root terminal bytes with no Enter, root dialogs/menus, configuration preservation/conflicts, Trash/Finder and standalone root-terminal launch.
- Optional pairing passes in the same native session using a minimal receiver fixture: Markdown, PNG and PDF targets select the receiver; its back command returns to the existing tree with expansion retained; ordinary text stays in the source editor. Report: `/tmp/fp.bgRLqL/native-pair-report.json`. This proves the Files Plus protocol and stack integration, not Preview Plus's future renderer.
- Actual screenshots cover the source editor, name-conflict dialog, Add folder dialog, trees and context menu. Final popup sizing and light/dark appearance were checked separately after the correction above. The distributed `files-plus/preview.png` is captured directly from the disposable native window. `herdr-app status` reports zero mod/layout errors.

Remaining acceptance boundaries: the real system folder picker was opened and cancelled during local installation acceptance. Adding a new root through native confirmation and focus-switching during that selection remain manual checks. Success, cancel, duplicate and external-edit behavior of the root-update helpers is automated. Windows, Linux and remote-machine native interaction remain unverified. Preview Plus rich rendering remains its separate planned implementation.

Final package checks found no syntax, whitespace or documentation-link errors. All 11 runtime files match the checked disposable installation. App-generated IDE files are excluded from the package. The native test app and its separate core were stopped after capture; evidence under `/tmp/fp.bgRLqL` is retained for review.

### Local installation acceptance

- Runtime commit `6e586be27e4b06bd3c962bfd02deb58a5a26577c` was fast-forwarded into local `main` before installation. The runtime in `~/.config/herdr-app/mods/files-plus/` matches all 11 committed source files. Tests, screenshots and generated IDE files were not copied as installation inputs.
- The existing personal `main-graph` layout retains its node tree and block ids. Only `files.content.mod` changed to `files-plus`. The existing Files panel is shown and selected. Shortcut bytes and other runtime mods are unchanged.
- The original layout and installation metadata are saved under `~/.config/herdr-app/backups/files-plus-20261101-121208/`. To roll back, restore `layouts/main-graph.json` from that backup and remove only the newly added `mods/files-plus/` directory.
- `herdr-app check ~/.config/herdr-app/mods/files-plus` passes. Live `herdr-app status` has no mod/layout errors. Native UI checks exercise the actual file right-click menu, Escape, README source preview and Back, plus the Add folder dialog and system picker cancellation. The selected space remains a single-folder space after cancellation.
- `/tmp/herdr-files-plus-installed-20261101.png` captures the installed panel in the person's running window. It is local evidence; the distributed preview remains the disposable-fixture capture.
- The development branch/worktree is retained for this active conversation. Local `main` is the installed source. The subsequent community publication request also authorizes remote delivery.

### Community publication

The publication target is the existing public repository [linziyanleo/herdr-mods](https://github.com/linziyanleo/herdr-mods), default branch `main`. Its `herdr-mod` topic is already present. The user authorizes the required commits, main integration and push for Files Plus publication.

`files-plus/RECIPE.md` follows the installed guide's five sections and now includes the portable workspace schema, shared-state contracts, context and lifecycle rules, installation steps and observable acceptance checks. It can guide a build from an empty folder without local test receipts or workstation-specific installation notes. The package includes the 11 runtime files, recipe, preview and license notices, with no `layouts/` folder and no required key snippet.

The public preview was recaptured with `herdr-app shot` in a disposable Herdr 0.1.11 home and core. It shows the native two-root tree and file context menu without a terminal or personal content. The unedited PNG is 1840 × 1300, retains native sRGB with no gAMA override, and has SHA-256 `7953dccab9320f6f03d5321f8094ab4434598e436342414eefbfda62fdfc2cfc`. Native `check` passes and the capture window reports zero errors; runtime files are unchanged from the accepted implementation.

Herdr's [sharing instructions](https://herdr.dev/mods/) discover public repositories with the topic and screen community previews before display. Catalog acceptance was checked against the live index and the exact image referenced by the Files Plus entry.

GitHub delivery is verified at publication commit `bf9125e4414ae43ab1c43a0ba320e295160f7491`: the repository is public with topic `herdr-mod`, and all 13 published recipe/preview/runtime artifacts match their Git blobs. The public raw PNG is byte-identical to the local preview, with SHA-256 `7953dccab9320f6f03d5321f8094ab4434598e436342414eefbfda62fdfc2cfc`.

The official [catalog index](https://assets.herdr.dev/mods/index.json), generated at `2026-11-01T05:00:16.267Z`, lists `files-plus` as **Files Plus**, with `modNames: ["files-plus"]`, `hasKeys: false`, `hasPreview: true` and repository head `da98d11b87f703b36709ee9811100e617d1b0682`. Its [served preview](https://assets.herdr.dev/previews/7953dccab9320f6f03d5321f8094ab4434598e436342414eefbfda62fdfc2cfc.png) was downloaded and inspected. It is byte-identical to the published 1840 × 1300 PNG, with the same SHA-256 above. Both the community entry and its new preview are confirmed visible.

### Workspace launcher update (2026-11-01)

The root menu now offers **New terminal here** and starts the terminal directly in the captured space and root. Workspace browsing and root actions are self-contained. Existing workspace files and persisted shared-state keys remain compatible.

Verification: all 27 automated Files Plus tests pass, including launch targeting after focus changes with an old launcher installation present. Source and disposable-installation `herdr-app check` pass. An isolated native Herdr window shows both saved workspace roots and the updated menu; the new terminal's physical cwd matches the selected root, its space is correct, and workspace bytes and mappings remain unchanged. The window reports no mod or layout errors. Evidence: `/tmp/fp.1WL0m8/retirement-report.json` and `/tmp/fp.1WL0m8/root-menu.png`. All 38 local Markdown link targets resolve and `git diff --check` passes.

Delivery is limited to a local source commit. The normal app home and community catalog are outside this update's scope.

## Follow-up: display, performance, motion, width and drag-to-agent

Status: implementation authorized on 2026-11-02, including feature commits, local main integration and normal-home installation with `props.fit`. The accepted behavior and contracts above stay in force unless an item below explicitly changes them.

This plan was checked against Herdr 0.1.11 using `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts`, the runtime at `files-plus/mods/files-plus/`, the sibling `preview-plus`, `git-graph` and `spaces` mods, and the installed `main-graph` layout. In `main-graph`, the `files-plus-tree` block sits in stack `files`, then stack `panel-body`, inside column `panel` (`px: 368`, `min: 280`, `max: 900`) to the right of `main` (`tab: "active"`).

### Settled design decisions

1. **Adaptive width direction and menu text width**: panel width grows and shrinks after user-initiated actions (expand, collapse, space/workspace switch), and **only grows (never shrinks)** after background `watchFolder` or poll refreshes. Both the panel and the context menu calculate their width from the maximum calibrated width across **all** of their text elements.
2. **Manual resize override**: dragging the layout divider pauses automatic width fitting in the current space until the space or workspace context changes.
3. **Window-proportional maximum width**: `fit.max` supports a window-width ratio (`0 < max <= 1`, default `0.38`) resolved from `globalThis.window.viewport_size()` with app-zoom normalization, minimum main-workspace protection and a pixel fallback.
4. **Context menu window boundary**: adopt Option A — exact content-derived width and height with `frame: "none"` plus edge-clamped `at: { x, y }` coordinates so menus near the right or bottom window edge stay fully visible inside Herdr.
5. **Drag to Agent (`@`)**: dragging a file, folder or workspace root row out of `files-plus` into the workspace / terminal / Agent area inserts its `@` reference into the active Agent or terminal pane without submitting Enter.

### Baseline findings before the follow-up

| Area | Evidence | Effect |
| --- | --- | --- |
| Tree rendering | [`rows`](../../files-plus/mods/files-plus/workspace.js#L197-L212) builds every expanded row, up to 5,000, with fresh `on_click` and `on_mouse_down` closures on every [`renderPanel`](../../files-plus/mods/files-plus/workspace.js#L213-L253). Herdr re-renders root views after every live data change, including focus, agents, terminals and shared state. | Cost grows with expanded entries rather than changes, and agent status ticks in other panes rebuild the entire tree. |
| Periodic refresh | [`initPanel`](../../files-plus/mods/files-plus/workspace.js#L38-L43) refreshes every 10 seconds, including while hidden. [`refresh`](../../files-plus/mods/files-plus/workspace.js#L83-L135) runs `describeRoots` (one `sh` and one `git rev-parse` per root), lists every expanded folder sequentially, runs `git status` for each repository and always calls `cx.notify()`. | Background process churn and full redraws even when nothing on disk changed. |
| Watch events | [`watch`](../../files-plus/mods/files-plus/workspace.js#L44-L56) ignores the changed paths that `watchFolder` returns and starts a full refresh. Bursts are coalesced only while a refresh is running. | Build output or `node_modules` churn under a root repeats the whole refresh. |
| Budget accounting | [`loadFolder`](../../files-plus/mods/files-plus/workspace.js#L75-L82) sums every loaded folder on each folder load. | Quadratic recounting across expanded folders during refresh. |
| Menu size | [`renderMenu`](../../files-plus/mods/files-plus/main.js#L91-L115) computes a height, while [`menu`](../../files-plus/mods/files-plus/workspace.js#L193-L196) opens a hardcoded 272 × 360 or 272 × 428 overlay. File menus need ~339 px and root menus ~411 px; width ignores actual item and error text lengths. | Trailing blank space, unexpected scrolling when the 64 px busy/error block appears, and potential label truncation at fixed 272 px. |
| Visual details | Header controls use text glyphs (`←`, `+`) and Back has no hover state. Root rows are 30 px while entry rows are 28 px. The opened file is not highlighted in the tree. Herdr's overlay frame wraps a menu that already paints its own `popover` surface. | Uneven row rhythm, lost visual context on returning from preview, and non-concentric outer/inner corner radii. |

### Platform constraints that shape the plan

- **The context menu cannot extend beyond the Herdr window through a documented API.** `openOverlay` (`dialog`, `popup`, `window`) draws inside the app window, and `Popup` / tooltips clamp inside window edges. Neither `herdr.d.ts` nor `gpui-kit.d.ts` exposes a native OS menu (`NSMenu`) or secondary OS window.
- **Coordinate units vs app zoom.** `globalThis.window.viewport_size()`, `on_size_change` and pointer events (`event.position`, `event.local_position`, `event.bounds`) report window points, whereas builder dimensions (`.w()`, `.h()`), `openOverlay({ width, height })` and `run("layout.resize", { px })` scale by `settings().zoom || 1` (verified in `preview-plus` and `git-graph`). Import `window` from `"herdr"` as `appWindow` wherever `globalThis.window.viewport_size()` is read so the global `Window` handle is not shadowed.
- **Virtual lists vs per-row drag handlers.** `uniform_list` and `v_virtual_list` forbid handlers inside their row renderer (`on_mouse_down` throws), provide no `on_item_mouse_down`, and expose no sub-row pixel scroll offset on `VirtualListScrollHandle`. Computing a dragged row from wrapper `local_position.y` and `range.start` can therefore be off by one row whenever the list is scrolled mid-row. By contrast, retained child views (`cx.new`, `Entity`) inside a native `overflow_y_scrollbar()` container keep scrolling 100% in Rust (zero JS calls per scroll frame), skip rebuilds on unrelated live-data renders, and preserve exact per-row `on_mouse_down("left")` and `.transition(...)`.
- **Entity phase rule.** `cx.new`, `entity.set_props` and `cx.notify(entity)` are legal in `init`, event handlers and async tasks (`cx.spawn`, `cx.timer`), and throw if called synchronously inside `render`.
- **Cross-pane pointer tracking.** `on_mouse_move` is delivered only while an element is hovered, and `gpui-kit` exposes `on_mouse_down_out` but not `on_mouse_up_out`. However, GPUI hit-tests `on_mouse_move` and `on_mouse_up` against whichever interactive element is currently under the pointer (used by shipped `spaces` for cross-row drag reordering). Opening a full-window `frame: "none"` overlay once a drag crosses a small threshold inside `files-plus` lets `files-plus` track the cursor across the whole window and receive `on_mouse_up("left")` over the workspace area.
- **Motion is native and bounded.** `.transition(property, { duration, easing })`, `.spring(...)` and `.loop(...)` animate only `opacity`, `width`, `height`, `left` and `top` on subsequent target changes. Timers must never drive animation frames.
- **Panel width lives on a layout node.** `run("layout.resize", { id, px })` resizes a named layout node and persists it in `layouts/.state/`. Any resize reflows the terminals in `main`, so width changes must be debounced and never animated frame-by-frame.

### Work plan

Execute in five ordered phases. Each phase is independently testable and builds on the model from Phase 1.

#### Phase 1: performance

1. **Flattened row and width model (`tree.js`).** Add a pure `visibleRows(state)` returning `{ key, id, path, root, depth, kind, name, detail, mark, open, missing, selected, fresh }` for roots, entries and status/placeholder rows ("Loading files…", "No files", limit notice), cached behind a `treeVersion` counter.
2. **Retained chunked tree (`TreeView` + `RowChunk` entities).**
   - Create `this.treeView = cx.new(TreeView, ...)` once in `initPanel(cx)` and mount `.child(this.treeView)` inside `#files-plus`.
   - Partition `visibleRows` into retained `RowChunk` child entities of 100 rows inside a native `v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar()`.
   - Sync chunks from `initPanel`, pointer/key handlers, `cx.spawn` completions, and a coalesced `cx.timer.after(0, ...)` when external live state (`location().key`, active root, `settings().dark`, `shared(REVISION)`) changes during `renderPanel` — never calling `cx.new` or `set_props` synchronously inside `render`.
   - Unrelated Herdr renders (`agents()`, `terminals()`, other panes) rebuild **0** rows; scrolling enters JS **0** times per frame; expanding a folder or updating git marks rebuilds only chunks whose row signatures changed; every row keeps its stable `.id(...)` (`root-<path>`, `file-<path>`) and direct pointer handlers.
3. **Incremental refresh.**
   - Consume the changed paths returned by `watchFolder(rootPath)`. Map each changed path to its parent directory (ignoring `.git/` internal lock churn while routing `.git/HEAD` and `.git/refs/**` to git-mark refresh), debounce bursts over 200 ms via `cx.timer.after`, and reload only affected directories that are currently expanded.
   - Cache `describeRoots` (physical path and `git rev-parse --show-toplevel`) per context; re-run only on context change, workspace config reload, or missing-root recovery.
   - Throttle `git status` to at most once every 2 seconds per repository top-level, running after directory changes or fallback polls.
   - Keep the 10-second timer only for remote spaces (`on !== null`). For local spaces, use a 60-second safety poll that skips execution when the panel's last `on_size_change` reported zero width/height.
   - Diff newly fetched folder entries and `marks` against current state; increment `treeVersion` and call `cx.notify()` only when observable data changed.
4. **Bounded parallel listing and O(1) budget tracking.** Load expanded folders during initial/context refresh with concurrency 4, maintain a running `entryCount` map sum instead of recounting all folders in `loadFolder`, and preserve the 500-per-folder and 5,000-total caps.
5. **Cheap render path.** Evaluate `location()` once per render and pass it into `current(context, loc)`; reuse a module-level `Intl.Collator` for sorting.

#### Phase 2: display and auto-sized menus

1. **Shared text-width calibration (`metrics.js`).**
   - Render a hidden `absolute().opacity(0)` calibration probe in the panel with known ASCII and CJK sample strings at `13 px` and `12 px` (`flex_none()`), and read its rendered box via `on_size_change` normalized by `zoom = settings().zoom || 1`.
   - Compute per-unit widths (`unit13`, `unit12`, counting East Asian wide characters / emoji as 2 units and narrow ASCII as 1 unit, with safe defaults `7.6 px` / `7.0 px` before first layout or in headless tests). Recalibrate when `settings().font_family`, layout text size or `settings().zoom` changes, and cache the latest metrics in module state so overlay roles (`menu`, `dialog`, `drag`) read the exact calibrated values immediately on open.
2. **Header and tree rows.**
   - Replace text `←` and `+` with Lucide `arrow-left.svg` and `plus.svg` (covered by the existing Lucide license notice) inside consistent 24 × 24 px buttons with `hover` background and `muted` → `foreground` tint. Keep `Files` (13 px semibold) and the right-aligned context/file path (12 px `muted`).
   - Standardize both root rows and file/folder rows to `28 px` height and `18 px` indentation per depth. Highlight the currently previewed or last-activated file row with `t.selected`, preserving that highlight when returning from `Editor` or `preview-plus`.
3. **Auto-configured context menu width and edge-safe placement (Option A).**
   - Add pure `menuLayout(items, statusText, metrics, viewport, pointer, zoom)` beside `menuItems`.
   - **Width from all menu text elements**: compute the intrinsic width of every text element in the menu — each item's `label` at 13 px (plus `10 * 2` item horizontal padding and `5 * 2` menu padding) and any status/error line at 12 px (plus `8 * 2` padding) — and take their maximum plus a `4 px` rounding reserve, floored at `188 px` and capped at `Math.max(188, viewportLogicalWidth - 16)`. Pass this exact `width` and the exact `height` (items `32 px`, group dividers `8.5 px`, padding `10 px`, plus one reserved `24 px` status slot when needed so errors never force a scrollbar) to both `openOverlay` and `renderMenu`.
   - **Frameless concentric surface**: open with `frame: "none"` and draw Radix `popover` background, `0.5px` `border` outline, `10 px` outer radius and `5 px` item radius (`10 - 5 = 5`).
   - **Window-edge clamping**: when `globalThis.window?.viewport_size?.()` and `event.position` are available, clamp `at` in window points (`x = Math.max(8 * zoom, Math.min(pos.x, vw - width * zoom - 8 * zoom))`, `y = Math.max(8 * zoom, Math.min(pos.y, vh - height * zoom - 8 * zoom))`) so right-clicking near the bottom-right corner never clips.
4. **Content-fitted dialogs.** Compute dialog `height` per action (`new-file` / `new-folder` / `rename` vs `trash` / `add-root` / `remove-root`) and widen `width` (clamped `420`–`560 px`, bounded by viewport) from `TITLES[action]`, `target.path` and prompt copy using `metrics`. Keep Herdr's modal dialog frame.
5. **Radix palette.** Keep all colors in [`palette.js`](../../files-plus/mods/files-plus/palette.js), using step 11 for git-mark text and steps 3–4 for hover/selected row states.

#### Phase 3: motion

All motion uses GPUI's native `.transition` / `.loop` on `opacity` with `ease-out` and `250 ms` baseline (no timer-driven frames, no layout-reflowing width transitions):

| Moment | Implementation |
| --- | --- |
| Context menu and drag pill entrance | Root starts with `this.entered = false` (`opacity(0)`); a single `cx.timer.after(0, ...)` sets `this.entered = true` and notifies, driving `.opacity(entered ? 1 : 0).transition("opacity", { duration: 250, easing: "ease-out" })` across the whole `frame: "none"` surface. Dialogs apply the same fade to `#files-dialog`. |
| Folder expansion | Newly revealed child rows carry `fresh: true` for one frame (`opacity(0)` → `opacity(1)` with `250 ms` `ease-out` via a coalesced `cx.timer.after(0)` clear). Because Phase 1 uses retained `RowChunk` elements rather than recycled virtual-list cells, GPUI preserves each row's transition state by element `.id(...)`. Collapse removes rows immediately. |
| Tree ↔ source preview | Fade incoming `#files-tree` or `Editor` wrapper from `opacity(0)` to `opacity(1)` (`250 ms`, `ease-out`). |
| Loading state | `.loop("opacity", { from: 0.5, to: 1, period: 1200, easing: "ease-out" })` on `"Loading files…"` and `"Loading file…"`. |

#### Phase 4: content-fitted panel width (with window-ratio cap)

Configure opt-in panel fitting via `props.fit` so standalone installations never resize an unknown layout node without consent:

```json
{ "id": "files-plus-tree", "type": "block",
  "content": { "mod": "files-plus", "props": { "previewStack": "files", "fit": { "node": "panel", "min": 280, "max": 0.38 } } } }
```

1. **Intrinsic width across all panel text elements.** Using Phase 2's calibrated `metrics`, compute the maximum required logical width across:
   - the header bar (`Files` title, Back and `+` buttons, gaps, plus the right-aligned workspace/root `title` with a `24 px` separation floor),
   - every visible workspace root row (`8 * 2` padding, chevron `12`, folder `14`, gaps, `label(folder)` at `13 px` + `shortPath(folder.path)` / `"Not found"` at `12 px`), and
   - every visible entry or placeholder row (`8 + depth * 18 + 8` padding, chevron `12`, icon `14`, gaps, `entry.name` at `13 px`, git `mark` at `12 px`),
   plus tree container padding (`12 px`) and scrollbar gutter (`10 px`). Skip fitting while a source preview (`this.file`) is active.
2. **Window-proportional `max` calculation.**
   - Read `viewport = globalThis.window?.viewport_size?.()` during `renderPanel` and convert to logical pixels (`vw = viewport.width / zoom`).
   - Resolve `rawMax`: when `fit.max` is `<= 1` (default `0.38`), use `Math.floor(vw * fit.max)` (falling back to `560` when `viewport_size()` is unavailable); when `fit.max > 1`, use `fit.max` directly.
   - Protect the main terminal area: cap `effectiveMax` at `Math.min(rawMax, nodeMax, vw ? Math.max(effectiveMin, vw - sidebarPx - 360) : rawMax)`, where `sidebarPx` and `nodeMin`/`nodeMax` are read from `layout()` (defaulting to `min: 280`, `max: 900`).
   - Clamp desired width to `[effectiveMin, effectiveMax]`.
3. **Direction and settle policy.**
   - **User actions** (folder expand load settled, folder collapse, space/workspace switch): allow **both growing and shrinking**, debounced by `250 ms`, ignoring deltas `< 16 px` from current panel logical width.
   - **Background refreshes** (`watchFolder` reloads, periodic polls): **grow-only** (`desired > currentWidth + 16`); never shrink automatically on background file churn.
4. **Manual resize respect.** Record `this.lastRequestedWidth` and a short pending flag around `run("layout.resize", { id: fit.node, px })`. If `#files-plus`'s `on_size_change` reports a logical width differing from `lastRequestedWidth` by `> 4 px` with no resize pending, set `this.manualWidthSpace = this.spaceId` and pause auto-fitting until `this.context` changes. Only a visible panel (`size.width > 0 && size.height > 0`) may issue `layout.resize`.

#### Phase 5: drag file or folder to Agent (`@`)

Allow dragging any file, folder or workspace root row out of `files-plus` into the workspace / Agent / terminal area (for example, dragging left from `panel` into `main` or `sidebar` in `main-graph`, or dragging right when `files-plus` is docked on the left) to trigger `Add to agent (@)`.

1. **Target capture with active-tab Agent fallback.**
   - Update [`captureTarget`](../../files-plus/mods/files-plus/actions.js#L15-L19):
     - If `focused()` belongs to a **different** space (`f && f.space !== space`), keep `active: null` so cross-space isolation (and existing test expectations) holds.
     - If `f?.space === space && f.terminal`, use `{ pane: f.pane, terminal: f.shown || f.terminal, cwd: f.cwd }`.
     - Otherwise (for example `f === null` or `files-plus` itself currently holds keyboard focus inside `space`), inspect the active tab (`spaces().find(s => s.id === space)?.tabs.find(t => t.active)`) and pick from `panes()` in priority order: (a) the focused terminal pane in that tab, (b) a running Agent pane (`p.program?.agent && p.terminal`), or (c) the first terminal pane in that tab. This benefits both drag-to-agent and right-click `Add to agent (@)`.
2. **Press and threshold detection inside `files-plus`.**
   - On each tree row's `on_mouse_down("left", (event, cx) => ...)`: record `this.dragCandidate = { target: this.target(path, kind, root), start: event.position }` without stopping propagation, so normal clicks still work and `#files-plus`'s root `on_mouse_down("left")` receives the bubbled event and records `this.panelBounds = event.bounds` (the panel's exact `{ x, y, width, height }` in window points).
   - If `on_mouse_up("left")` arrives before pointer movement reaches `6 px` (in logical units, `6 * zoom` in window points), clear `this.dragCandidate` and let normal `on_click` open the file or toggle the folder.
   - On `#files-plus`'s `on_mouse_move`: once `this.dragCandidate` moves `>= 6 * zoom` window points, consume `dragCandidate`, set `this.suppressClick = true` (cleared on next press/click), and open a full-window transparent drag overlay:
     ```js
     openOverlay({
       mod: "files-plus", kind: "popup", frame: "none",
       width: Math.ceil(vw / zoom), height: Math.ceil(vh / zoom), at: { x: 0, y: 0 },
       props: { role: "drag", target, panelBounds: this.panelBounds, cursor: event.position }
     });
     ```
3. **Full-window drag overlay (`role: "drag"`).**
   - Renders `div().id("files-drag").size_full().relative().track_focus(this.handle)` with transparent background so every `on_mouse_move` and `on_mouse_up("left")` across the entire Herdr window lands on it.
   - Computes `outsidePanel = !inBounds(this.cursor, panelBounds)` and `canDrop = outsidePanel && Boolean(target.active?.terminal)`.
   - Applies `.cursor_copy()` when `canDrop`, `.cursor_no_drop()` when `outsidePanel && !target.active?.terminal`, and `.cursor_grabbing()` while inside `panelBounds`.
   - Draws a compact floating pill at `(cursor.x / zoom + 12, cursor.y / zoom + 10)` (clamped inside the window) with the file/folder SVG icon, `basename(target.path)`, and `@` badge (`t.popover` background, `0.5px` border in `canDrop ? t.blue : t.border`, `6 px` radius).
   - **Drop / cancel**:
     - `on_mouse_up("left")`: if `canDrop`, set `this.busy = true`, call `await insertReference(target, cx)` (inserting `@<relative-or-absolute-path> ` with Multi-Roots physical-alias resolution and clipboard restoration, without pressing Enter), then `closeOverlay(props().overlay)`; otherwise call `closeOverlay(props().overlay)` immediately with no side effect.
     - `Escape` (`on_key_down`) or right-click (`on_mouse_down("right")`): cancel and `closeOverlay(props().overlay)`.
4. **Known platform boundary and native verification gate.**
   - `herdr.d.ts` does not expose pixel rectangles for individual split panes in `panes()` or individual rows in `agents()`, so dropping anywhere outside `files-plus` routes to the captured active/Agent terminal of the shown tab rather than hit-testing split panes by `(x, y)`.
   - During Phase 5 native verification, test in a live Herdr 0.1.11 window that a single continuous press → drag across `panelBounds` → release fires `on_mouse_up("left")` on the newly opened `role: "drag"` overlay. If GPUI keeps an active mouse-button grab bound to the pre-overlay element until release, keep the same drag pill in `role: "drag"` and complete on click or fire `insertReference` when the held drag crosses the panel's outer edge (`local_position.x <= 4` or `>= width - 4`), recording the verified path in this document.

### Verification

- **Unit tests** (`node --experimental-vm-modules --test files-plus/tests/*.test.mjs`).
  - Extend [`runtime.mjs`](../../files-plus/tests/runtime.mjs) with `cx.new` / `Entity`, `cx.timer.after`, `transition`, `loop`, `opacity`, and optional `globalThis.window.viewport_size`.
  - Test `visibleRows` and chunk invalidation (unchanged chunks are not rebuilt; unrelated `renderPanel` calls rebuild 0 rows).
  - Test incremental `watchFolder` parent reload, `.git` lock filtering, 2-second `git status` throttling, and no-op diff suppression.
  - Test `metrics` + `menuLayout`: width grows to fit the longest item or error text across all menu entries, respects minimum/viewport bounds, reserves status space without scrolling, and clamps `at` near bottom-right window edges.
  - Test `fit` width calculation: header + root + indented file rows + CJK wide characters, `fit.max` ratio (`0.38`) with `settings().zoom` scaling and main-area reserve, grow+shrink on user toggle vs grow-only on background refresh, 16 px deadzone, and `> 4 px` manual-resize pause until context switch.
  - Test Drag-to-Agent: `< 6 px` movement preserves click preview/toggle; `>= 6 px` opens `role: "drag"`; releasing inside `panelBounds` or pressing `Escape` cancels without pasting; releasing outside `panelBounds` inserts the expected `@` reference and restores the clipboard; active-tab Agent fallback works when `files-plus` holds focus while cross-space focus still yields `active: null`.
- **Performance evidence.** On the 11 roots × 500 files fixture (5,000 entries expanded):
  - Measure `renderPanel` time and rebuilt row count on (a) an unrelated live-data re-render, (b) toggling a single folder, and (c) initial full render, over 20 runs in Node (reporting median, min/max, matching row count and zero errors).
  - Measure native scroll frame grading with `show_fps_monitor()` from `gpui-fps` and count idle `exec` spawns over 60 seconds before and after.
- **Native checks.**
  - Run `herdr-app check files-plus/mods/files-plus` and confirm `herdr-app status` reports zero mod/layout errors.
  - Capture `herdr-app shot` screenshots in light and dark themes covering: vector header icons, 28 px rows with active-file selection retained after preview Back, auto-sized file and root context menus at the bottom-right window corner, dialogs, proportional `fit` resize at 100% and zoomed scale, and the `role: "drag"` floating `@` pill + resulting terminal prompt text (with no Enter submitted).
- **Packaging.** Update `files-plus/RECIPE.md` (`props.fit` with ratio/px `max`, calibrated menu sizing, motion, drag-to-agent interaction, and single-window menu/pane hit-test boundaries) and recapture `files-plus/preview.png` when visual changes ship. Applying `props.fit` to personal `~/.config/herdr-app/layouts/main-graph.json` remains gated on explicit installation approval.

### Follow-up implementation and acceptance (2026-11-02)

The five feature commits implement retained tree chunks and incremental refresh, calibrated menus and vector controls, native opacity motion, opt-in panel fitting and Drag to Agent. Follow-up fixes preserve unchanged root-read errors without repeated redraws, discard superseded directory replies, invalidate reads on panel close and release the entry-limit state when folders collapse.

Herdr 0.1.11 has no `Intl`; sorting uses a module-level collator when available and the existing `localeCompare` behavior otherwise. Fully transparent probes do not receive native size callbacks, so calibration uses faint probes behind the opaque header. Menu padding includes its 0.5px border within the measured dimensions. The root-owned FPS HUD requires a ShellRoot absent from Herdr's window; native profiling uses the documented inline monitor.

The user's 2026-11-02 validation boundary is explicit: use one separate Herdr app home and core, close unneeded test windows, then install the accepted runtime into the working Herdr. Do not create verification layouts or spaces in the working instance. The native scripts validate the disposable home before issuing commands. The working runtime and original layout were restored while acceptance continues in `/tmp/fp.1FjNwc`.

Current evidence:

- All 42 runtime tests and `herdr-app check files-plus/mods/files-plus` pass. The isolated API acceptance report covers 12 groups of file, clipboard, terminal, preview and workspace actions, with no mod/layout errors (`/tmp/fp.1FjNwc/native-report.json`).
- The final JS benchmark alternates 20 fresh processes per side against `80ab6d9`, with 5,000 loaded entries and zero errors. Initial render median/range: 29.89ms [29.36, 35.01] before, 24.92ms [23.12, 26.95] after; unrelated render: 17.90ms [15.94, 22.19] before, 4.29ms [3.84, 4.71] after; collapse: 14.62ms [13.26, 18.00] before, 8.53ms [8.25, 9.28] after. Rebuilt rows are respectively 5,011/5,011, 5,011/0 and 4,511/100. These are JS builder/materialization measurements, excluding native layout, GPU and I/O; they do not establish scroll FPS (`/tmp/files-plus-followup-benchmark-final.json`).
- One settled native idle sample per side counted 330 program calls over 60.005s before and 18 over 60.077s after, with all 5,000 entries loaded and no mod/layout errors. The final safety poll was still running at the latter cutoff, so the count describes that interval, not the cost of a completed poll (`/tmp/fp.PmLY5u/idle-performance.json`, `/tmp/fp.1psGvV/idle-performance.json`).
- Native width, theme/zoom screenshots, continuous drag/drop and scroll grading remain open. The isolated window's input interface returns `cgWindowNotFound` / `noWindowsAvailable`; the width check has not passed and must be investigated in a controllable test window. Alternate macOS input requires the user's explicit selection under the computer-control tool's instructions. The public preview has not yet been recaptured. Do not install the candidate into the working Herdr until these acceptance checks finish.
