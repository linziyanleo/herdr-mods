# Preview Plus

Preview Markdown, images and PDF pages in Herdr's Files area or in a separate pane. Toggle Markdown between Preview and Source, follow local links with back history, and use Fit, zoom and PDF page controls.

![Preview Plus running in Herdr](preview.png)

Preview Plus works without Files Plus. It can replace the standard single-folder Files panel, open a file through `pane.split` or `tab.new`, or receive selected files from [Files Plus](../files-plus/RECIPE.md).

See the [recipe](RECIPE.md) for behavior, dependencies and verification. The [implementation plan](../docs/plans/preview-plus.md) records the shared target contract and implementation evidence.

## Install

Requires Herdr 0.1.11 or a compatible version exposing `TextView.on_link_click`, `image`, `EditorState`, `watchFolder` and `on_size_change`. macOS uses built-in Foundation, AppKit and PDFKit through `osascript`. Linux images require `python3`; Windows images require Python 3 as `python`. No service credentials or package installation are needed on macOS.

1. Check `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/preview-plus` for a name conflict. Stop if it exists; preserve the installed mod rather than merging files into it.
2. Copy only `mods/preview-plus/` into the app home's `mods/`. Do not copy `tests/`, generated type files or `.cache/`. Keep the notices in `licenses/` with any redistribution.
3. Run `herdr-app check <app-home>/mods/preview-plus`.
4. Use one of the three setups below. Clone a shipped layout with `herdr-app do layout.clone '{"name":"main","as":"my-preview"}'` before editing its structure. Preserve the surrounding Files/Changes block ids, sizes, visibility and shortcuts.

### Standalone Files panel

In a personal layout, change only the existing `files` block's content:

```json
{ "mod": "preview-plus" }
```

The focused terminal's folder appears as a lazy tree. Opening a file replaces the tree in place. Back walks followed links first, then restores the expanded tree.

### Pair with Files Plus

Install [Files Plus](../files-plus/README.md), then replace the existing `files` block with the stack below. Carry over the original block's layout sizing properties. Keep the outer `panel-body` stack and its `changes` child unchanged.

```json
{
  "id": "files",
  "type": "stack",
  "active": "files-plus-tree",
  "children": [
    {
      "id": "files-plus-tree",
      "type": "block",
      "content": { "mod": "files-plus", "props": { "previewStack": "files" } }
    },
    {
      "id": "preview-plus",
      "type": "block",
      "content": { "mod": "preview-plus", "props": { "previewStack": "files" } }
    }
  ]
}
```

Files Plus hands Markdown, supported images and PDFs to Preview Plus. Other text files retain Files Plus's source view. Preview Plus can also open text reached through a Markdown link. The two mods share targets, not code.

### Standalone pane or tab

Use an absolute file path; `root` defaults to the file's directory and `on` defaults to `null`:

```sh
herdr-app do pane.split '{"direction":"right","mod":"preview-plus","props":{"file":"/absolute/path/README.md"}}'
herdr-app do tab.new '{"name":"Document","mod":"preview-plus","props":{"file":"/absolute/path/guide.pdf"}}'
```

Pass `on` with the machine name for remote Markdown and text. Images and PDFs are local-only. PDF rendering is macOS-only; the Open control can launch a local PDF in its system application on other platforms.

## Development checks

Development fixtures require Node 22+; the installed mod does not use Node.

```sh
herdr-app check preview-plus/mods/preview-plus
node --experimental-vm-modules --test preview-plus/tests/*.test.mjs
node preview-plus/tests/native-session.mjs
node preview-plus/tests/native-verify.mjs /tmp/pp.<session>/session.json
```

The native session command prints the exact receipt path. It starts a disposable app home and core, creates synthetic files and copies the runtime plus test drivers into that home. The verifier exercises production handlers and actual rendering; screenshots still require visual inspection. It does not change the user's app home, layout or key bindings. Close the disposable instance with `HERDR_APP_HOME=<receipt-app-home> herdr-app do app.quit`; its temporary core and files are scoped by the environment recorded in the receipt.
