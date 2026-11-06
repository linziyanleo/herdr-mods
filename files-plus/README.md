# Files Plus

Browse folders, search file names and paths, and manage files in Herdr's Files panel. Use one directory or a saved workspace with several roots. Right-click entries to copy, paste, rename, remove, reveal or add an `@` reference to an agent.

![Files Plus](preview.png)

## Open and edit files

The header settings choose where files open. Tab is the default; Pane opens beside the current center pane; Inside right panel replaces the tree. Reopening the same path on the same machine focuses its existing file tab or pane.

With [Preview Plus](../preview-plus/README.md) installed, Tab and Pane send every file to it. Complete local UTF-8 text opens in its editor, including code, configuration, hidden files and files with unknown or no extensions. Markdown, JSON, CSV, TSV, supported images and PDFs have dedicated previews. Remote and truncated text remains read-only.

Inside right panel uses Preview Plus when both mods share a [layout stack](RECIPE.md#optional-preview-plus-pairing). Without that stack or without Preview Plus, the panel uses its built-in read-only source viewer. Files Plus also works alone.

## Search

Type in the field below the header to find files in unopened directories. All whitespace-separated terms must occur in the root-relative path, in any order and without regard to case. Terms are literal; this does not search file contents.

Search includes hidden and Git-ignored files, skips `.git` and does not follow directory symlinks. It shows up to 200 matches and reports when more exist. Multiple roots show their names beside results. Unreadable folders produce a partial-search message; large or remote roots can take longer to scan.

Up/down selects a result. Enter or a click opens it in the chosen location. Clear or Escape restores the tree with its expanded folders intact.

## Install

Use `${HERDR_APP_HOME:-$HOME/.config/herdr-app}` as the app home.

1. Check for an existing `mods/files-plus/`. For an update, back up the installed files and compare local changes before replacing them. Use another name for an unrelated mod.
2. Copy the runtime files from `mods/files-plus/`. Leave tests, generated type files and caches out. Keep the package's licenses with any redistribution.
3. Follow the [layout installation steps](RECIPE.md#installation) to replace the existing Files block without adding a second panel. Clone bundled layouts before editing them, and retain the `files` block id so the tab bar button still works.
4. Run `herdr-app check <app-home>/mods/files-plus` and inspect `herdr-app status`.

No shortcut changes or other mods are required. `mod.open {name:"files-plus"}` opens an overlay; replacing the Files panel requires the layout change above.

## Development checks

Run from the repository root with Node.js 22 or newer:

```sh
node --experimental-vm-modules --test files-plus/tests/*.test.mjs
herdr-app check files-plus/mods/files-plus
node files-plus/tests/check-search.mjs
```

For native checks on macOS, run `node files-plus/tests/native-session.mjs`. Pass its printed `session.json` path to the relevant driver:

| Driver | Checks |
| --- | --- |
| `native-verify.mjs` | File operations, workspaces and previews. Use `--installed` to reuse a prepared runtime. |
| `native-search.mjs` | Search results, selection, empty/error states and truncation. |
| `native-followup.mjs` | Menu sizing, panel fitting, manual width overrides and dialogs. |

Run these scripts from `files-plus/tests/` or include that directory in the command. They call production handlers and render native views. Verify physical typing, arrows, Enter, Escape, clicks, drag completion and scrolling separately.

For folder motion, start `native-session.mjs --motion`, then run `native-motion.mjs <printed-base>`. It samples row heights through expansion, collapse and reopening. Keep the disposable window in the foreground so it produces frames. It writes `motion-report.json` and `motion.png`.

For a render comparison, run `node --experimental-vm-modules files-plus/tests/benchmark.mjs <baseline-runtime>`. It alternates 20 samples per version on a 5,000-entry fixture and reports JavaScript render work separately from native layout and GPU time. `native-session.mjs --performance` and `native-performance.mjs <session.json>` measure idle calls over 60 seconds using the inline FPS monitor.

Reuse the disposable app home and core for follow-up checks. Close the test window with `HERDR_APP_HOME=<session-app-home> herdr-app do app.quit`. Keep tests out of the normal app home. The optional `--distinct-bundle` flag copies the signed app unchanged for separately targeted native input.

The [recipe](RECIPE.md) defines behavior, dependencies and limits. The [search record](../docs/plans/files-plus.md#filename-and-path-search-2026-11-06) and [all-file editor record](../docs/plans/preview-plus.md#all-file-editor-routing-2026-11-06) contain the completed automated and isolated native checks. Physical input and additional platform/theme combinations remain unverified for these changes.
