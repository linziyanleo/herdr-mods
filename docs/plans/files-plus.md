# Files Plus implementation plan

Status: runtime implemented on local branch `mod/file-plus` on 2026-11-01. Automated and isolated native acceptance results are recorded [below](#implementation-and-acceptance). Installation into the person's normal Herdr home, Git commits, push and publication are outside this local development delivery.

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

## Implementation and acceptance

The user's 2026-11-01 request authorizes full Files Plus development and testing on `mod/file-plus`. Work is isolated at `/Users/fanghu/Documents/Work/.agent-worktrees/file-plus/herdr-mods`, based on local main `6b715689e7062528627e6813f048575f36be6377`. Other task worktrees and the normal Herdr configuration are preserved. No commit, push, merge or public release has been performed.

The independently installable runtime is under `files-plus/mods/files-plus/`. It adapts the repository's existing Multi-Roots tree, configuration and read-only editor, adds `actions.js`, internal menu/dialog roles and a Radix palette, and retains the shared workspace format. No changes to the Multi-Roots runtime or Preview Plus plan are required. See [the recipe](../../files-plus/RECIPE.md) for installation and the final behavior.

Implementation decisions:

- Keep all entry and expansion keys absolute in both modes. Workspace focus changes retain the tree and preview. Match a declared root's physical alias when formatting terminal references, because Herdr reports physical cwd paths.
- Capture the active terminal before opening the popup. Yield through the native executor after focus and paste commands so the terminal consumes the temporary clipboard before its previous text is restored. Execute asynchronous actions before closing their owner.
- Use non-overwriting file commands, explicit confirmation for removal, lexical and physical directory-cycle checks, and expected-text workspace writes. Preserve unknown configuration fields and reject a changed or closed captured workspace.
- Bound tree and source loading, reject stale preview/receiver results, and retain the existing editor when preview bytes have not changed. A configured but absent Preview Plus receiver falls back to source preview.
- Give the popup a content-derived height. A percentage height in a pointer popup can collapse to a line even when the mod checker and action methods pass; the native screenshot is the verification for this layout behavior.

Verification on macOS with installed Herdr 0.1.11 and Node.js 22.23.4:

- 26 automated tests pass using `node --experimental-vm-modules --test files-plus/tests/*.test.mjs`. File operations use real disposable directories and POSIX commands; only the host APIs are adapted for Node. Coverage includes references and physical aliases, clipboard restoration, copy naming/cycles/symlinks, CRUD and Trash, machine routing, conflict-safe workspace updates, bounds, missing/binary previews, retained editor state and stale handoff ordering.
- Native `herdr-app check` passes for the source and installed disposable runtime. The normal app is not the installation target.
- 12 native acceptance groups pass in `/tmp/fp.bgRLqL`; report: `/tmp/fp.bgRLqL/native-report.json`. These exercise actual GPUI views and filesystem/clipboard/terminal APIs: source preview, file/folder creation, rename and collision errors, same-directory and cross-directory copy, cycle refusal, path copying, two-root focus retention, precise same-root/cross-root terminal bytes with no Enter, root dialogs/menus, configuration preservation/conflicts, Trash/Finder and standalone root-terminal launch.
- Optional pairing passes in the same native session using a minimal receiver fixture: Markdown, PNG and PDF targets select the receiver; its back command returns to the existing tree with expansion retained; ordinary text stays in the source editor. Report: `/tmp/fp.bgRLqL/native-pair-report.json`. This proves the Files Plus protocol and stack integration, not Preview Plus's future renderer.
- Actual screenshots cover the source editor, name-conflict dialog, Add folder dialog, trees and context menu. Final popup sizing and light/dark appearance were checked separately after the correction above. The distributed `files-plus/preview.png` is captured directly from the disposable native window. `herdr-app status` reports zero mod/layout errors.

Remaining acceptance boundaries: the computer-use connection timed out, so the real system folder picker's confirmation/cancellation has not been automated. Success, cancel, duplicate and external-edit behavior of its root-update helpers are covered; the actual Add folder dialog is rendered and captured. Windows, Linux and remote-machine native interaction remain unverified. Preview Plus rich rendering remains its separate planned implementation.

Final package checks found no syntax, whitespace or documentation-link errors. All 11 runtime files match the checked disposable installation. App-generated IDE files are excluded from the package. The native test app and its separate core were stopped after capture; evidence under `/tmp/fp.bgRLqL` and the uncommitted task worktree are retained for review. The normal Herdr app still uses `main-graph`, reports zero errors and has no Files Plus installation.
