# Multi-Roots

Keep several folders in one Herdr space. Browse every root together, choose where terminals and coding agents start, switch the repository shown in Changes, and save or reopen the workspace from a JSON file.

![Multi-Roots](preview.png)

The preview is captured from the running mod. Directory paths, the workspace name and personal status information are mosaiced; the interface outside those regions is unchanged. The PNG preserves the capture's sRGB color metadata.

## What you see

- Files stays in the existing Files panel. Each root row shows a chevron, folder icon, display name and shortened path. Roots start expanded. The focused terminal's root uses the selected color; a missing root says “Not found”. A file preview identifies its root and relative path in the header. A small + beside Files adds a folder.
- The 280 × 420 launch menu starts with wrapping root chips when there are at least two roots. Terminal and installed agents follow, then workspace actions. Missing roots cannot be selected; unavailable agents are dimmed.
- Changes stays in the existing Changes panel. Its repository switcher shows the display name, chevron and dimmed branch, beside file and line counts. The popup lists each repository once, with its branch, changed-file count and current selection.
- The 560 × 440 Open workspace dialog offers a folder picker and Recent files. Missing recent files are dimmed. Add, save and remove operations use a 460 × 240 dialog while a picker or file operation runs; an error remains visible there.

Use the person's Herdr theme: 13px body text, 12px secondary text, selected and hover backgrounds, and inherited 1px borders. Add no animation or decorative labels. Panel widths and the surrounding layout belong to the existing layout.

## How it behaves

Open the menu with Cmd+Shift+T. The preselected root is the root requested by a root-row action, otherwise the focused terminal's root, otherwise the first existing folder. Left/right arrows move the selection. Cmd+T starts a terminal there; Cmd+1 through Cmd+9 start installed agents. These menu bindings are scoped to its focus. Outside the menu, Cmd+T keeps Herdr's normal new-terminal behavior.

Outside a workspace, “Make this space a workspace” uses the focused folder, then the space folder, then home. “Add folder…” uses the native folder picker. Right-clicking a root offers “New terminal or agent here…” and “Remove from workspace”; the last root cannot be removed. Close a popup before running its action. Picker and save operations belong to the dialog that remains alive for their completion.

Files retains the shipped lazy tree, folder-first sorting, Git marks, symlinks listed as files, local watches, 10-second refresh, read-only syntax-highlighted preview, back button and bounded loading. Switching terminal focus highlights a root without clearing expanded folders or the preview. A workspace-file change reloads while Files is shown, or after that copy has started in the current layout. Opening the menu also reloads it. Invalid configuration preserves the last good roots and displays the error in Files and the menu.

Changes retains the shipped status list, automatic first diff, virtual diff, untracked/binary previews, repositories without HEAD, commit input and Escape behavior, refresh and errors. Picking a repository stays in effect until focus moves to a terminal in a different root. Focus outside every root or on a mod pane changes nothing. A commit operates in the repository shown in the header. With no Git roots, show “No git repository in this workspace”.

Saving first asks for a directory and creates a lowercase, hyphenated workspace filename. Refuse an existing filename. Preserve original path spelling, string folder entries and unknown top-level/folder fields when saving an existing file; newly added folders use relative paths. Format with two spaces and a trailing newline. On a conflicting external edit, reload and show “The workspace file changed on disk. Reloaded.” without retrying the write.

Opening a directory with exactly one workspace file opens it immediately; otherwise list matching files, or “No workspace files in this folder”. Recent holds ten paths at most. An already open file selects its space. Closing and reopening restores the named space and roots; this saves folder configuration, not terminal commands or agent conversations.

Agent status displays remain Herdr's existing working, blocked, done and idle states. This mod adds no alternative status model.

## Built from

Ship this as one folder, with no `layouts/` directory:

```text
multi-root/
  RECIPE.md
  preview.png
  keys.json
  licenses/
  mods/
    multi-root/          main.js, config.js, roots.js, mod.json
    multi-root-files/    main.js, workspace.js, roots.js, mod.json, four SVGs
    multi-root-changes/  main.js, workspace.js, roots.js, mod.json
```

All three default exports extend GPUI `View`; the panel entry classes inherit their workspace helpers. This is native GPUI JavaScript, with no DOM, Node APIs or `setTimeout`. Use `cx.spawn` for asynchronous work and `cx.timer` for refresh, without retaining callback contexts.

### Runtime responsibilities

- `multi-root/main.js` adapts the shipped `new-menu`. Roles from `props().role` are the default launch menu, `open`, `root-menu` and `repo-menu`. The `open` role also owns add/save/remove actions. Use native overlays and folder pickers; use scoped GPUI key bindings for launch shortcuts so the global tab bindings do not intercept them. `config.js` performs atomic saves.
- `multi-root-files` is a `mod.clone` of shipped `files`. Keep upstream changes small: delegate workspace context, root rows and watches to `workspace.js`, use absolute entry/expanded-folder/Git-mark/element keys, and read a preview by its absolute path. Each root starts expanded. Git discovery runs once per root, with one status read per distinct top level. The 5,000-entry budget is shared across roots.
- `multi-root-changes` is a `mod.clone` of shipped `changes`. `workspace.js` chooses the initial focused repository or first Git root, remembers the last matched focus root, updates selection when that root changes, and draws the header switcher. Include the selected repository in the context key; preserve the upstream commit context check.
- Each runtime has the same `roots.js`: normalized/relative paths, longest-root matching, physical-path discovery, parsing, guarded shared-state updates, pruning, config reload and Git discovery. Mods exchange data through `shared()`, without importing one another.

Preserve the existing layout block ids `files` and `changes`; only their `content.mod` values change during installation. The tab bar's existing `layout.select` calls then continue working. Do not modify Git Graph or ship a layout.

### Data and files

A workspace file is named `<name>.herdr-workspace.json` and may live anywhere on the local machine:

```json
{
  "name": "Product",
  "folders": [
    { "path": "../frontend", "name": "Web" },
    { "path": "../backend", "name": "API" },
    "./notes"
  ]
}
```

The name defaults to the filename without its suffix. Folder names are display names only. Accept folder objects or path strings, absolute paths and `~`; resolve relative paths from the config directory, normalize `.`/`..`, and drop duplicate resolved paths while keeping the first. Keep missing directories in the list. Invalid JSON or a missing folders array keeps the last valid state.

Only three persisted shared keys are written, comparing values before `setShared`:

```ts
"multi-root.spaces": Record<SpaceId, {
  name: string;
  file: string | null;
  folders: { name: string | null; path: string; source: string }[];
  error?: string;
}>
"multi-root.repo": Record<SpaceId, { root: string; by: "focus" | "pick" }>
"multi-root.recent": string[]
```

`path` is resolved and absolute; `source` keeps the declared text. Workspace mode requires a mapped space on the local machine and a non-Windows platform. Otherwise retain the original panels and launch menu. Prune closed-space entries only after `machines()` reports the local layout as ready, because `spaces()` can be incomplete while loading.

Read/parse the config before opening. Compare with current mappings to avoid duplicate spaces. Create a named space using the first existing root or home. Since `run("space.new", …)` has no returned id and the immediate space list is stale, compare id sets on the next render, matching a unique temporary name, attach the workspace and rename to its intended name.

Use `writeTextFile(file, text, expected)` with the last text read. Keep raw objects when updating folders so unknown fields survive. Files watches each existing root and the config directory; re-read only when the reported path is the config file. Physical root paths stay in derived data for cwd/Git matching, without replacing declared paths in persisted state.

### APIs and dependencies

Use Herdr's live `spaces`, `machines`, `panes`, `focused`, `window`, `props`, `theme`, `settings`, `home`, `shared`, `setShared`, `knownAgents`, `pickFolder`, `readTextFile`, `writeTextFile`, `watchFolder`, `exec`, `run`, `openOverlay` and `closeOverlay`. Use `space.new`, `space.select`, `space.rename` and `tab.new {space, folder, name?, argv?}`. The replacement panels retain the upstream GPUI editor, input and virtual list.

The baseline is Herdr 0.1.9 with Git and POSIX `sh`. Local workspace operations read config/root directories and invoke Git with `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`. The Changes submit action runs `git add -A` and `git commit -m`. The inherited panels keep remote `exec` routing and Windows PowerShell listing outside workspace mode. There are no mod network calls or service credentials. Started agents use their existing launch commands and authentication.

### Installation and sharing

1. Read the installed Herdr guide and use `HERDR_APP_HOME` when set, otherwise `~/.config/herdr-app`.
2. Check for conflicting runtime names. Copy only `.js`, `mod.json` and required `.svg` files from the three runtime folders. Omit generated `.d.ts` files, `jsconfig.json`, the recipe and preview from runtime folders.
3. Confirm Cmd+Shift+T is unbound, then merge the single global entry in `keys.json`. Preserve every existing binding, including Cmd+T.
4. In a personal layout, set block `files` to mod `multi-root-files` and block `changes` to mod `multi-root-changes`, keeping both block ids. For a shipped layout, first use `layout.clone`, then edit the clone.
5. Run native checks, inspect `herdr-app status` and any keys/layout errors, then exercise the actual window. To undo, restore the original two mod references and remove only the added shortcut; workspace files remain ordinary JSON.

Publish the complete folder in a public repository with the `herdr-mod` topic. The [Herdr catalog](https://herdr.dev/mods/) indexes community entries within an hour; community preview images are screened and wait at least 24 hours.

### Attribution

The panels and menu structure come from [Herdr](https://github.com/herdrdev/herdr-app), under Apache-2.0. Files includes Lucide/Feather icons. Retain [the Herdr license](licenses/Herdr-APACHE-2.0.txt) and [icon notices](licenses/Lucide.txt). These are third-party terms, not a choice of repository license.

| Upstream base | Version | `main.js` hash in `installed.json` |
| --- | --- | --- |
| `files` | 0.1.9 | `185dc12154f2bcf5` |
| `changes` | 0.1.9 | `b00568f69f7b7ff9` |
| `new-menu` | 0.1.9 | `74dc103b6b6113b7` |

## Watch out

- The four initial spikes confirmed deferred space creation, native writes outside the app home, physical cwd paths through symlinks, and stable concurrent folder watches. Keep the implementation choices above when rebuilding.
- Local POSIX workspace support is the first-version scope. Remote spaces and Windows retain the upstream behavior.
- Keep the upstream limits: 500 entries per directory, 5,000 total tree entries, 1,000 changed files, 400,000 preview characters and 1,500 diff rows. Preserve binary/unreadable previews, repositories without HEAD, error/loading/empty states and read-only Git flags.
- Raise inherited 10/11px text to 12px; remove middle-dot separators. Keep inherited borders and theme colors.
- Clones do not follow Herdr upgrades. Diff against the recorded bases when updating and keep all three `roots.js` copies identical.
- On this macOS Herdr 0.1.9 installation, native `check` aborts with GPUI `window.rs:5226` `Option::unwrap()` for both the unchanged shipped `changes` and the clone. Live rendering works. Record this as an upstream check limitation, never a passing check; add no checker-only product workaround.

## Done when

Rebuild and verify the observable behavior below. These interactions were exercised in Herdr 0.1.9 on macOS 27.0.1; no extra test suite or runtime test commands are shipped.

1. A workspace with relative, absolute and missing roots shows all roots, both existing trees and Git marks, plus “Not found”.
2. Expanded folders and the preview stay when focusing terminals in either root or outside every root. A preview identifies its root and relative path.
3. Conversion, native Add folder and save work. Selecting another root and an installed agent creates a tab in that root. Cmd+T outside the menu still creates a terminal directly.
4. Changes shows the chosen repository, branch, files and diff. A submitted commit lands only in the shown repository. Moving focus between roots updates selection; duplicate Git roots appear once and no Git roots show the specified empty state.
5. Saving preserves original paths, display names and unknown fields. An external edit blocks a stale save without being overwritten. Invalid config retains the last valid folders with a visible error.
6. Reopening selects an existing mapping, or restores the same named roots after closing. Restarting Herdr retains the mapping while existing core terminals remain live.
7. Non-workspace panels and the remote launch menu retain upstream behavior. The live app reports no mod or layout errors and an actual screenshot is captured with `herdr-app shot`.
8. Native checks for the menu and Files pass. The Changes check has the reproduced upstream limitation described above; it has not been claimed as passed.
