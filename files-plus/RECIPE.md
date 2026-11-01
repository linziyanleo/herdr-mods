# Files Plus

Browse a single folder or every folder in a Multi-Roots workspace in the Files panel. Right-click an entry to insert an agent reference, copy it, paste it, copy a path, reveal it, or create, rename and remove files. A persistent + adds a workspace folder. Text and Markdown open as read-only source in the same panel, with a back button.

![Files Plus](preview.png)

The preview is an unedited `herdr-app shot` from a disposable native Herdr window. All shown folders and terminals are test fixtures.

## What you see

The panel defaults to 320px wide; its actual size belongs to the layout. The 42px header holds Files, a 24px Add folder control and a shortened folder, workspace or preview path. A preview adds a 24px back control. Workspace root rows are 30px high; entry rows are 28px with 18px of indentation per level. Roots show their display name and path, highlight the focused terminal's root, and show “Not found” for missing directories. Git letters appear at the right of changed entries.

The pointer menu is 272px wide with 32px rows, two groups, disabled actions and an inline error or progress state. Name and confirmation dialogs are 440px wide. Use 13px body text, 12px secondary text and 14px dialog headings, with 0.5px borders and separators. Controls use 4px radii. There are no animations or decorative labels.

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
- A workspace root also offers New terminal or agent here and Remove from workspace. If `multi-root` is installed, open its launch menu with the captured space/root; otherwise start a terminal in that root. Removing a root keeps files on disk and requires at least one root to remain.

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

`main.js` exports the GPUI view and routes `props().role`: absent for the panel, `menu` for a pointer popup, `dialog` for a modal name/confirmation/root action. `workspace.js` owns lazy tree state, local watchers, a 10-second refresh fallback, Git marks and bounded read-only previews. `roots.js` and `config.js` adapt this repository's Multi-Roots format, root matching, parsing and guarded saves. `actions.js` owns terminal insertion and filesystem commands. `palette.js` owns Radix light/dark values. There are no cross-mod code imports.

The baseline is native Herdr 0.1.11. Use `cx.spawn`, `cx.timer`, `cx.sleep`, focus handles and clipboard APIs from GPUI; `EditorState`, `Editor`, `InputState`, `Input`, flex builders and SVGs from gpui-base/gpui-kit. Herdr provides live spaces/panes/focus/settings, `shared`, `setShared`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `pickFolder`, overlays and `run`. Commands are `pane.focus`, `terminal.paste`, `tab.new` and optional `layout.select`.

Retain the existing `multi-root.spaces` and `multi-root.recent` contracts; prune closed mappings only when the local core's layout is ready. Config parsing errors keep the last valid roots. Additional shared keys are `files-plus.clipboard` (`{path,kind,on}`), `files-plus.revision` (a refresh counter), and optional `preview-plus.target` keyed by space (`{file,root,on}`). Menu targets additionally keep the physical root path for terminal cwd matching; this is derived data, not workspace configuration.

### Dependencies and access

POSIX operations use `sh`, `cp`, `mkdir`, `mv` and, after explicit confirmation outside local macOS Trash, `rm`. Git marks use Git with `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`. Windows retains PowerShell folder listing and file commands. Reveal uses `open -R`, `explorer.exe /select,…` or `xdg-open`. These programs receive paths as arguments, not interpolated shell source.

The mod reads workspace directories and text files, writes only requested filesystem mutations and workspace-config updates, and reads optional mods' `mod.json` to detect their presence. Local macOS Trash uses the person's `~/.Trash`. Remote filesystem calls carry the captured `on` machine. No service credentials, network services, Node.js, DOM or `setTimeout` are used by the runtime. Node.js 22+ and Python 3 are development/test dependencies only.

### Installation

1. Read the installed Herdr guide. Use `HERDR_APP_HOME` when set, otherwise `~/.config/herdr-app`.
2. Check for a `mods/files-plus` name conflict. Copy only this package's runtime `.js`, `.svg` and `mod.json` files to a new runtime directory; keep the third-party licenses with the distributed package. Do not copy tests, generated `.d.ts`, `jsconfig.json`, recipes or screenshots into the runtime.
3. In a personal layout, replace the existing Files block's `content.mod` with `files-plus`, retaining its block id. Clone a bundled layout first. No other mods or shortcut changes are required. To undo, restore the previous mod reference.
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

The Files tree, editor and SVGs derive from [Herdr files 0.1.9](https://github.com/herdrdev/herdr-app) (Apache-2.0), via this repository's Multi-Roots implementation. Preserve [the Herdr license](licenses/Herdr-APACHE-2.0.txt) and [Lucide/Feather notices](licenses/Lucide.txt). This retains third-party terms and does not choose a repository license.

## Watch out

Keep the inherited limits: 500 entries per folder, 5,000 loaded entries across all roots, 40 nested tree levels, 400,000 preview characters and Herdr's 1 MiB text-read ceiling. Binary, missing, unreadable and oversized files show explicit source-preview states. Preview Plus owns rich rendering, links, images and PDF conversion.

Multi-Roots management remains local POSIX support, matching the existing package; Windows and remote spaces retain single-folder browsing. Windows/Linux/remote native interactions need verification on those systems. Clipboard operations can restore previous text, but not a previous non-text clipboard. Tests do not install into the person's normal app home, replace their layout or change shortcuts.

## Done when

From the repository root:

```sh
node --experimental-vm-modules --test files-plus/tests/*.test.mjs
herdr-app check files-plus/mods/files-plus
node files-plus/tests/native-session.mjs
node files-plus/tests/native-verify.mjs /tmp/fp.EXAMPLE/session.json
node files-plus/tests/native-pair.mjs /tmp/fp.EXAMPLE/session.json
```

The unit/integration suite runs the real runtime modules against disposable directories and real POSIX file commands. Only the Herdr/GPUI host is adapted for Node. It covers references, terminal capture, clipboard restoration, copy names and cycles, symlinks, literal shell characters, CRUD, Trash, machine routing, workspace conflicts, unknown-field preservation, lazy bounds, editor states, stale reads and Preview Plus handoff ordering.

The native session launches the unchanged installed macOS bundle through LaunchServices with a separate app home and core. Its test-only wrapper invokes the actual runtime methods and renders the real popup/dialog/editor. Terminal recorders check the exact received bytes and the absence of Enter. The verifier writes `native-report.json` and real `herdr-app shot` captures under the printed `/tmp/fp.*` directory. It restores the previous text clipboard and only restores its own test-created Trash entry. No test commands ship in the installed mod.

The optional native pairing check installs a minimal receiver fixture only in that disposable home. It verifies Markdown/image/PDF target delivery, actual stack switching, back commands, retained tree expansion and ordinary-text source preview. It writes `native-pair-report.json`; it does not implement or validate Preview Plus's renderer.

Before accepting an installation, also manually select and cancel a folder in the system picker, add a folder while changing focus to another space, and confirm the captured original space is updated. Automated tests exercise the successful, cancelled, duplicate and conflicting helper paths; a screenshot of the Add folder dialog does not prove a system-picker selection. Preview Plus's own renderer requires its separate acceptance when implemented.

After collecting evidence, stop only that test session with the exact values printed in `session.json`:

```sh
HERDR_APP_HOME=/tmp/fp.EXAMPLE/app herdr-app do app.quit
XDG_STATE_HOME=/tmp/fp.EXAMPLE/s XDG_CONFIG_HOME=/tmp/fp.EXAMPLE/c HC_SESSION=fp hc server stop
```

Recorded acceptance results are maintained in the [implementation plan](../docs/plans/files-plus.md#implementation-and-acceptance).
