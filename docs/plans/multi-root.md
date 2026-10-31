# Multi-Roots implementation plan

Status: original package implemented and installed locally on 2026-10-31. The sidebar addition is implemented and verified in isolation, with source commit `ae9a10642a58fb622329fc0b7a3cc0c1d4003c09` and live installation pending. All four native checks pass on Herdr 0.1.10; the original 0.1.9 Changes checker panic remains historical evidence below.

This plan is the handoff for the implementer. It records the approved decisions, the contracts between the runtime mods, and the acceptance checks. Write `multi-root/RECIPE.md` from the real files after implementation, as [CONTRIBUTING.md](../../CONTRIBUTING.md) requires; this plan does not replace it.

## Goal

A Herdr space can hold several root folders, declared in a config file:

1. A config file declares `folders[]`, each with an optional display name and a path, which may be relative.
2. Files shows every root at once. Focusing another terminal does not change the roots.
3. New terminals and agents start in a root the person chooses.
4. Changes shows which repository it operates on, and lets the person switch it.
5. A workspace can be saved and reopened, with its folder configuration kept.

## Approved decisions

| Decision | Outcome |
|---|---|
| Model | One workspace is one Herdr space plus one config file. |
| Folder `name` | Display name only. Without it, show the folder's base name. |
| Shortcut | Keep `cmd-t` (`tab.new`). Add `cmd-shift-t` to open the Multi-Root menu. |
| Graph | Out of scope. `git-graph` belongs to another author and is not modified. |
| Layout | No layout ships. The person's personal layout swaps the Files, Changes and Spaces mods (see [Installation](#installation)). |
| Panels | Replacement panels reuse every feature of Herdr's `files` and `changes`. Outside a workspace they behave exactly like the originals. |
| Name | Public display name "Multi-Roots", requested for publication on 2026-10-31. Directory, runtime mods and shared keys keep `multi-root`. |

The name avoids Herdr's own `workspace` prefix (`workspace-chrome`, `workspace-status`, `shared("workspace.panels")`). Herdr replaces shipped mods with the same name on every start, so a future shipped `workspace` mod would overwrite ours.

## Herdr facts the design depends on

Read `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts` before implementing. The facts below drive the design.

- Herdr's `files` and `changes` resolve their folder with `location()`, which returns the focused pane's `cwd`. When `key()` changes, they discard their state. This causes the problem in goal 2.
- Shipped mods are read-only and are replaced on start. Change them through `mod.clone`.
- A space has no custom metadata. The workspace-to-space mapping lives in persisted `shared()` state.
- `run()` returns `null`, so a mod cannot read the id of a space it creates (see spike S1).
- `tab.new {space, folder, argv, name}` starts a terminal or agent in a folder.
- `space.new {name, folder}` creates a named space, so Herdr does not rename it after its first terminal.
- `writeTextFile` and `watchFolder` work on this machine only. `pickFolder` exists; there is no file save dialog.
- Mods cannot import each other's code at run time. Runtime mods share data through `shared()` only.
- `<mod>.<command>` reaches shown copies only. `mod.open:<mod>` opens a mod as the overlay described by its `mod.json` and works from any state.
- The tab bar (`tabs`, and the user's `tabs-graph` clone) switches panels with `layout.select {stack: "panel-body", child: "files" | "changes"}`. It uses block ids, not mod names.

## Repository layout

```text
multi-root/
  RECIPE.md                       written after implementation
  preview.png                     herdr-app shot of the running panels
  keys.json                       {"global": {"cmd-shift-t": "mod.open:multi-root"}}
  mods/
    multi-root/                   menu, open dialog and popups (by props().role)
      main.js
      mod.json
      *.js
    multi-root-files/             clone of files, multi-root tree
    multi-root-changes/           clone of changes, repository switcher
    multi-root-spaces/            clone of spaces, separate workspace creation button
docs/plans/multi-root.md          this plan
```

Do not commit the files Herdr writes into mod folders (`gpui-kit.d.ts`, `jsconfig.json`).

### Creating the clones

```sh
herdr-app do mod.clone '{"name":"files","as":"multi-root-files"}'
herdr-app do mod.clone '{"name":"changes","as":"multi-root-changes"}'
```

`mod.clone` records `cloned_from` in `mod.json` and rewrites `mods/files/...` asset paths. Copy each clone into `multi-root/mods/` without the files Herdr writes. Record the upstream base in `RECIPE.md` so later Herdr versions can be diffed:

| Clone | Upstream | Upstream `main.js` hash in `installed.json` |
|---|---|---|
| `multi-root-files` | `files` 0.1.9 | `185dc12154f2bcf5` |
| `multi-root-changes` | `changes` 0.1.9 | `b00568f69f7b7ff9` |

Keep the diff against upstream small. Put new logic in new modules, such as `roots.js`, and change upstream functions only where a workspace needs different behavior.

## Config file

File name: `<name>.herdr-workspace.json`. It can live anywhere on this machine, for example a parent folder of the repositories, and can be committed.

```json
{
  "name": "product",
  "folders": [
    { "path": "." },
    { "path": "../backend", "name": "API" },
    "../frontend"
  ]
}
```

| Field | Rule |
|---|---|
| `name` | Workspace and space name. Default: the file name without `.herdr-workspace.json`. |
| `folders[]` | Required. Each item is `{ "path", "name"? }` or a path string. |
| `path` | Relative to the config file's folder. Absolute paths and a leading `~` are accepted. |
| `name` (folder) | Optional display name. |

Parsing:

- Resolve every path to an absolute, normalized path (`.` and `..` removed, no trailing `/`).
- Drop duplicate resolved paths, keeping the first.
- Keep folders that do not exist; Files shows them as "Not found".
- Invalid JSON or a missing `folders` array keeps the last good state and shows the error in the menu and in Files.

Saving:

- Read the file, modify it and write it back. Keep unknown top-level keys and unknown keys on each folder.
- Write each folder's original `path` text unchanged.
- Write new folders as paths relative to the config file's folder.
- Pass the last text read as `expected` to `writeTextFile`. If the write is rejected because the file changed, reload it and show "The workspace file changed on disk. Reloaded." Do not retry automatically.
- Format with two-space indentation and a trailing newline.

## Shared state contract

Workspace data uses these keys. Compare values before calling `setShared`, because every call re-renders every mod. The Spaces clone additionally preserves upstream `space.colors` and its per-copy `machines.folded` local storage.

```ts
// shared("multi-root.spaces")
type Spaces = Record<SpaceId, {
  name: string;
  file: string | null;          // absolute path; null until first save
  folders: { name: string | null; path: string; source: string }[];  // path: absolute, source: as written
  error?: string;               // last config read error
}>;

// shared("multi-root.repo")
type Repo = Record<SpaceId, { root: string; by: "focus" | "pick" }>;  // root: git top level

// shared("multi-root.recent")
type Recent = string[];          // config file paths, newest first, at most 10
```

A space is a workspace when `shared("multi-root.spaces")[space.id]` exists, `space.machine` is `null`, and `window().platform` is not `"windows"`. In every other case, all three mods use the upstream behavior.

Remove entries for space ids that no longer exist. Remove them only after `machines()` reports the local machine (`name: null`) as `ready`; during `loading`, `spaces()` can be incomplete.

### Shared helpers

Each runtime mod carries its own copy of `roots.js`, because mods cannot import each other. Keep the copies identical; a later change must update all three.

- `resolvePath(base, path)`: expands `~` with `home()`, joins relative paths and normalizes the result.
- `relativePath(fromDir, to)`: used when saving new folders.
- `rootOf(cwd, folders)`: the longest folder path equal to `cwd` or a prefix of `cwd + "/"`. Returns `null` when no folder matches.
- `parseConfig(text, file)` returns `{ name, folders, raw }` or throws an error with a short message.
- `workspaceOf(spaceId)`: applies the workspace test above.

## Runtime mod: `multi-root`

One runtime mod with several roles, chosen by `props().role`, following the `git-graph` pattern:

| Role | Opened by | Kind |
|---|---|---|
| none (`new`) | `mod.open:multi-root` (`cmd-shift-t`), Files' root menu | popup, from `mod.json` |
| `open` | the menu's "Open workspace…" | dialog |
| `root-menu` | right-click on a root in Files | popup at the pointer |
| `repo-menu` | the repository switcher in Changes | popup at the pointer |

`mod.json`:

```json
{ "place": "none", "title": "Multi-Root", "overlay": { "kind": "popup", "width": 280, "height": 420 } }
```

Close every popup with `closeOverlay(props().overlay)` before running its action.

### Role `new`: start a terminal or agent

Reuse the structure and key handling of Herdr's `new-menu`. From top to bottom:

1. **Root row** (workspaces with two or more folders only): one chip per folder, wrapping, labeled with the display name. The preselected chip is `props().root` when given, else the focused pane's root, else the first folder. `←` and `→` move the selection. The selected chip uses `theme().selected`. Missing folders are dimmed and cannot be selected.
2. **Terminal**, then the installed agents from `knownAgents()`, as in `new-menu`. `cmd-T` starts a terminal and `cmd-1` to `cmd-9` start agents.
3. **Workspace actions**, separated by a divider:
   - In a workspace: "Add folder…", then "Save workspace" (file exists) or "Save workspace…" (`file: null`), then "Open workspace…".
   - Outside a workspace: "Make this space a workspace", then "Open workspace…".

Actions:

- Terminal: `run("tab.new", { space, folder: root })`.
- Agent: `run("tab.new", { space, folder: root, name: agent.name, argv: agent.run })`.
- Outside a workspace, Terminal and agents behave like `new-menu`, without `folder`.
- **Make this space a workspace**: write `{ name: space.name, file: null, folders: [{ name: null, path: cwd, source: cwd }] }`. `cwd` is the focused pane's folder, falling back to `space.folder`, then `home()`.
- **Add folder…**: call `pickFolder({ prompt: "Add" })`, append the folder if it is new, then save when `file` is set.
- **Save workspace…**: call `pickFolder({ prompt: "Save here" })`. Write `<slug>.herdr-workspace.json`, where `slug` is the name in lowercase with runs of other characters replaced by `-`. If the file exists, refuse with "A workspace file with this name already exists here." Write sources as relative paths, set `file`, and add the file to `recent`.

When the config file is set, re-read it each time the menu opens, so external edits show up.

### Role `open`: reopen a workspace

A dialog with:

- **Recent**: rows from `multi-root.recent`, showing the name and a dimmed path with `~` for home. Missing files are dimmed and labeled "Not found".
- **Choose folder…**: calls `pickFolder({ prompt: "Open" })` and lists `*.herdr-workspace.json` in that folder. Open the file at once when there is exactly one. Otherwise list them. With none, show "No workspace files in this folder".

Opening a file:

1. Read and parse it. On error, show the message in the dialog.
2. If a space already maps to this file, run `space.select {id}` and stop.
3. Record the current space ids, then call `run("space.new", { name, folder })`. `folder` is the first folder that exists, else `home()`.
4. Find the new space id (spike S1) and write its entry in `multi-root.spaces`.
5. Move the file to the front of `recent`.

### Role `root-menu`

`props()`: `{ role, space, root }`. Rows:

- "New terminal or agent here…": opens role `new` with `props: { root }`.
- "Remove from workspace": disabled when it is the last folder. Removes the folder, then saves when `file` is set.

### Role `repo-menu`

`props()`: `{ role, space }`. Lists each distinct git top level among the workspace folders. Each row shows:

- the display name (the `name` of the first folder that resolves to this top level, else the top level's base name)
- the branch, dimmed
- the number of changed files (`git status --porcelain` with Herdr's read-only flags)
- a check on the current repository

Folders that are not git repositories appear dimmed as "Not a git repository". Picking a row writes `{ root, by: "pick" }` to `multi-root.repo`.

## Runtime mod: `multi-root-files`

### Kept upstream behavior

Every upstream feature stays, both in a workspace and outside one:

- lazy loading per folder, with the 500-per-folder and 5,000-total limits and the "File list limited…" note
- folders sorted first, `.git` hidden, symlinks listed as files
- the PowerShell listing on Windows, and `exec` with `on` for remote spaces
- git marks (A, M, D, U and their colors), read with `--no-optional-locks` and `core.fsmonitor=false`
- `watchFolder` refresh for local folders, plus the 10-second timer
- the read-only preview: `Editor` with the `LANG` map, the 400,000-character limit, binary detection and the back button
- the loading, empty, error and "No folder" states

### Workspace mode

- **Context**: the active space id plus the resolved folder list. Pane focus is not part of it, so focusing another terminal keeps the loaded entries and expanded folders.
- **Keys**: use absolute paths as keys for entries, expanded folders, git marks and element ids. Each root is a top-level node keyed by its path.
- **Root row**: chevron, folder icon, display name, then the path with `~` for home, dimmed and truncated. Roots start expanded. The root containing the focused pane uses `theme().selected`. A missing root shows "Not found" and has no children.
- **Git marks**: run `git rev-parse --show-toplevel` once per root and `git status` once per distinct top level.
- **Watches**: one `watchFolder` loop per root (spike S4). Stop a loop when its root leaves the context.
- **Limits**: the 5,000-entry total is shared by all roots.
- **Preview header**: `<root display name>/<path relative to the root>`.
- **Header action**: `+` after the title runs "Add folder…" (same behavior as the menu).
- **Right-click on a root row**: `openOverlay({ mod: "multi-root", kind: "popup", props: { role: "root-menu", space, root } })`.
- **Config reload**: when the entry has a `file`, re-read it on start and whenever `watchFolder(dirname(file))` reports that file. Update `multi-root.spaces` when the result differs. On a read error, keep the folders and set `error`; Files shows it above the tree.
- **Pruning**: perform the pruning described in the shared state contract.

## Runtime mod: `multi-root-changes`

### Kept upstream behavior

Every upstream feature stays:

- the status list (the first 1,000 files) with add and delete counts from `--numstat`
- the first file's diff opening automatically
- the virtual diff list with line numbers
- previews of untracked files, binary detection and repositories without a `HEAD`
- the commit input (`git add -A` then `git commit -m`), with Escape leaving the input
- the `watchFolder` refresh, the 10-second timer, notes and errors

### Workspace mode

- **Which repository**: `location()` returns `{ cwd: multi-root.repo[space].root, on: null }` when the entry exists, else the upstream result. The context key includes that root, so switching repositories resets state like any upstream context change.
- **Latest action wins**: on each render, compute the focused pane's root. When it differs from the last focus root seen by this copy and resolves to a git top level, write `{ root: topLevel, by: "focus" }`. A pick from `repo-menu` stays until focus moves to a pane in a different root. Focus on a mod pane, or a `cwd` outside every root, changes nothing.
- **Initial value**: the focused pane's repository, else the first folder that is a git repository.
- **Header**: replace the "Changes" title with the repository switcher: display name, a chevron and the dimmed branch. Clicking it opens `repo-menu` at the pointer. The file count and the `+`/`−` totals stay. Outside a workspace the header is unchanged.
- **Commit**: always commits in the repository shown in the header. Upstream already guards this with its context check; keep that check.
- **No repository**: when no folder is a git repository, show "No git repository in this workspace".

## Interface rules

These apply to new UI, and to inherited UI where noted.

- **Colors**: use `theme()` names only. The repository rule "Prefer colors from `theme()`" takes precedence over the global Radix Colors rule, so the panels follow the person's Herdr theme.
- **Text sizes**: at most three, with a 12px minimum: 13 for body text, 12 for secondary text and hints. Raise the inherited 11px and 10px text in both clones to 12px.
- **Separators**: remove inherited middle dots ("Binary file · no text preview" becomes "Binary file, no text preview"; "Binary file · no text diff" becomes "Binary file, no text diff"). Do not use `·` in new text.
- **Borders**: keep the inherited 1px borders so the panels match Herdr's other panels. New separators inside the menu use the same 1px `theme().border` as `new-menu`.
- **Decoration**: no eyebrows, uppercase labels or left accent bars. No animations; native spinners are not needed.
- **Copy**: English, matching Herdr. The full set of new strings: "Add folder…", "Save workspace", "Save workspace…", "Open workspace…", "Make this space a workspace", "New terminal or agent here…", "Remove from workspace", "Recent", "Choose folder…", "Not found", "Not a git repository", "No workspace files in this folder", "No git repository in this workspace", "A workspace file with this name already exists here.", "The workspace file changed on disk. Reloaded."

## Spikes to run first

Run each spike in a throwaway mod or with `herdr-app do`. Record the results in `RECIPE.md` under Watch out, and choose the matching branch before building the dependent phase.

| # | Question | If false |
|---|---|---|
| S1 | Right after `run("space.new", …)` returns, does `spaces()` contain the new space? | Find it on the next render by comparing id sets, filtered by the unique name passed to `space.new`. |
| S2 | Can `writeTextFile` write outside `~/.config/herdr-app`, for example `~/Documents/x.herdr-workspace.json`? | Write a temporary file with `exec` and `mv` it into place; compare the current text before replacing. |
| S3 | Is `panes()[i].cwd` a logical path or a physical path with symlinks resolved? Does `git rev-parse --show-toplevel` agree? | Store the `pwd -P` form of each root next to `path` and match against both. |
| S4 | Are several concurrent `watchFolder` loops in one copy stable? | Watch each repository's git folder only and rely on the 10-second timer for the tree. |

## Phases and acceptance checks

### P0 evidence (2026-10-31)

- S1: `run("space.new", …)` returned `null`; the immediate `spaces()` read had no new id. The next render contained the named space. Opening uses an id-set comparison and a unique temporary name, then restores the workspace name.
- S2: `writeTextFile` successfully created and read back a workspace file under `~/Documents/herdr-multi-root-test/`. Use its native atomic compare-and-write API.
- S3: a terminal opened through `link-a -> a` reported the physical `a` path; `pwd -P` and `git rev-parse --show-toplevel` agreed. Keep physical root paths in each copy's derived data, preserving the declared paths in shared state and config files.
- S4: two concurrent watch loops in one throwaway mod each received two file-change notifications. Use one loop per root plus the config-directory loop; retain the upstream 10-second refresh.

Implementation and local loading were authorized for the initial acceptance stage. The user separately approved one disposable-repository acceptance commit, then authorized source commits and public distribution as recorded below. No extra test suite is added.

### Implementation evidence (2026-10-31)

- P1/P2: the installed panels showed relative symlink, absolute and missing roots. Native folder picking, conversion to a workspace and first save worked. Expanded folders survived A/B/outside focus changes; preview headers identify the root. A Pi tab launched through the menu had core cwd `herdr-multi-root-test/b`. Scoped menu key bindings are needed because global tab shortcuts otherwise intercept agent shortcuts; `cmd-t` outside the menu still creates a terminal directly.
- P3: the live Changes panel showed repository names, branches, status and diffs. Picking B persisted until focus moved between root terminals, then A became the focus-selected repository again. The user explicitly approved the disposable-repository commit after automatic approval review requested clarification. Commit `85406d8c3c40a9252b3ea9164baea561939402c8` landed in B through Changes; A still had no HEAD. Duplicate Git roots appeared once; a workspace without Git roots showed the specified message.
- P4: native save produced relative paths. Saving an existing file preserved original path spelling and custom top-level/folder fields. An external edit between opening the menu and saving produced the specified conflict message and remained on disk.
- P4: opening an already mapped file selected the existing space. Closing and reopening from Recent recreated the name and three roots and pruned the old id. Restarting Herdr 0.1.9 retained the mapping and roots while existing core terminals stayed live. Invalid config kept the last good state with a visible error. The recipe and README describe the real implementation and local verification.
- Native checks: menu and Files passed. Changes and the unmodified shipped `changes` both abort with the same GPUI `window.rs:5226` `Option::unwrap()` panic in `herdr-app check`; both render in the live window. This is an upstream check limitation, not a passing gate.
- Initial local delivery: source, recipe, preview and upstream attribution were handed back as uncommitted changes, with all 16 runtime files matching the installation. Only the approved shortcut and two personal-layout mod references changed. The spike mod was removed and the original sidebar, panel visibility and work focus were restored. The task worktree was retained pending the subsequently authorized publication below.

### Public distribution (2026-10-31)

The user subsequently authorized source commits and pushes, a public GitHub repository, the `herdr-mod` topic, a reconstructable recipe and an actual preview with personal information mosaiced. The requested public name is Multi-Roots; runtime folder names and persisted keys stay `multi-root`.

The recipe follows the installed guide's six-section brief and includes the file format, shared-state shapes, runtime roles, commands, inherited behavior, constraints, installation and observable checks without relying on this plan. The package has no `layouts/` directory. The public screenshot keeps its original 3456 × 2168 resolution; only five regions containing paths, a workspace name and personal status data changed. Pixel comparison confirmed every pixel outside those regions is identical to the captured window. A built-in image edit supplied the mosaic texture; only the mosaic regions were copied onto the original screenshot. Prompt: privacy redaction only; mosaic directory paths, workspace name and personal status; preserve every other part of the real interface.

The official catalog says repository/topic discovery occurs within an hour. Community images are separately screened before they appear; its current sharing guide no longer specifies a minimum 24-hour wait. GitHub publication, catalog discovery and image approval must be verified separately.

- Source commit `b13cac957629771cfe1fdbdc5c1f02f5f925d7e5` was fast-forwarded to `main`, pushed to `origin/main` and read back from the remote ref.
- [linziyanleo/herdr-mods](https://github.com/linziyanleo/herdr-mods) is public with the `herdr-mod` topic. GitHub topic search finds it. The package at `multi-root/` contains `mods/`, `keys.json`, `RECIPE.md`, `preview.png` and upstream notices, without `layouts/`.
- Anonymous requests return HTTP 200 for the recipe and screenshot. After re-capture, the public screenshot SHA-256 is `2c7abd0781f7fbdff9fc7b3716ee58004cf30abc435daf609b46194604ac9119`.
- The [official catalog index](https://assets.herdr.dev/mods/index.json), generated at `2026-10-30T19:00:16.466Z`, contains `linziyanleo/herdr-mods`, path `multi-root`, title `Multi-Roots` and the recipe's introductory paragraph as its description. It identifies all three runtime mods, `hasKeys: true` and `hasPreview: true`.
- The catalog index generated at `2026-10-31T01:00:16.519Z` references source commit `8e77cc64d7a4dd7f0bcac8a724869b675bea0f38` and the [updated preview](https://assets.herdr.dev/previews/2c7abd0781f7fbdff9fc7b3716ee58004cf30abc435daf609b46194604ac9119.png). An anonymous download of this official asset is byte-identical to the corrected GitHub screenshot and retains standard sRGB metadata. The [Herdr catalog](https://herdr.dev/mods/) now serves the updated image; a browser holding the previous index may need a forced refresh.
- Preview re-capture: the first redacted PNG had an incorrect `gAMA` value of `2.19998`, causing a washed-out appearance in color-managed viewers. A fresh `herdr-app shot` of the running Files panel now retains the original `sRGB` chunk and has no `gAMA` override. The existing mosaic texture is reused in five privacy regions. Pixel comparison confirms that all pixels outside those regions match the new native capture exactly; resolution remains 3456 × 2168. The original space, pane and panel visibility were restored afterward.

Run `herdr-app check <installed mod folder>` after every change. For UI changes, run `herdr-app status` (no mod errors, no `layout.error`) and inspect a `herdr-app shot` screenshot.

1. **P0: spikes.** Record S1 to S4.
2. **P1: config, shared state and Files.**
   - A workspace with three roots, one relative, one absolute and one missing, shows three root rows: two with their trees and one marked "Not found".
   - Expand folders in two roots, then focus terminals in each root and a terminal outside all roots: the roots and expanded folders stay.
   - Git marks appear in every root that is a git repository.
   - A non-workspace space behaves like Herdr's Files: the tree follows the focused pane.
   - Editing the config file adds or removes a root while Files is shown.
3. **P2: the `multi-root` menu and shortcut.**
   - With focus in root A, `cmd-shift-t` preselects A. Choosing root B and an agent starts a tab whose `herdr-app ls` folder is B.
   - `cmd-t` still runs `tab.new` with no menu.
   - "Make this space a workspace", then "Add folder…": Files shows both roots.
4. **P3: Changes.**
   - Focus in A: the header shows A. Pick B in the switcher: the header and list show B, and a commit lands in B (`git -C B log -1`).
   - Focus moves to a terminal in A: the header returns to A.
   - Two roots inside one repository appear once in the switcher.
   - A non-workspace space behaves like Herdr's Changes.
5. **P4: save, reopen, documentation.**
   - Save a new workspace: the file contains relative paths and the display names.
   - Close the space and open the file from Recent: a space with the same name and roots appears. Opening it again selects the existing space.
   - Restart Herdr: the mapping and roots are still there.
   - Edit the file in another program while it is open, then save from Herdr: the conflict message appears and the external edit is kept.
   - Write `RECIPE.md` and `preview.png`, and add a README entry.

## Installation

Installing to this machine is approved for the replacement-panel approach. Follow [CONTRIBUTING.md](../../CONTRIBUTING.md):

1. Check that `~/.config/herdr-app/mods/` has no conflicting `multi-root`, `multi-root-files`, `multi-root-changes` or `multi-root-spaces` folder. Copy the four runtime mod folders there. Updating an existing installation requires only changed runtime files.
2. Merge `multi-root/keys.json` into `~/.config/herdr-app/keys.json`, adding the one `global` key. Confirm first that `cmd-shift-t` is still unbound.
3. In the personal layout `~/.config/herdr-app/layouts/main-graph.json`, change only `content.mod` on three blocks. Keep their block ids, so existing layout actions keep working:
   - block `spaces`: `"spaces"` becomes `"multi-root-spaces"`
   - block `files`: `"files"` becomes `"multi-root-files"`
   - block `changes`: `"changes"` becomes `"multi-root-changes"`
4. Check `layouts/main-graph.error` and `herdr-app status`. To undo, restore the three mod names. The sidebar addition below has only been installed in the isolated verification window; its change to the person's live layout remains pending.

Shipped layouts such as `main` are read-only. People using one first run `layout.clone` and then edit the clone the same way. `RECIPE.md` must say this.

## Limits in the first version

- This machine only. Remote spaces and Windows use the upstream behavior.
- One space per workspace and one workspace per config file.
- The clones do not follow Herdr updates. Diff them against the upstream base recorded in `RECIPE.md` when Herdr changes `files` or `changes`.

## Delivery

Commit messages follow `type(scope): description` in English, for example `feat(multi-root): add multi-root Files panel`. The user authorized commits, pushes and public catalog distribution on 2026-10-31. No PR or repository-license change was requested.

### Spaces entry addition (2026-10-31)

The current request adds a separate sidebar button for a new multi-folder workspace while preserving the existing +. Implementation uses a `mod.clone` of `spaces` 0.1.10 (`9b8249038d8a6a9c`) and a `create` role in the existing menu runtime. This avoids editing Herdr's overwritten bundled mods. The compact rail stacks the buttons. The user selected a stacked-folder icon with a + at the lower right; the custom `folders-plus.svg` follows that request. The dialog collects a nonblank name and at least two distinct normalized folder paths before creating a local space. It reuses deferred attachment, keeps `file: null` until Save workspace, and adds nothing to Recent until a file exists. Existing mappings and shortcuts stay intact. Herdr 0.1.10 is required for the new tooltip/accessibility APIs; Files and Changes keep their previous upstream bases.

Source commit `ae9a10642a58fb622329fc0b7a3cc0c1d4003c09` was created on `agent/multi-root-space-entry`, based on `491294c57cf6c0a56e5577903f59ef93ca97ced8`. The user subsequently authorized committing this addition, merging it into `main` and pushing it on 2026-10-31. This is repository delivery authorization; the person's live layout has not been changed for this addition.

Verification uses `/tmp/herdr-space-entry-20261031/app`, an independent core socket and disposable Web/API folders. Native checks pass for all four runtimes on 0.1.10, including the unchanged Changes runtime that failed on 0.1.9. Actual UI actions verified the expanded/compact entry, native folder picking, duplicate rejection, removal, empty-name and minimum-folder states, cancellation, successful space creation and the unchanged ordinary-space +. Shared-state readback confirmed Product has exactly the Web/API roots, `file: null` and no Recent entry; Files rendered both roots and live `status` had no errors. The unedited native capture is [workspace-preview.png](../../multi-root/workspace-preview.png). Windows/remote interactions and unavailable-core/missing-folder errors were not exercised.

The isolated preview app and core were stopped after verification; fixtures and captures remain under the temporary verification directory. Installation requires syncing the menu and new Spaces runtime, then replacing only the personal layout's `spaces.content.mod`; the existing panel references and shortcut already suffice. Live installation remains separate from the authorized repository delivery.
