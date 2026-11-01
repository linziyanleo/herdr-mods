# Preview Plus implementation plan

Status: planned, documentation only. No runtime files or installation changes exist for this mod yet.

This plan merges the previous `markdown-preview` and `media-preview` plans into one mod (`preview-plus`) that works standalone or alongside [Files Plus](files-plus.md).

## Goal

Provide one unified viewer mod (`preview-plus/mods/preview-plus/`) that renders Markdown, images, and PDF pages inside the Files area or in a standalone pane, without requiring `files-plus`.

## Operating modes (decoupled from Files Plus)

`preview-plus` supports three modes so it and `files-plus` can each be installed alone or used together:

1. **Standalone Files panel mode** (mounted in the `files` block without `props.previewStack` or `props.file`)
   - Keeps the standard single-folder file tree for the focused terminal's directory.
   - Clicking a file replaces the tree view in place: `.md` and `.markdown` open in the Markdown view, supported images and `.pdf` open in the media view, and other text files open in the read-only `Editor` source view.
   - Clicking `←` returns to the folder tree.

2. **Paired with Files Plus** (`props.previewStack` set, for example `{ "previewStack": "files" }`)
   - Mounted as the second child of the `files` stack (`files-plus-tree` and `preview-plus`).
   - Reads the active space's target `{ file, root, on }` from `shared("preview-plus.target")[spaceId]`.
   - Clicking `←` at the root of the preview history runs `run("layout.select", { stack: props().previewStack, child: "files-plus-tree" })` to return to `files-plus`.

3. **Standalone mod pane** (`props.file` passed via `pane.split` or `tab.new`)
   - Accepts `{ file, root?, on? }`, defaulting `root` to `dirname(file)` and `on` to `null`.
   - Renders the target file directly in the pane.

## Supported views

### Markdown (`.md`, `.markdown`)

- Render formatted Markdown with `TextView.markdown()` from `gpui-base` and provide a `Preview` / `Source` (`Editor`) toggle in the header.
- Read UTF-8 text with `readTextFile(file, { on })`, keeping the 400,000-character truncation guard and missing/unreadable error states.
- Resolve relative links against `dirname(file)`:
  - Relative links to other Markdown files, supported images, PDFs, or text files switch the current `preview-plus` view directly and push the previous target onto an in-memory back stack (`←` walks back through followed links first).
  - External `http(s)` links open in the system browser via `cx.open_url`.
- For local relative images inside Markdown, stage referenced images in `mods/preview-plus/.cache/` if the native renderer requires application-relative image paths.

### Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`) and PDFs (`.pdf`)

- Support local files (`on === null`); show an explicit unsupported note for remote machines.
- Stage local images under `mods/preview-plus/.cache/` because `image()` resolves paths from `appHome()`. Include the source path and modification time/size in the cache filename so edits on disk never serve stale cached images.
- Render images with `image()`, preserving aspect ratio. Provide `Fit`, `-`, `100%`, `+` zoom controls, and an `Open` button to launch the system default application (`open <file>` on macOS).
- For `.pdf` on macOS, use PDFKit through JXA (`osascript`) to read the page count and render the requested page on demand into `mods/preview-plus/.cache/`. Provide `Previous`, `Next`, `<page> / <total>`, `Fit`/zoom controls, and `Open`. Never convert an entire multi-page PDF in a single `exec` call.

## Shared target contract

When paired with `files-plus`, both mods communicate only through `shared("preview-plus.target")` and `layout.select`:

```ts
// shared("preview-plus.target"), keyed by space id
type PreviewTargets = Record<string, {
  file: string;        // absolute path
  root: string;        // owning root path
  on: string | null;   // null for local machine
}>;
```

Layout node when `files-plus` and `preview-plus` are installed together:

```text
panel-body                         existing outer stack
  files                            existing child id, now a 2-child stack
    files-plus-tree                mod: "files-plus", props: { "previewStack": "files" }
    preview-plus                   mod: "preview-plus", props: { "previewStack": "files" }
  changes                          unchanged
```

- Apply asynchronous read or PDF conversion results only while `{ file, on, spaceId }` still match the active target.
- Watch `dirname(file)` locally with `watchFolder` while a file is shown and reload when that file changes.

## Verification

1. Run `herdr-app check` on `preview-plus/mods/preview-plus`.
2. Verify standalone mode (without `files-plus`) and paired stack mode (with `files-plus`):
   - Open a Markdown file, toggle `Preview` / `Source`, and follow a relative link to an image or another Markdown file; confirm `←` steps back and returns to the file tree.
   - Open a PNG/SVG image and a two-page PDF on macOS; verify fit/zoom, page navigation, and external file update reload.
3. Confirm `herdr-app status` reports no errors and capture `preview-plus/preview.png` with `herdr-app shot`.
