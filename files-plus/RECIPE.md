# Files Plus

Browse a single folder or every folder in a workspace in the Files panel. Right-click an entry to insert an agent reference, copy it, paste it, copy a path, reveal it, or create, rename and remove files. A persistent + adds a workspace folder. Text and Markdown open as read-only source in the same panel, with a back button.

![Files Plus](preview.png)

The preview is an unedited `herdr-app shot` from a disposable native Herdr window. All shown folders are test fixtures. Preserve the capture's sRGB metadata.

## What you see

The panel defaults to 320px wide; its actual size belongs to the layout. The 42px header holds Files, a 24px Add folder control and a shortened folder, workspace or preview path. A preview adds a 24px back control. Workspace root rows are 30px high; entry rows are 28px with 18px of indentation per level. Roots show their display name and path, highlight the focused terminal's root, and show “Not found” for missing directories. Git letters appear at the right of changed entries.

The pointer menu is 272px wide with 32px rows. Separators precede creation actions and workspace root actions. Disabled actions are dimmed; errors and progress stay in the menu. Name and confirmation dialogs are 440px wide. Use 13px body text, 12px secondary text and 14px dialog headings, with 0.5px borders and separators. Controls use 4px radii. There are no animations or decorative labels.

Colors use [Radix Colors scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale): Gray 1–2 backgrounds, 3–5 controls and selection, 6–8 borders, 11–12 text; Red, Green, Amber, Blue and Purple 11 for status and source syntax. `settings().dark` selects light or dark values. Native editor chrome follows Herdr's theme.

## How it behaves

Folders load lazily, directories sort first, hidden entries are included and `.git` is omitted. Symlinks appear as files and are not recursively followed. Opening text replaces the tree with a read-only source editor. Back returns to the existing expansions. File changes refresh the tree, Git marks and an open preview. An unchanged file keeps its existing editor and scroll state. Switching terminal focus within a workspace preserves expansions and previews.

Right-click captures the entry, owning root, machine and active terminal before the popup takes focus. Up/down skip disabled menu actions, Enter chooses, and Escape closes. Long-running actions keep their owner open until they finish; errors remain visible.

- Add to agent (@) pastes a reference plus a trailing space without Enter. Use a path relative to the terminal's cwd only when that cwd and the entry belong to the same root and the entry is beneath the cwd. Otherwise use the absolute path. Quote whitespace, quotes and backslashes. Match physical terminal cwd paths against declared workspace-root aliases. Refuse an unavailable captured terminal. Preserve a previous text clipboard, including an empty string; Herdr's text clipboard API cannot restore an image-only clipboard.
- Copy uses an internal shared clipboard. Paste targets the clicked directory or a file's parent, requires the same machine, and chooses `name copy.ext`, `name copy 2.ext`, or the corresponding folder name when needed. Existing files are not overwritten. Reject directory cycles, including a local/POSIX symlink alias into the source directory. Copy symlinks as links.
- Copy path copies the absolute path. Copy relative path always uses the owning root and yields `.` for a root row.
- Reveal uses Finder, File Explorer or the local Linux file manager. Remote reveal is disabled.
- New file and New folder prompt for a name inside the clicked directory or file's parent. Reject blank names, `.`/`..`, separators, control characters and existing entries. Rename is prefilled and stays in the same parent. Workspace roots cannot be renamed or deleted from this menu.
- Move to Trash asks for confirmation. Local macOS entries move to `~/.Trash` with collision-safe naming. Other platforms and remote machines display an explicit permanent-deletion confirmation. A failure stays in the dialog.
- A workspace root also offers New terminal here and Remove from workspace. Start the terminal in the captured space and root. Removing a root keeps files on disk and requires at least one root to remain.

Add folder works for local POSIX spaces, including ordinary single-folder spaces and preview headers. Capture the original space and displayed folder before opening the system picker. Cancel and duplicate selections leave data unchanged. Adding a different folder converts an ordinary space to an unsaved workspace, preserving its name, tabs and terminals. Existing workspace files use a captured expected-text write: preserve path spelling, string entries, unknown fields and two-space formatting; new folders use relative paths. A conflicting edit reloads instead of overwriting the file. A closed or replaced target cannot be recreated by a late completion.

Agent working, blocked, done and idle displays remain the surrounding Herdr UI's responsibility.

## Built from

```text
files-plus/
  RECIPE.md
  README.md
  preview.png
  licenses/
  mods/files-plus/
    main.js, workspace.js, roots.js, config.js, actions.js, palette.js
    mod.json, file.svg, folder.svg, chevron-down.svg, chevron-right.svg
  tests/
```

Create `mods/files-plus/main.js` with a default-exported class that extends GPUI `View`. Route `props().role`: absent for the panel, `menu` for a pointer popup, and `dialog` for a modal name, confirmation or root action. Pass a captured target and an action into overlays. The overlay id comes from `props().overlay`.

Keep tree state, local watchers, the 10-second refresh fallback, Git marks and read-only previews in `workspace.js`. Put path and workspace helpers in `roots.js`, guarded config saves in `config.js`, filesystem and terminal actions in `actions.js`, and the two Radix palettes in `palette.js`. There are no cross-mod code imports. The package manifest is:

```json
{
  "place": "right",
  "size": 320,
  "cloned_from": { "name": "files", "version": "0.1.9" }
}
```

No `keys.json` snippet is needed. Bind menu arrows, Enter and Escape to its focus handle; keep ordinary terminal shortcuts unchanged.

The baseline is native Herdr 0.1.11. Use `cx.spawn`, `cx.timer`, `cx.sleep`, focus handles and clipboard APIs from GPUI; `EditorState`, `Editor`, `InputState`, `Input`, flex builders and SVGs from gpui-base/gpui-kit. Herdr provides live spaces/panes/focus/settings, `shared`, `setShared`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `pickFolder`, overlays and `run`. Commands are `pane.focus`, `terminal.paste`, `tab.new` and optional `layout.select`.

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

Files Plus works alone. Preview Plus is a separate planned package; installing Files Plus does not install or implement it. When it becomes available, preserve the existing outer Files id and turn that node into this stack:

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

The committed package also includes automated and isolated native test drivers. Their commands are in [README.md](README.md); they are development tools, not runtime dependencies. Actual results and remaining platform/manual checks are in the [implementation plan](../docs/plans/files-plus.md#implementation-and-acceptance).
