# Files Plus implementation plan

Status: planned, documentation only. No runtime files or installation changes exist for this mod yet.

Follow the existing [Multi-Roots plan](multi-root.md) for workspace config format and `shared("multi-root.spaces")` semantics. This plan also defines how `files-plus` optionally hands off rich previews to [Preview Plus](preview-plus.md) while remaining usable on its own.

## Goal

Provide one Files panel (`files-plus`) that combines single-folder browsing, Multi-Roots workspace folder browsing and management, read-only source previews, a complete right-click file manager context menu, and optional view handoff to `preview-plus`.

## Design

- Build `files-plus/mods/files-plus/` directly on top of the repository's `multi-root-files` implementation (`main.js`, `workspace.js`, `roots.js`, and `config.js`). Retain its lazy loading (500 per folder, 5,000 total), Git status marks, symlink handling, `watchFolder` plus 10-second refresh, and read-only `Editor` text preview.
- Keep `files-plus` and `preview-plus` independently installable:
  - **Installed alone**: `files-plus` replaces `files` or `multi-root-files` as a single block (`"mod": "files-plus"`). Clicking any text or Markdown file opens `files-plus`'s built-in read-only `Editor` preview.
  - **Installed with `preview-plus`**: when given `props.previewStack` (for example `{ "previewStack": "files" }` in a 2-child stack `files-plus-tree` + `preview-plus`), clicking `.md`, `.markdown`, supported images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`), or `.pdf` writes `{ file, root, on }` to `shared("preview-plus.target")[spaceId]` and calls `run("layout.select", { stack: props().previewStack, child: "preview-plus" })` to replace the panel view. Other text files stay in `files-plus`'s built-in `Editor` preview.
- Absorb Multi-Roots file tree actions (`+` Add folder in the header, and root right-click actions) directly into `files-plus` while reading and writing the existing `shared("multi-root.spaces")` contract. A person can install `files-plus` alone or alongside the `multi-root` package (`multi-root`, `multi-root-spaces`, `multi-root-changes`).
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
   - **Path resolution (Multi-Roots compatible)**:
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
   - **Copy relative path**: writes `relativePath(target.root, target.path)` (`.` for a root row) to the system clipboard with `cx.write_to_clipboard`. Always resolves relative to the entry's owning root in both single-folder and Multi-Roots spaces.

4. **Reveal in Finder / File Explorer**
   - Enabled for local spaces (`target.on === null`).
   - Runs `exec("open", ["-R", target.path])` on macOS, `exec("explorer.exe", [`/select,${winPath}`])` on Windows, or `exec("xdg-open", [dirname(target.path)])` on Linux.

5. **File and folder CRUD (`New file…`, `New folder…`, `Rename…`, `Move to Trash`)**
   - **New file… / New folder…**: opens `role: "dialog"` to prompt for a name and creates inside the clicked folder/root (or the clicked file's parent directory). Rejects empty names, path separators (`/` or `\`), `.` / `..`, and existing names.
   - **Rename…**: opens `role: "dialog"` pre-filled with the current base name and renames in place within the parent directory. Rejects existing names. Disabled on workspace root rows.
   - **Move to Trash**: opens `role: "dialog"` to confirm, then moves the entry to the user's Trash on local macOS (`~/.Trash` with non-colliding name) or removes it after confirmation. Disabled on workspace root rows.
   - Refresh the affected parent folder and git marks after any mutation.

6. **Workspace root actions** (shown on workspace root rows)
   - **New terminal or agent here…**: opens `multi-root` (`role: "new"`, `props: { space, root: target.root }`) when installed, or starts a terminal in `target.root` via `run("tab.new", { space, folder: target.root })`.
   - **Remove from workspace**: removes `target.root` from `shared("multi-root.spaces")` and updates the workspace file when mapped. Disabled when only one root remains.

## Implementation and verification

Implement the runtime under `files-plus/mods/files-plus/`:

- `main.js`: panel view, popup menu role, and dialog role
- `workspace.js`, `roots.js`, `config.js`: adapted from `multi-root-files` and `multi-root` with root addition/removal and right-click menu wiring
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
