# Files Plus

Browse a single folder or every folder in a workspace in the Files panel. Right-click an entry to insert an agent reference, copy it, paste it, copy an absolute or relative path, reveal it in Finder or File Explorer, or create, rename and remove files. A persistent + adds workspace folders, and root entries offer a dedicated root menu to launch terminals or remove folders. Drag any file or folder to insert an agent reference into the active terminal or agent. Adaptive fitting sizes the panel to content, context menus fit their text within window edges, and entrance animations run smoothly via native transitions. High-performance retained row chunking and incremental change tracking keep scrolling and tree updates fast. Text and Markdown open as read-only source in the same panel with a back button, or hand off rich media seamlessly to Preview Plus.

![Files Plus](preview.png)

The preview is an unedited `herdr-app shot` from a disposable native Herdr window. All shown folders are test fixtures. Preserve the capture's sRGB metadata.

## What you see

The panel defaults to 320px wide; its actual size belongs to the layout. The 42px header holds Files, a 24px Add folder control (`plus.svg`) and a shortened folder, workspace or preview path. A preview adds a 24px back control (`arrow-left.svg`). Both controls use Lucide SVGs with hover backgrounds. All tree rows are 28px high with 18px of indentation per level, using Lucide folder, file and chevron icons. Roots show their display name and path, highlight the focused terminal's root, and show “Not found” for missing directories. The last activated file stays selected with a highlighted background after returning from preview. Git letters appear at the right of changed entries.

Dragging any file, folder or workspace root row at least 6px shows a floating `@` drag pill with the file or folder icon, entry basename and an `@` badge. When the pointer moves outside the Files panel, the pill updates its text to “Click to add @” with a copy cursor when a drop target is available, or a no-drop cursor when no terminal exists. The frameless floating overlay remains inside the Herdr window.

Pointer menus fit their longest label or status text using hidden 12px/13px ASCII/CJK calibration probes, with a 188px minimum and window-width cap. They use 32px rows, 8.5px separators and a reserved 24px status slot. Frameless 10px surfaces have 5px item radii, 0.5px borders and window-edge clamping in zoom-normalized coordinates so menus near the right or bottom edges remain fully visible. Errors widen and reopen the menu when needed. Name and confirmation dialogs fit the action and path, between 420px and 560px wide within the viewport. Use 13px body text, 12px secondary text and 14px dialog headings. Disabled actions are dimmed; errors and progress stay visible.

Colors come directly from Herdr's `theme()`, including custom color overrides. Panel and overlay surfaces, text, controls, selection, borders and Git marks use Herdr's semantic and ANSI colors. Text uses `settings().ui_font_family` and `ui_font_size` (13px by default); secondary text is 1px smaller, with a 12px minimum, and dialog headings are 1px larger. Source previews use Herdr's code font, code size and syntax colors. Retained rows and open previews update when the look changes, including switches between two dark themes. There is no independent Files Plus theme.

## How it behaves

### Tree browsing and virtualization

Folders load lazily, directories sort first, hidden entries are included and `.git` is omitted. Symlinks appear as files and are not recursively followed. Visible rows are flattened and partitioned into retained chunks of 100 rows in child views inside a native scrolling container. Scrolling executes entirely in native Rust with zero JavaScript calls per frame. Unrelated live updates (such as agent ticks or terminal output in other panes) rebuild zero tree rows.

Local safety polls run every 60 seconds while visible; remote folders poll every 10 seconds. Incremental filesystem watching via `watchFolder` maps changed paths back to their parent directories, debounces filesystem bursts by 200ms, lists at most four folders concurrently, and reloads only expanded affected folders. Internal `.git` lock churn is ignored, and Git status is throttled to once per repository every two seconds. Cached physical roots and repository discovery persist until context or config changes.

### Built-in source preview and Preview Plus handoff

Opening text replaces the tree with a read-only syntax-highlighted source editor (`EditorState` with `readonly: true`). Back returns to the existing expanded tree and restores row selection. File changes refresh the tree, Git marks and an open preview. An unchanged file and look keep the existing editor and scroll state. A code-font or syntax-color change recreates the read-only editor from its cached text because Herdr exposes these options only at construction. Switching terminal focus within a workspace preserves expansions and previews.

When paired with Preview Plus via `props.previewStack` in a layout stack, clicking `.md`, `.markdown`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` or `.pdf` publishes the target `{ file, root, on }` to `shared("preview-plus.target")[spaceId]` and selects `preview-plus` in that stack. Ordinary text stays in Files Plus's built-in source editor. If Preview Plus is absent or not installed, rich files gracefully fall back to the built-in source editor.

### Native motion and transitions

Menus, dialogs, newly expanded rows, the drag pill and incoming tree/source previews fade with native opacity transitions (`.transition("opacity", { duration: 250, easing: "ease-out" })`). Loading labels pulse natively over 1200ms via `.loop("opacity", { from: 0.5, to: 1, period: 1200, easing: "ease-out" })`. A single deferred callback changes each entrance target; timers never animate individual frames. Collapsing removes children immediately, and panel resizing has no animated reflow.

### Right-click file manager menu

Right-click captures the entry, owning root, physical alias, machine and active terminal before the popup takes focus. Up/down arrows navigate items, Enter chooses, and Escape closes. Long-running actions keep their owner open until they finish; errors remain visible.

- **Add to agent (@)**: pastes a reference plus a trailing space into the captured terminal without Enter. Uses a path relative to the terminal's cwd only when that cwd and the entry belong to the same root and the entry is beneath the cwd; otherwise uses the absolute path so cross-root references remain unambiguous. Quotes whitespace, quotes and backslashes. Matches physical terminal cwd paths against declared workspace-root aliases. Refuses an unavailable captured terminal. Preserves and restores previous clipboard text, including an empty string.
- **Copy and Paste**: Copy writes the entry path, kind and machine to `shared("files-plus.clipboard")`. Paste targets the clicked directory or a file's parent, requires the same machine, and automatically chooses `name copy.ext`, `name copy 2.ext`, or the corresponding folder name when a collision exists. Existing files are never overwritten. Rejects directory cycles, including local/POSIX symlink aliases into the source directory. Copies symlinks as links.
- **Copy path and Copy relative path**: Copy path copies the absolute path. Copy relative path resolves relative to the entry's owning workspace root and yields `.` for a root row.
- **Reveal**: opens Finder on macOS (`open -R`), File Explorer on Windows (`explorer.exe /select`), or the local Linux file manager (`xdg-open`). Remote reveal is disabled.
- **New file and New folder**: prompts for a name inside the clicked directory or file's parent via a modal dialog. Rejects blank names, `.`/`..`, separators, control characters and existing entries.
- **Rename**: prefilled modal dialog renaming in place within the parent directory. Rejects collisions. Workspace roots cannot be renamed from this menu.
- **Move to Trash**: prompts for confirmation. Local macOS entries move safely to `~/.Trash` with collision-safe naming. Other platforms and remote machines display an explicit permanent-deletion confirmation dialog.
- **Root actions**: workspace root rows offer **New terminal here** (starts a terminal tab in the captured space and root) and **Remove from workspace** (removes the root from the workspace mapping without deleting files on disk; requires at least one root to remain).

### Drag to Agent (@) gesture

Drag a file, folder or workspace root at least 6px to show the floating `@` pill, then click outside Files to insert into the captured terminal without Enter. The pill shows “Click to add @” outside the panel. Click inside Files, Escape or right-click to cancel. Releases delivered to the floating surface also complete or cancel the operation; Herdr 0.1.11 can retain the original mouse grab, so click completion remains available.

When Files has keyboard focus, target capture inspects the active tab and picks in priority order: the focused terminal pane, then a running Agent pane, then its first terminal pane. Focus in another space never falls back. Herdr exposes no split-pane rectangles, so the drop destination is the captured terminal of the shown tab throughout the workspace area. The frameless floating overlay stays inside the app window.

### Multi-root workspaces and persistent + folder addition

Add folder works for local POSIX spaces, including ordinary single-folder spaces and preview headers. Captures the original space and displayed folder before opening the system picker. Cancel and duplicate selections leave data unchanged. Adding a different folder converts an ordinary space to an unsaved workspace, preserving its name, tabs and terminals.

Existing workspace files use a captured expected-text write: preserve path spelling, string entries, unknown fields and two-space formatting; new folders use relative paths. A conflicting disk edit reloads instead of overwriting the file. A closed or replaced target cannot be recreated by a late completion.

### Adaptive panel fitting

Set the panel block's props to `{ "fit": { "node": "panel", "min": 280, "max": 0.38 } }` to fit a known, named layout node. Without `fit.node`, Files Plus never resizes the layout. `max` is a window-width ratio for `0 < max <= 1`, or a logical pixel cap above 1; the default ratio is 0.38, with a 560px fallback when viewport dimensions are unavailable. Respect the node's own min/max and reserve 360px for the main workspace after the sidebar.

Measure the header and top-level rows with the same calibrated metrics as the menu, including icons, gaps and scrollbar space. Workspace mode measures root names and paths; single-folder mode measures direct entries. Expanded descendants never contribute to panel width, and long names truncate within the layout's width. Expanding and collapsing folders keep the divider in place. Debounce `layout.resize` by 250ms and ignore changes under 16px. Context changes may grow or shrink the panel; background top-level updates only grow it. Skip source previews and hidden panels. A divider resize differing from the last requested width by more than 4px pauses fitting until the space or workspace context changes. Normalize pointer and measurement coordinates by app zoom.

Agent working, blocked, done and idle displays remain the surrounding Herdr UI's responsibility.

## Built from

```text
files-plus/
  RECIPE.md
  README.md
  preview.png
  licenses/
  mods/files-plus/
    main.js, workspace.js, tree.js, metrics.js, fit.js, drag.js
    roots.js, config.js, actions.js, palette.js
    mod.json, file.svg, folder.svg, chevron-down.svg, chevron-right.svg, arrow-left.svg, plus.svg
  tests/
```

Create `mods/files-plus/main.js` with a default-exported class that extends GPUI `View`. Route `props().role`: absent for the panel, `menu` for a pointer popup, `dialog` for a modal name, confirmation or root action, and `drag` for the transparent full-window drag surface. Pass a captured target and an action into overlays. The overlay id comes from `props().overlay`.

Keep tree state, incremental local watchers, Git marks and read-only previews in `workspace.js`. `tree.js` flattens visible rows and retains groups of 100 rows in child views inside a native scrolling container. Unrelated live updates do not rebuild rows. Local safety polls run every 60 seconds while visible; remote folders poll every 10 seconds. Debounce filesystem bursts by 200ms, list at most four folders concurrently, and throttle Git status to once per repository every two seconds. Cache physical roots and repository discovery until context/config changes or missing-root recovery. Put path and workspace helpers in `roots.js`, guarded config saves in `config.js`, filesystem and terminal actions in `actions.js`, and Herdr color/typography adapters in `palette.js`. There are no cross-mod code imports. The package manifest is:

```json
{
  "place": "right",
  "size": 320,
  "cloned_from": { "name": "files", "version": "0.1.9" }
}
```

No `keys.json` snippet is needed. Bind menu arrows, Enter and Escape to its focus handle; keep ordinary terminal shortcuts unchanged.

The baseline is native Herdr 0.1.11. Use `cx.spawn`, `cx.timer`, `cx.sleep`, focus handles and clipboard APIs from GPUI; `EditorState`, `Editor`, `InputState`, `Input`, flex builders and SVGs from gpui-base/gpui-kit. Herdr provides live spaces/panes/focus/settings, `shared`, `setShared`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `pickFolder`, overlays and `run`. Commands are `pane.focus`, `terminal.paste`, `tab.new` and optional `layout.select`.

### Optional panel fitting

Set the panel block's props to `{ "fit": { "node": "panel", "min": 280, "max": 0.38 } }` to fit a known, named layout node. Without `fit.node`, Files Plus never resizes the layout. `max` is a window-width ratio for `0 < max <= 1`, or a logical pixel cap above 1; the default ratio is 0.38, with a 560px fallback when viewport dimensions are unavailable. Respect the node's own min/max and reserve 360px for the main workspace after the sidebar.

Use the top-level measurement and stable folder-expansion behavior described in **Adaptive panel fitting** above. Keep ratio/pixel caps, zoom normalization and manual divider overrides.

### Folder context and saved workspaces

In single-folder mode, use the active terminal's live `cwd`, then the active space's folder as fallback. Carry its machine name as `on`, with `null` for this computer. Include the space, cwd and machine in the context key. A changed context resets the tree and preview. Use absolute paths for entry, expansion and Git-mark keys in both modes.

A workspace is a local non-Windows space with a mapping in `shared("multi-root.spaces")`. Its folders replace the single cwd as the browsing roots. Keep expansion and preview state when terminal focus moves between those roots. Match the longest declared or physical root against the focused cwd when highlighting a root or formatting a reference.

Read portable workspace files named `<name>.herdr-workspace.json`:

```json
{
  "name": "Product",
  "folders": [
    { "path": "./web", "name": "Web" },
    { "path": "./api", "name": "API" },
    "./notes"
  ]
}
```

Require a `folders` array of path strings or objects with `path` and optional display `name`. Resolve relative paths from the config directory, expand `~`, normalize `.` and `..`, and keep the first occurrence of each resolved path. Keep missing roots visible. A missing workspace name defaults to the filename without its suffix. Invalid JSON or invalid fields preserve the last valid mapping and expose an error.

Use these persisted shared contracts. Compare values before writing, because a shared write redraws every mod:

```ts
"multi-root.spaces": Record<SpaceId, {
  name: string;
  file: string | null;
  folders: { name: string | null; path: string; source: string }[];
  error?: string;
}>
"multi-root.recent": string[]
"files-plus.clipboard": { path: string; kind: "file" | "dir" | "root"; on: string | null }
"files-plus.revision": number
"preview-plus.target": Record<SpaceId, { file: string; root: string; on: string | null }>
```

`path` is resolved and absolute; `source` retains the declared spelling. `file: null` denotes an unsaved workspace. Retain the ten most recent saved config paths. Prune closed workspace mappings only when `machines()` reports the local layout as ready.

Before a root action, capture the space and the config text. Preserve original string entries, path spellings and unknown fields when saving. Write new roots relative to the config directory, using two-space JSON and a trailing newline. Call `writeTextFile(file, text, expectedText)` once. If the expected text is stale, reload and report the conflict without retrying the write. Check the captured mapping before changing it; a late completion must not recreate a closed space.

### Loading and actions

Store loaded directories in a map and expanded folders in a set. Load a directory only when expanded. Share the 5,000-entry budget across roots, sort directories first, and do not traverse symlinks. On POSIX, list names with NUL delimiters so whitespace and newlines remain names. On Windows, use PowerShell literal-path operations. Read Git porcelain status per distinct repository and translate its paths back to declared root paths.

Use `watchFolder` on local roots and the config directory. Reload the config only for changes to its file. Poll remote folders through the 10-second refresh. Guard all asynchronous results with the captured context and request identity. Build `EditorState` with `readonly: true`; retain the existing editor if preview bytes have not changed. Handle missing, binary, unreadable and oversized files as visible states.

Capture `{space,path,kind,root,physicalRoot,on,active:{pane,terminal,cwd}|null}` before opening the popup. The physical root is derived data, never a saved workspace field. All actions use this target rather than the popup's current focus. For agent insertion, save the clipboard text, focus the captured terminal, yield with `cx.sleep(0)`, paste the quoted reference, yield again, then restore previous text if present. `run()` returns no completion result, so restoring the clipboard before that yield can paste the wrong bytes.

Use `cx.spawn` for slow work. Create focus handles, inputs and editors in `init`, events or asynchronous tasks, never during `render`. Each callback uses its own context. Release retained inputs and editors when the view closes. Keep an asynchronous menu action alive until completion, or transfer it to a dialog before closing the menu.

### Dependencies and access

POSIX operations use `sh`, `cp`, `mkdir`, `mv` and, after explicit confirmation outside local macOS Trash, `rm`. Git marks use Git with `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`. Windows retains PowerShell folder listing and file commands. Reveal uses `open -R`, `explorer.exe /select,…` or `xdg-open`. These programs receive paths as arguments, not interpolated shell source.

The mod reads workspace directories and text files, writes only requested filesystem mutations and workspace-config updates, and reads optional mods' `mod.json` to detect their presence. Local macOS Trash uses the person's `~/.Trash`. Remote filesystem calls carry the captured `on` machine. No service credentials, network services, Node.js, DOM or `setTimeout` are used by the runtime. Node.js 22+ and Python 3 are development/test dependencies only.

### Installation

1. Read the installed Herdr guide. Use `HERDR_APP_HOME` when set, otherwise `~/.config/herdr-app`.
2. Check for a `mods/files-plus` name conflict. Copy only runtime `.js`, `.svg` and `mod.json` files; keep the third-party licenses with the distributed package. Leave tests, generated `.d.ts`, `jsconfig.json`, recipes and screenshots out of the runtime.
3. To replace an existing Files block, initially install with `place: "none"`. In a personal layout, set the block's `content.mod` to `files-plus`, retaining its id. Restore the packaged manifest after the block uses the new mod. This avoids a second automatically docked copy. Clone a bundled layout before editing it. No other mods or shortcut changes are required. To undo, restore the previous reference.
4. Run `herdr-app check <app-home>/mods/files-plus`, inspect `herdr-app status`, then try the actual panel.

### Optional Preview Plus pairing

Files Plus works alone. Preview Plus is an available separate package; installing Files Plus does not install it. To pair them, preserve the existing outer Files id and turn that node into this stack:

```json
{
  "id": "files", "type": "stack", "active": "files-plus-tree",
  "children": [
    { "id": "files-plus-tree", "type": "block", "content": { "mod": "files-plus", "props": { "previewStack": "files" } } },
    { "id": "preview-plus", "type": "block", "content": { "mod": "preview-plus", "props": { "previewStack": "files" } } }
  ]
}
```

With both the prop and installed receiver, `.md`, `.markdown`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` and `.pdf` publish the captured target and select `preview-plus`. Ordinary text stays in Files Plus. The receiver returns with `layout.select {stack:"files",child:"files-plus-tree"}`. Files Plus retains its expansions while hidden. Without the receiver, fall back to source preview. Stale asynchronous reads and receiver checks cannot replace a newer selection or another space.

### Attribution

The Files tree, editor and SVGs derive from [Herdr files 0.1.9](https://github.com/herdrdev/herdr-app) (Apache-2.0). Preserve [the Herdr license](licenses/Herdr-APACHE-2.0.txt) and [Lucide/Feather notices](licenses/Lucide.txt). This retains third-party terms and does not choose a repository license.

## Watch out

Keep the inherited limits: 500 entries per folder, 5,000 loaded entries across all roots, 40 nested tree levels, 400,000 preview characters and Herdr's 1 MiB text-read ceiling. Binary, missing, unreadable and oversized files show explicit source-preview states. Preview Plus owns rich rendering, links, images and PDF conversion.

Workspace management supports local POSIX spaces; Windows and remote spaces retain single-folder browsing. Windows/Linux/remote native interactions need verification on those systems. Clipboard operations can restore previous text, but not a previous non-text clipboard. Tests do not install into the person's normal app home, replace their layout or change shortcuts.

## Done when

Build and exercise these observable behaviors using disposable folders:

1. `herdr-app check <app-home>/mods/files-plus` passes. The single-folder tree handles loading, empty, unreadable and missing states, hidden names and symlinks. Expanded directories respect the per-folder and total limits.
2. Text and Markdown open as read-only source. Back returns to the same tree. Binary, absent and oversized files show their own states. A file edit refreshes the preview; unchanged bytes retain the editor state.
3. A two-root saved workspace shows both trees, root names, Git marks and missing roots. Focus changes retain expansion and previews. An invalid config keeps the last valid roots with a visible error.
4. Same-root and cross-root agent references reach the captured terminal with the correct quoting and trailing space, without Enter. Previous clipboard text is restored. A closed terminal is refused.
5. Copy and Paste preserve the source and choose available copy names. A directory cannot be pasted into itself or through a symlink into a descendant. Cross-machine paste is disabled. Absolute and relative path copying uses the clicked entry's owning root.
6. New file, New folder, Rename, Trash confirmation and local reveal act on the clicked target and refresh the tree. Invalid or existing names are refused. Cancelling a dialog writes nothing. Root rename and deletion remain disabled.
7. The native folder picker can confirm and cancel. Duplicate selections leave the workspace unchanged. A different root extends the captured space even if focus moves elsewhere. Saving preserves custom fields, and a conflicting disk edit is not overwritten.
8. Root actions retain one root, leave removed roots' files intact, and launch a terminal in the captured root and space.
9. With a compatible Preview Plus receiver and stack, rich targets switch the panel and Back restores the existing tree. Ordinary text stays in the source editor. Missing receivers fall back to source; stale requests cannot replace a later selection. Rich rendering itself belongs to Preview Plus.
10. `herdr-app status` reports no mod or layout errors. Capture the running panel with `herdr-app shot preview.png`. Use disposable content and retain the native PNG color metadata. Ship this folder without a `layouts/` directory or unused key bindings.
11. Unrelated live updates rebuild no retained rows. Watches reload only expanded affected parents, lock churn does no work, unchanged data does not redraw, and loaded entries never exceed the budget.
12. Both menu kinds fit their text and remain inside window edges at 100% and zoomed scale. Herdr themes, color overrides and UI/code fonts apply to the panel, overlays and an already open source preview, including same-appearance theme changes. Selection persists after Back. Opt-in fitting keeps width stable on folder toggles and respects ratio/pixel caps and manual divider overrides.
13. A short press remains a click. Drag to show the pill, then click outside Files to insert one reference without Enter and restore clipboard text; clicking inside, Escape and right-click cancel. Check direct release delivery on the installed Herdr version and retain click completion when the original view keeps the mouse grab.

The committed package also includes automated and isolated native test drivers. Their commands are in [README.md](README.md); they are development tools, not runtime dependencies. Actual results and remaining platform/manual checks are in the [implementation plan](../docs/plans/files-plus.md#implementation-and-acceptance).
