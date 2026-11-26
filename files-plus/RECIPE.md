# Files Plus

Browse and search one folder or a workspace with several roots in Herdr's Files panel. Add workspace folders with +, manage entries from the right-click menu, and send file references to agents. Open files in a Tab, a Pane or the right panel. Installed Preview Plus handles every file type and edits complete local text; Files Plus alone provides a read-only source viewer.

![Files Plus](preview.png)

The preview is an unedited `herdr-app shot` from a disposable Herdr 0.1.16 window showing ranked Files Plus results beside an open file in Preview Plus. The two `Guide.txt` results have different owning roots. All shown folders and documents are test fixtures. Preserve the capture's sRGB metadata.

## What you see

The panel defaults to 320px wide; its actual size belongs to the layout. The header shows the current directory basename, an Add folder control (`plus.svg`) and a settings button (`settings.svg`) at the far right. Long directory names truncate and expose their path in a tooltip; without a directory the title is Files. An internal preview adds a back control (`arrow-left.svg`) and a shortened preview path. Controls use SVGs with Herdr hover colors. The panel uses the shipped Files/Changes defaults: a 1px theme-colored border, 10px corners, a 42px header with a semibold title, 28px rows, 18px indentation per level and 6px tree padding. Body text is 13px; secondary labels are 12px. Icons are 12px chevrons and 14px file/folder glyphs. Roots show their display name and path, highlight the focused terminal's root, and show "Not found" for missing directories. The last activated file stays selected with a highlighted background after returning from preview. Git letters appear at the right of changed entries.

Dragging any file, folder or workspace root row at least 6px shows a floating `@` drag pill with the file or folder icon, entry basename and an `@` badge. When the pointer moves outside the Files panel, the pill updates its text to "Click to add @" with a copy cursor when a drop target is available, or a no-drop cursor when no terminal exists. The frameless floating overlay remains inside the Herdr window.

Pointer menus fit their longest label or status text using ASCII/CJK calibration probes in the native body and secondary text styles, with a 188px minimum and window-width cap. Measurement uses the same 13px body and 12px secondary sizes as rendering. Following Git Graph's integration approach, Herdr draws the standard popup/dialog border, corners and shadow. Menu rows use the native 30px height and 7px corners; dialog inputs are 36px high, buttons 32px high and both use 8px corners. Internal borders use the native 1px primitive and Herdr border/input colors. Menus clamp inside window edges in zoom-normalized coordinates. Errors widen and reopen the menu when needed. Name and confirmation dialogs fit the action and path, between 420px and 560px wide within the viewport, with room for native input, status and action controls. Disabled actions use Herdr's muted text; errors and progress stay visible.

Use theme-provided fields directly for their control roles; retain Herdr's shipped control defaults where no field exists. Herdr 0.1.11's `theme()` exposes colors, not a complete control stylesheet. The general `cx.theme()` typography, spacing and radius scale is not the style used by Herdr's Files/Changes/Graph panels and must not replace their defaults. `appearance.js` only reads colors from `theme()` and the UI font family from resolved `settings()`; it defines no palette or type/spacing/radius scale. All colors preserve transparency and user overrides. Source previews use Herdr's resolved code font/size and syntax colors. UI and code sizes receive zoom exactly once. Retained rows and open previews follow same-appearance color changes and configured font changes without rereading files. Herdr version changes require rechecking the shipped defaults; unexposed style constants cannot be synchronized automatically.

Buttons, menu entries and tree rows retain the default arrow pointer. Header controls have 6px corners and use Herdr hover/selected surfaces. Hover only changes the target's own styles; menu hover does not change keyboard selection through JavaScript. Disabled controls use `theme().dim`, keep the default pointer and have no hover action. Dialog primary buttons retain their fill/contrast colors and use 0.88 hover / 0.8 pressed opacity, like native Herdr prompts; destructive confirmations use the theme error color. Secondary buttons use hover/selected surfaces. Presses stop propagation to their container. Drag gestures retain their existing copy/no-drop/grabbing feedback.

The optional [sidebar pointer patch](patches/sidebar-default-pointer.patch) changes the existing personal `multi-root-spaces` clone's New multi-folder workspace button to the default pointer while preserving its native hover style. Apply it only to an already installed matching clone; the package does not reinstall that retired component or modify a bundled Spaces mod.

## How it behaves

Requires Herdr 0.1.16 or newer. Retain each `watchFolder` promise and cancel that caller's pending handle on context/config replacement, unneeded-root collapse and close. A recursive root watch remains while expanded, searched or needed by an internal preview; child collapse alone does not remove a still-needed root watch. Config and tree watches have separate owners, including when their directories coincide. An empty cancellation result terminates the loop. Keep request/generation guards after cancellation and include the machine in workspace identity. Watch failures remain visible; local safety polling and bounded remote polling still apply.

### Tree browsing and virtualization

Folders load lazily, directories sort first, hidden entries are included and `.git` is omitted. Symlinks appear as files and are not recursively followed. Visible rows are flattened and partitioned into retained chunks of 100 rows in child views inside a native scrolling container. Scrolling executes entirely in native Rust with zero JavaScript calls per frame. Unrelated live updates (such as agent ticks or terminal output in other panes) rebuild zero tree rows.

Local safety polls run every 60 seconds while visible; remote folders poll every 10 seconds. Incremental filesystem watching via `watchFolder` maps changed paths back to their parent directories, debounces filesystem bursts by 200ms, lists at most four folders concurrently, and reloads only expanded affected folders. Internal `.git` lock churn is ignored, and Git status is throttled to once per repository every two seconds. Cached physical roots and repository discovery persist until context or config changes.

### Filename and path search

A 30px native input below the header searches files under the current single-folder root or every declared workspace root, including closed roots and unopened descendants. It uses 13px text, a 0.5px input border and existing Herdr theme colors. Results use 48px rows with a 13px basename and 12px relative path. Duplicate filenames and multi-root results show the root beside the relative path, with separate space for both labels. Duplicate root names use the logical root path. A tooltip preserves the full root, path and remote machine.

Search ranks exact full filenames, exact names without the extension, filename prefixes and other literal filename matches ahead of path-only matches. A single word made of letters or digits can also match initials or an ordered subsequence of the name without its extension. Initials recognize word separators and camel case. Fuzzy matches favor compact groups of letters. Comparisons ignore case and normalize Unicode for matching. Result paths keep their original spelling.

For literal path matching, all whitespace-separated terms must occur in the root-relative path in any order. Use `/` for path separators. Punctuation, glob characters and regex characters are literal, as in `src/ report .ts`. Only files are shown as results. Hidden and Git-ignored entries stay searchable. Entries named `.git` are excluded at every depth. Symlinks appear as files and are not followed recursively. A declared root may itself be a logical alias.

Search reads directories breadth-first with up to four listings per batch. Each query checks at most 10,000 entries, including directory entries, and attempts at most 256 directory reads across all roots. It ranks that set before taking the first 200 matches. Only a confirmed extra match produces "200+ results. Refine search." A reached scan limit with work left, or a missing or unreadable folder, produces "Search incomplete" with details and retains the matches found so far. Every query reuses the current POSIX or Windows listing helper. An empty query shows the tree.

Typing is debounced by 180ms. New queries, changed roots/spaces/machines and closing the view invalidate pending replies. The query is re-run against changed roots; focus movement within an unchanged workspace retains it. Filesystem events and existing safety polls refresh an active search, including changes below unopened folders. A running scan finishes before a later poll can restart it; files changing during a scan are not an atomic snapshot and are picked up by subsequent refreshes.

Up/down moves the selection and scrolls it into view. A result click respects the saved opening preference; Enter requests the paired temporary slot, falling back to that preference without pairing. Both preserve machine/root identity and existing Tab/Pane reuse. Clear or Escape returns to the retained tree and focuses it. Back from the paired Preview restores search focus when a query is active. Search adds no global shortcut or key binding.

### Text editing and Preview Plus handoff

The settings button opens a 360×264px dialog with three choices: Tab in center panel (default), Pane in center panel, and Inside right panel. Selection saves immediately across panel copies and restarts. Up/down changes the selection; Done or Escape closes the dialog. The choice applies to subsequent file clicks.

Tab opens a mod-only tab named after the file in the captured space. Pane splits the captured center pane to the right; without a center pane, a notification asks the user to select one. Both keep the file and machine fixed even when focus changes. Every file type uses Preview Plus with `{file, root, on}` when installed, without requiring a layout stack or an extension allowlist. Complete local UTF-8 text supports editing, Save, Wrap lines, native undo/redo, confirmed discard and external Open. This includes source code, configuration, hidden files, unknown extensions and extensionless files. Rich previews retain their existing formats. Images/PDFs remain preview/Open only; other binary files show an explicit state with Open. Remote text and truncated text remain read-only. An unavailable receiver falls back to `files-plus` with `role: "preview"`; that read-only source view refreshes every ten seconds.

Before opening, reuse an existing Files Plus or Preview Plus file Tab/Pane with the same full path and machine. Prefer a match in the current space, otherwise select its space and tab, reveal it if a sibling was zoomed, and focus its pane. This also applies after changing the opening preference. A closed preview does not prevent a new one. Read the core's `herdr-app` document using the read-only `doc.get` RPC through `hc connect`, and cross-check the target against live spaces, tabs and panes. This discovers previews opened before the mod reloaded without keeping a separate registry. If that lookup fails, show an error instead of opening a potential duplicate.

Inside right panel uses Preview Plus when paired in a layout stack. Without that pairing, it replaces the tree with the built-in read-only syntax-highlighted source viewer (`EditorState` with `readonly: true`). Back returns to the existing expanded tree and restores row selection. File changes refresh the tree, Git marks and an open preview. An unchanged file and look keep the existing editor and scroll state. A code-font or syntax-color change recreates the read-only editor from its cached text because Herdr exposes these options only at construction. Switching terminal focus within a workspace preserves expansions and previews.

In Inside right panel mode, when paired with Preview Plus via `props.previewStack` in a layout stack, clicking any file publishes the target `{ file, root, on }` to `shared("preview-plus.target")[spaceId]` and selects `preview-plus` in that stack. Preview Plus owns content handling and the editor toolbar. If Preview Plus is not installed, files fall back to the built-in source viewer.

### Keyboard handoff

`files-plus.search`/`focus` enters search; `return` restores search or tree focus; `preview`, `add-to-agent` and `agent` operate on the selected result/row. Unmodified F6/F7/F8 provide those three actions while Files has focus. Tree arrows and Enter select/collapse/expand/open; Escape focuses search. Preview F6 returns and F7 pins. See the [keyboard table](README.md#keyboard-workflow) and path-free [example layout](../preview-plus/examples/files-preview-agent.json).

Keyboard preview reuses the paired slot independently of the pointer opening preference. The payload includes file/root/machine, a selection identity and the captured agent target. A pinned slot refuses a different file; no new pinned pane is created. Explicit `@` insertion uses the captured terminal even after focus returns from Preview, rejects a changed/closed space or a different machine, quotes paths and restores its clipboard text without submitting Enter. Existing pointer drag and opening preferences retain their behavior.

### Native motion and transitions

Folder children expand from 0px to the native 28px row height and collapse back to 0px with native height and opacity transitions, using 250ms `ease-out`. Closing rows stay mounted for the transition and reject clicks and drags, while their directory state is released immediately. Reopening a folder retargets its existing rows; old cleanup callbacks cannot remove reopened children or affect another workspace. Loading and empty-folder placeholders use the same row motion.

Menus, dialogs, the drag pill and tree/source previews appear without custom entrance effects. Loading labels pulse natively. Each retained row chunk waits for the new rows' initial native size callbacks before changing their entrance targets. It coalesces mounted rows into one deferred update; a loading placeholder cannot start the entrance of replacement file rows before those rows have mounted. One cleanup callback releases outgoing rows after 250ms. Timers never animate individual frames. Motion uses Herdr's native GPUI engine; GSAP's `requestAnimationFrame`/`setTimeout` ticker is unavailable in this runtime. Panel resizing has no animated reflow.

### Right-click file manager menu

Right-click captures the entry, owning root, physical alias, machine and active terminal before the popup takes focus. Up/down arrows navigate items, Enter chooses, and Escape closes. Long-running actions keep their owner open until they finish; errors remain visible.

- Add to agent `@` pastes a reference and a trailing space into the captured terminal without Enter. It uses a relative path only when the terminal and entry share a root and the entry is beneath the terminal's cwd. Otherwise it uses the absolute path. It quotes whitespace, quotes and backslashes, matches physical cwd paths to declared root aliases, and refuses unavailable terminals. It restores the previous clipboard text, including an empty string.
- Copy stores the entry's path, kind and machine in `shared("files-plus.clipboard")`. Paste targets the clicked directory or a file's parent on the same machine. It chooses `name copy.ext`, `name copy 2.ext` or the corresponding folder name without overwriting files. It rejects directory cycles, including POSIX symlink aliases into the source, and copies symlinks as links.
- Copy path copies the absolute path. Copy relative path uses the entry's workspace root and returns `.` for a root row.
- Reveal opens Finder with `open -R` on macOS, File Explorer with `explorer.exe /select` on Windows, or the Linux file manager with `xdg-open`. Remote reveal is disabled.
- New file and New folder ask for a name in the clicked directory or a file's parent. They reject blank names, `.` and `..`, separators, control characters and existing entries.
- Rename opens a prefilled dialog and changes the entry's name within its parent directory. It rejects collisions and cannot rename workspace roots.
- Move to Trash asks for confirmation. On local macOS it moves the entry to `~/.Trash`, choosing an available name. Other platforms and remote machines show a permanent-deletion confirmation.
- Workspace roots offer New terminal here and Remove from workspace. The first opens a terminal tab in the captured space and root. The second removes the workspace mapping without deleting disk files and requires at least one root to remain.

### Drag to agent

Drag a file, folder or workspace root at least 6px to show the floating `@` pill, then click outside Files to insert into the captured terminal without Enter. The pill shows "Click to add @" outside the panel. Click inside Files, Escape or right-click to cancel. Releases delivered to the floating surface also complete or cancel the operation; Herdr 0.1.11 can retain the original mouse grab, so click completion remains available.

When Files has keyboard focus, target capture inspects the active tab and picks in priority order: the focused terminal pane, then a running Agent pane, then its first terminal pane. Focus in another space never falls back. Herdr exposes no split-pane rectangles, so the drop destination is the captured terminal of the shown tab throughout the workspace area. The frameless floating overlay stays inside the app window.

### Independent browsing folder

The header folder button opens **Change folder…**, a local system picker. The chosen path becomes a per-space browsing override in `shared("files-plus.browsing")`, without changing terminal cwd, tabs, the space name, workspace mappings or workspace files. Tree browsing, search and file opening use that path. **Use terminal folder** clears the override; for a workspace the same control is labeled **Use workspace folders** and restores all declared roots. Overrides survive reloads and stay scoped to the original space and machine.

Cancel leaves the current folder unchanged. Repeated clicks do not open duplicate pickers; closing the panel invalidates a pending result. A picker captures its original space, so changing focus cannot apply the path to a different space. Remote folder picking is disabled because the system picker selects local paths. Missing or unreadable chosen folders use the existing tree error state.

The **+** button remains a workspace operation, not a browsing control. It retains the original terminal/workspace root when adding another folder, even while a browsing override is active. This intentionally does not implement the issue's optional single-root replacement, which would mutate workspace configuration.

### Multi-root workspaces and persistent + folder addition

Add folder works for local POSIX spaces, including ordinary single-folder spaces and preview headers. Captures the original space and displayed folder before opening the system picker. Cancel and duplicate selections leave data unchanged. Adding a different folder converts an ordinary space to an unsaved workspace, preserving its name, tabs and terminals.

Existing workspace files use a captured expected-text write: preserve path spelling, string entries, unknown fields and two-space formatting; new folders use relative paths. A conflicting disk edit reloads instead of overwriting the file. A closed or replaced target cannot be recreated by a late completion.

### Paste workspace roots to an agent

In a local workspace with two or more distinct declared roots, right-click a root and choose **Paste workspace roots to agent**. The action appears for a live agent in the active tab that reports idle or done. Focus the intended agent first when the tab has multiple agents. The action uses the agent captured when the menu opens and the declared paths in workspace order. A browse override, a single root, a plain shell, a working or blocked agent, or a path with control characters prevents the action from appearing.

The paste uses the same focus and clipboard flow as **Add to agent (@)**. It inserts one editable line with quoted absolute paths and a request to check each root for applicable instructions. The user decides when to submit it. If the space, tab, terminal or root list changes, reopen the menu to capture the current context. Closing the menu cancels a paste that has yet to reach the terminal.

**New terminal here** opens a shell. Herdr's agent launch commands accept `task` as the first message. Use the root menu to paste the draft once the new agent is ready.

The multi-root agent context proposal comes from [@teomurgi's PR #9](https://github.com/linziyanleo/herdr-mods/pull/9).

While the Files Plus panel is loaded, it sends existing and newly observed agents in a declared workspace the current root list. Root additions, removals and workspace-file reloads that change the list broadcast the revised composition to that workspace's agents. The message identifies the workspace as multi-root and asks agents to check every root for applicable harness or instruction files. It uses `hc send --if idle`, which submits a normal message rather than modifying an agent's system prompt or filesystem permissions. Automatic delivery waits for an idle agent; working, blocked and done agents remain pending. The core repeats the idle guard immediately before typing, so a status change cannot steer an active turn or force a blocked dialog.

Delivery receipts and expiring ownership claims are shared between panel copies and survive mod reloads. Unchanged successful compositions are not resubmitted for the same observed terminal session, identified by address, space, reported app and terminal creation time/PID when available; this is not an agent-conversation identifier. Failed sends include the transport error in a notification and remain pending until the agent's status changes or its roots change; unchanged failures do not retry on every redraw. Queued sends revalidate the live agent, session, workspace composition and owner before dispatch. A receipt is invalidated only at dispatch of a different root composition, so a queued A → B → A change preserves the A receipt. Root changes during a send are serialized, with the latest observed composition sent afterward. Multi-root delivery supports local non-Windows workspaces only; Windows and remote workspaces are excluded.

Closing a panel cancels its queued deliveries but cannot revoke an already-dispatched `hc send`. An in-flight claim stays reserved until completion or its 30-second lease expires; active senders renew every 10 seconds. After a crash or a lost completion, a takeover may resend an update whose receipt is unknown. This is not an exactly-once transport guarantee. Receipts identify sessions by address, space, reported app, and terminal creation time/PID when available; Herdr does not provide a universal agent conversation ID.

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
    LICENSE, THIRD_PARTY.md, licenses/
    main.js, workspace.js, agent-context.js, tree.js, metrics.js, fit.js, drag.js
    roots.js, config.js, actions.js, appearance.js, preferences.js, open-files.js, search.js
    mod.json, file.svg, folder.svg, chevron-down.svg, chevron-right.svg, arrow-left.svg, plus.svg, settings.svg
  tests/
```

Create `mods/files-plus/main.js` with a default-exported class that extends GPUI `View`. Route `props().role`: absent for the panel, `menu` for a pointer popup, `dialog` for a modal name, confirmation or root action, `settings` for the open-location dialog, `preview` for a fixed file viewer, and `drag` for the transparent full-window drag surface. Pass a captured target and an action into overlays. The overlay id comes from `props().overlay`.

Keep tree state, incremental local watchers, Git marks and read-only previews in `workspace.js`. `agent-context.js` sends workspace root context to every agent in a declared workspace when an agent appears or its root list changes. `tree.js` flattens visible rows and retains groups of 100 rows in child views inside a native scrolling container. Unrelated live updates do not rebuild rows. Local safety polls run every 60 seconds while visible; remote folders poll every 10 seconds. Debounce filesystem bursts by 200ms, list at most four folders concurrently, and throttle Git status to once per repository every two seconds. Cache physical roots and repository discovery until context/config changes or missing-root recovery. Put path and workspace helpers in `roots.js`, guarded config saves in `config.js`, filesystem and terminal actions in `actions.js`, and direct Herdr appearance reads in `appearance.js`. Do not call `set_theme` or change the shared theme from this mod. There are no cross-mod code imports. The package manifest is:

```json
{
  "place": "right",
  "size": 320,
  "focusable": true,
  "cloned_from": { "name": "files", "version": "0.1.9" }
}
```

No `keys.json` snippet is needed. Bind menu arrows, Enter and Escape to its focus handle; keep ordinary terminal shortcuts unchanged. `search.js` owns the independent scan, retained search input and virtual result list with a native scroll handle. It passes its remaining entry budget to the existing listing in `workspace.js` and leaves tree state to the tree view.

The current implementation requires Herdr 0.1.16; see the [current verification record](../docs/plans/interaction-performance-implementation.md). Use `cx.spawn`, `cx.timer`, `cx.sleep`, focus handles and clipboard APIs from GPUI; `EditorState`, `Editor`, `InputState`, `Input`, flex builders and SVGs from gpui-base/gpui-kit. Herdr provides live spaces/panes/terminals/agents/focus/settings, `shared`, `setShared`, `checking`, `nextCommand`, `exec`, `hc`, `readTextFile`, `writeTextFile`, cancellable `watchFolder`, `pickFolder`, overlays and `run`. Opening/focus commands include `pane.focus`, `terminal.paste`, `tab.new`, `pane.split` and `layout.select`.

### Optional panel fitting

Use the props and sizing rules in [Adaptive panel fitting](#adaptive-panel-fitting). Fitting requires a named layout node and respects its limits, app zoom and manual divider changes.

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
"files-plus.open-location": "tab" | "pane" | "internal" // missing/invalid defaults to tab
"preview-plus.target": Record<SpaceId, { file: string; root: string; on: string | null }>
"files-plus.agent-context": Record<AgentAddress, {
  session: string;
  space: SpaceId;
  delivered?: string; // JSON root-path signature
  failed?: { roots: string; status: string | null };
  claim?: { owner: string; id: string; expires: number; dispatched: boolean };
}>
```

`path` is resolved and absolute; `source` retains the declared spelling. `file: null` denotes an unsaved workspace. Retain the ten most recent saved config paths. Prune closed workspace mappings only when `machines()` reports the local layout as ready.

Before a root action, capture the space and the config text. Preserve original string entries, path spellings and unknown fields when saving. Write new roots relative to the config directory, using two-space JSON and a trailing newline. Call `writeTextFile(file, text, expectedText)` once. If the expected text is stale, reload and report the conflict without retrying the write. Check the captured mapping before changing it; a late completion must not recreate a closed space.

### Loading and actions

Store loaded directories in a map and expanded folders in a set. Load a directory only when expanded. Share the 5,000-entry budget across roots, sort directories first, and do not traverse symlinks. On POSIX, list names with NUL delimiters so whitespace and newlines remain names. On Windows, use PowerShell literal-path operations. Read Git porcelain status per distinct repository and translate its paths back to declared root paths.

Use `watchFolder` on local roots and the config directory. Reload the config only for changes to its file. Poll remote folders through the 10-second refresh. Guard all asynchronous results with the captured context and request identity. Build `EditorState` with `readonly: true`; retain the existing editor if preview bytes have not changed. Handle missing, binary, unreadable and oversized files as visible states.

Capture `{space,path,kind,root,physicalRoot,on,active:{pane,terminal,cwd}|null}` before opening the popup. The physical root is derived data, never a saved workspace field. All actions use this target rather than the popup's current focus. For agent insertion, save the clipboard text, focus the captured terminal, yield with `cx.sleep(0)`, paste the quoted reference, yield again, then restore previous text if present. `run()` returns no completion result, so restoring the clipboard before that yield can paste the wrong bytes.

Use `cx.spawn` for slow work. Create focus handles, inputs and editors in `init`, events or asynchronous tasks, never during `render`. Each callback uses its own context. Release retained inputs and editors when the view closes. Keep an asynchronous menu action alive until completion, or transfer it to a dialog before closing the menu.

### Dependencies and access

POSIX operations use `sh`, `cp`, `mkdir`, `mv` and, after explicit confirmation outside local macOS Trash, `rm`. Git marks use Git with `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`. Windows retains PowerShell folder listing and file commands. Existing file lookup uses the installed `hc connect` JSON-RPC interface through a fixed sh or PowerShell pipeline; remote document reads use the RPC's `on` parameter. Reveal uses `open -R`, `explorer.exe /select,…` or `xdg-open`. Paths and RPC data are arguments, never interpolated shell source.

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

With Inside right panel selected, both the prop and installed receiver, every file publishes the captured target and selects `preview-plus`. The receiver returns with `layout.select {stack:"files",child:"files-plus-tree"}`. Files Plus retains its expansions and search while hidden. Without the receiver, fall back to source preview. Stale asynchronous reads and receiver checks cannot replace a newer selection or another space. Tab/Pane reuse remains path-and-machine based.

### Attribution

The Files tree, editor and original SVGs derive from [Herdr files 0.1.9](https://github.com/herdrdev/herdr-app) (Apache-2.0). The settings SVG comes from Herdr 0.1.12's workspace-chrome Lucide icon. Preserve [the Herdr license](licenses/Herdr-APACHE-2.0.txt) and [Lucide/Feather notices](licenses/Lucide.txt). Original project contributions are licensed under [MIT](LICENSE); the upstream portions retain their own terms. The runtime [THIRD_PARTY.md](mods/files-plus/THIRD_PARTY.md), `LICENSE` and `licenses/` must accompany installed and redistributed copies.

Filename search takes interaction concepts from [cybertron288's filetree](https://github.com/cybertron288/herdr-mods/tree/main/filetree) and [Mantiq's Telescope](https://github.com/Mantiq-com/herdr-telescope): search alongside browsing and keyboard selection of file results. The implementation uses this package's existing listing and opening contracts. No source, assets or dependencies from those projects are copied.

### Focus and terminal folders

A cwd-less third-party mod pane retains this Files panel's most recently observed terminal folder for the active space, retaining the terminal's execution machine with its path, rather than returning to the space's initial folder. Current terminal cwd wins. A neutral pane uses the remembered terminal pair before the older paired Files/Preview fallback, so transient missing focus cannot overwrite it with the initial folder. Manual browsing still overrides the displayed folder without replacing terminal history, and workspace roots and preview pins are unchanged.

The fallback lives only in the panel instance, is discarded for removed spaces or a changed space machine, and is not written to shared state or restored after reload. A cold panel with no observed terminal cwd uses the space's initial folder; it does not guess from an unfocused terminal or check whether a remembered directory still exists. Missing folders retain the normal error behavior.

## Watch out

Keep the inherited tree/preview limits: 500 entries per folder, 5,000 loaded tree entries across all roots, 40 nested tree levels, 400,000 preview characters and Herdr's 1 MiB text-read ceiling. Filename search has its separate 200-result bound and does not inherit the tree traversal limits. Binary, missing, unreadable and oversized files show explicit source-preview states. Preview Plus owns rich rendering, links, images, PDF conversion and structured-data views.

Workspace management supports local POSIX spaces; Windows and remote spaces retain single-folder browsing. Windows/Linux/remote native interactions need verification on those systems. Clipboard operations can restore previous text, but not a previous non-text clipboard. Tests do not install into the person's normal app home, replace their layout or change shortcuts.

## Done when

The [0.1.16 implementation/verification record](../docs/plans/interaction-performance-implementation.md) covers current lifecycle and keyboard changes, with physical gaps kept open. Historical paragraphs below retain their original acceptance scope.

Search ranking verification (2026-11-23): all 113 Files Plus Node tests and both the main and populated-search `herdr-app check` passed. On macOS 27.2 with Herdr 0.1.16 and core 0.1.21, the background native driver exercised result ranking, duplicate roots, rapid query replacement, Unicode paths, partial scans, selection and Escape. With Preview Plus installed in the disposable home, native commands exercised Enter, F6, pin and unpin, return to Files, and reuse of an existing fixed tab. A separate loopback core verified same-path remote identity and opening. F7 reference and clipboard behavior were exercised by Node tests. Physical input, Windows and Linux windows, and another physical host remain open for verification.

The same 2,402-file, 21-directory fixture was measured on `9d8e017` and P1 with seven alternating pairs after warm-up. The native timer covered directory reads and ranking from the search call to its response. The loopback used a second core on the same Mac.

- The first query, `needle.txt`, placed the previously missed exact filename first. Local median went from 94 to 235 ms and loopback median from 130 to 418 ms. Both ran 5 directory reads at baseline and 21 in P1.
- The next query, `z-source target`, used 21 directory reads on both versions. Local median went from 167 to 168 ms and loopback median from 369 to 338 ms. The ranges overlapped for this query.

All-file routing verification (2026-11-06): the combined automated checks, affected-test rerun, both native mod checks, eight paired handoff groups and four native editor groups pass as detailed in the [delivery record](../docs/plans/preview-plus.md#all-file-editor-routing-2026-11-06). The paired groups include TypeScript, YAML, hidden, extensionless and unknown-extension text with exact save readback, wrap, confirmed discard and retained tree state. Rich-preview formats are unchanged.

Build and exercise these observable behaviors using disposable folders:

1. `herdr-app check <app-home>/mods/files-plus` passes. The single-folder tree handles loading, empty, unreadable and missing states, hidden names and symlinks. Expanded directories respect the per-folder and total limits.
2. A directory name replaces the Files title, with settings at the far right. The settings dialog remembers Tab, Pane or Inside right panel. Default clicks open a center Tab; Pane splits the captured pane. Repeated clicks on the same path and machine select its existing Tab/Pane without adding one, including an existing preview in another space or created before reload. Closed previews can be opened again. Text and Markdown open as read-only source without Preview Plus. In internal mode, Back returns to the same tree. Binary, absent and oversized files show their own states. A file edit refreshes the preview; unchanged bytes retain the editor state.
3. A two-root saved workspace shows both trees, root names, Git marks and missing roots. Focus changes retain expansion and previews. An invalid config keeps the last valid roots with a visible error.
4. Same-root and cross-root agent references reach the captured terminal with the correct quoting and trailing space, without Enter. Previous clipboard text is restored. A closed terminal is refused.
5. Copy and Paste preserve the source and choose available copy names. A directory cannot be pasted into itself or through a symlink into a descendant. Cross-machine paste is disabled. Absolute and relative path copying uses the clicked entry's owning root.
6. New file, New folder, Rename, Trash confirmation and local reveal act on the clicked target and refresh the tree. Invalid or existing names are refused. Cancelling a dialog writes nothing. Root rename and deletion remain disabled.
7. The native folder picker can confirm and cancel. Duplicate selections leave the workspace unchanged. A different root extends the captured space even if focus moves elsewhere. Saving preserves custom fields, and a conflicting disk edit is not overwritten.
8. Root actions retain one root, leave removed roots' files intact, and launch a terminal in the captured root and space.
9. With a compatible Preview Plus receiver and stack, every file switches the panel and Back restores the existing tree. Code, hidden files, unknown extensions and extensionless text expose editing, Wrap, Save, discard and Open. Missing receivers fall back to source; stale requests cannot replace a later selection. Rich rendering and text/binary/remote/size boundaries belong to Preview Plus.
10. `herdr-app status` reports no mod or layout errors. Capture the running panel with `herdr-app shot preview.png`. Use disposable content and retain the native PNG color metadata. Ship this folder without a `layouts/` directory or unused key bindings.
11. Unrelated live updates rebuild no retained rows. Watches reload only expanded affected parents, lock churn does no work, unchanged data does not redraw, and loaded entries never exceed the budget.
12. Both menu kinds fit their text and remain inside window edges at 100% and zoomed scale. Herdr colors, configured UI/code fonts and native overlay frames apply to the relevant controls, including same-appearance theme changes. The panel border, corners, header, row sizes and title weight match shipped Files/Changes defaults at the same zoom; generic GPUI tokens cannot change them. An open source preview follows configured fonts without a file reread. Selection persists after Back. Opt-in fitting keeps width stable on folder toggles and respects ratio/pixel caps and manual divider overrides.
13. A short press remains a click. Drag to show the pill, then click outside Files to insert one reference without Enter and restore clipboard text; clicking inside, Escape and right-click cancel. Check direct release delivery on the installed Herdr version and retain click completion when the original view keeps the mouse grab.
14. Search finds unopened nested files, including beyond the tree entry/depth limits; identical relative paths across roots stay distinguishable. Literal terms, hidden/ignored policy, empty/error states and honest result truncation agree with the contract above. Delayed queries and changed roots cannot open stale targets. Native typing, arrows, Enter, result clicks, Clear and Escape work, and the original expanded tree survives. `node files-plus/tests/check-search.mjs` checks a populated native search description without starting a window; `native-search.mjs` prepares the separate runtime acceptance report.

The committed package also includes automated and isolated native test drivers. Their commands are in [README.md](README.md); they are development tools, not runtime dependencies. The 2026-11-06 search addition passed automated tests, mod checks and five native driver groups. The current preview shows the Files Plus tree beside a TypeScript file in Preview Plus. Real Files Plus handoffs to JSON/CSV/TSV previews also passed. Physical keyboard/pointer dispatch and additional platform/theme combinations remain unverified; see the [implementation plan](../docs/plans/files-plus.md#filename-and-path-search-2026-11-06).

### Independent browsing verification (2026-11-12)

On macOS with Herdr 0.1.15, all 88 Files Plus Node tests passed, including seven browsing regressions; the five repository licensing tests and `git diff --check` also passed. `herdr-app check files-plus/mods/files-plus` passed outside the execution sandbox after the sandbox blocked LaunchServices. `native-browsing.mjs` passed single-folder and multi-root override/reset checks in a disposable app home, including unchanged workspace mappings.

Physical system-picker interaction, Windows/Linux rendering and remote behavior in a real remote session were not exercised. Native screenshots were captured and inspected, but this session's frame capture remained on a prior panel state, so visual acceptance of the override/reset controls is still pending. The existing preview image is intentionally unchanged; do not treat model-state checks as visual acceptance. No files were installed in the normal app home.

Installation follow-up: the three changed runtime files were installed in the maintainer’s normal Herdr home after backing up the two existing files. The installed mod passed `herdr-app check` (a first checker-launch timeout succeeded on retry). This does not establish physical picker acceptance.

### Cwd-less pane regression checks (2026-11-17, issue #8)

`node --experimental-vm-modules --test files-plus/tests/location.test.mjs` exercises third-party pane focus, repeated terminal changes, independent spaces, local/remote identity (including terminal blocks), manual Browse, paired preview/pins, cold copies and removed spaces through the production location resolver. Eight of the eleven groups reproduce failures on the preceding `b0c43c1` runtime. These are host-model behavioral tests, not physical pointer/keyboard acceptance. No normal app-home installation or live UI changes are part of this verification.

Final-code validation: all 216 Node tests passed with `node --experimental-vm-modules --test --test-concurrency=1 files-plus/tests/*.test.mjs preview-plus/tests/*.test.mjs mods-plus/tests/*.test.cjs tests/*.test.mjs`; the affected location/browsing/panel subset passed 31 tests, and `herdr-app check files-plus/mods/files-plus` passed on macOS / Herdr 0.1.16. The initial concurrent aggregate hit an unchanged Preview Plus PDF readiness timeout; the serial final-code run passed without changing that test. Physical UI acceptance and a new screenshot were deliberately not run, to leave the daily app undisturbed.

### Workspace context paste verification

`node --experimental-vm-modules --test files-plus/tests/workspace-context.test.mjs` exercises menu capture, distinct roots, eligible agents, stale destinations, cancellation and the exact pasted text. The serial repository suite passed 242 tests, and `herdr-app check files-plus/mods/files-plus` passed on macOS with Herdr 0.1.16.

`native-session.mjs --background` ran the native menu in a disposable app home. Raw terminal recorders used [Herdr's OSC 7501 status protocol](https://herdr.dev/core/#status-from-the-source) to report idle or working. The idle recorder received both root paths on one line without Enter. Opening and closing a menu produced no input. A switched tab or space and a closed terminal rejected the captured target. `herdr-app shot` showed the action with two roots and an idle recorder, and its absence with one root or a working recorder. Physical pointer input, real coding agents and remote hosts were outside this run.

### Agent workspace delivery verification (2026-11-19)

`node --experimental-vm-modules --test files-plus/tests/agent-context.test.mjs files-plus/tests/panel.test.mjs files-plus/tests/workspace.test.mjs files-plus/tests/browsing.test.mjs files-plus/tests/location.test.mjs` passed all 47 tests. Seven agent-context groups cover initial/new agents, additions/removals, failure reasons and status-transition recovery, independent panel module copies sharing delivery ownership, reload deduplication, queued cancellation, in-flight root changes, and focus/browsing isolation. The restored `home` and `appHome` host exports are exercised through production FilesPanel imports and behavior.

These checks use a simulated Herdr host and mocked `hc`; no messages were sent to real agents. After updating the local Linux app from Herdr 0.1.7 to the official 0.1.16 release, `herdr-app check files-plus/mods/files-plus` passed. The existing core remained at 0.1.13. No Files Plus runtime installation, live-window interaction acceptance, screenshot or exactly-once transport verification is claimed.
