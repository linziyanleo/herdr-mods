# Preview Plus implementation plan

Status: implemented and verified locally on 2026-11-01. Runtime source, installation instructions, native acceptance fixtures and a real screenshot are in `preview-plus/`. The user's follow-up authorizes merging into local `main` and installing into the existing Herdr app for verification; that delivery is recorded below. Remote publication is outside this request.

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

## Implementation and verification record (2026-11-01)

The user authorized full local development on `mod/preview-plus`. Work is isolated at `.agent-worktrees/preview-plus/herdr-mods`, based on `da98d11b87f703b36709ee9811100e617d1b0682`. The authorized boundary is implementation and local verification; no commit, push, mainline integration or installation into the user's existing app home has been performed. The installable files and setup are documented in [Preview Plus](../../preview-plus/README.md) and its [recipe](../../preview-plus/RECIPE.md).

The three modes use the same target, request, navigation and rendering state. Files Plus remains unchanged and communicates through the documented shared target and `layout.select` only. Text/source reads, image staging and PDF conversion are guarded by request identity and the current file/machine/space context. A later request wins even if an earlier operation completes after returning to the same filename.

Two runtime findings determine the implementation:

- On macOS, native watcher events can use `/private/tmp` for a target opened as `/tmp`. Resolve parent directories physically and compare both spellings. Native file-edit, deletion and restoration tests verified this path.
- A native Herdr 0.1.11 probe displayed the same staged PNG through `image()` while both Markdown and HTML TextViews omitted the image, including with data URIs. Keep text in `TextView.markdown` and insert local image references as native image blocks in one scroll region. Preserve the original source, reference link definitions and linked-image navigation. App-relative path rewrites alone do not prove visible Markdown images.

Verification used Herdr 0.1.11 on Apple Silicon macOS (Darwin 27.0.0). The runtime needs no Node or browser. Development tests use Node 22+ and the installed Herdr/core. The optional Linux/Windows image fallback needs Python 3; its standard-library PNG/JPEG/WebP/SVG helpers were exercised locally, while Linux/Windows windows and remote-machine connectivity were not exercised.

- `herdr-app check preview-plus/mods/preview-plus`: passed.
- `node --experimental-vm-modules --test preview-plus/tests/preview.test.mjs`: 16 passed, zero failures/skips. This includes real image/PDF helpers, quoted paths, cache freshness, Markdown image/reference extraction, source/error/truncation states, history with PDF page/zoom restoration, physical watcher paths, remote-media notes, and out-of-order text/PDF completions across targets and spaces.
- `node preview-plus/tests/native-session.mjs` and `node preview-plus/tests/native-verify.mjs /tmp/pp.7ypMw0/session.json`: passed all five acceptance groups. The fixture used only `/tmp/pp.7ypMw0/app`, its own core/session and generated documents. Receipts and intermediate screenshots are under `/tmp/pp.7ypMw0/`; `native-report.json` records the version, completed groups and empty error list.
- Native acceptance covered the standalone tree and retained expansion; Markdown/source; linked notes/images and Back history; fit/100%/zoom; PNG/SVG; both PDF orientations/pages; external image/PDF/text edits; page clamping after removing a PDF page; deleted/restored text; explicit remote media errors; real Files Plus handoff for Markdown/SVG/PDF and root return; and an actual `pane.split` mod pane followed by clean close.
- Additional native screenshots verified JPEG and WebP alongside SVG. Visual inspection confirmed a visible local image within formatted Markdown and correctly proportioned PDF pages. Tests drive production handlers and native rendering; mouse-event injection, system-browser activation and the Open control's application launch were not part of automated native acceptance.
- `preview-plus/preview.png` is an unedited `herdr-app shot` of the final runtime showing synthetic Markdown and PDF documents. The runtime reported `errors: []`. Source files copied into the fixture were compared with the task worktree before completion.

Known limits match the recipe: media is local-only, PDFs require macOS, source reads keep Herdr's 1 MiB ceiling and the 400,000-character guard, cached files are removed manually, HTML image syntax and exact inline/list/table image composition are outside this implementation. The current user app, layouts, key bindings and Files Plus source were not changed. Both disposable app/core sessions were stopped after verification; temporary receipts remain available. The uncommitted task worktree is retained for review.

## Mainline integration and local installation (2026-11-01)

The user subsequently requested merging into `main` and loading the mod into the current local Herdr for verification. This extends the prior authorization to commits, local mainline integration, runtime installation and the necessary personal-layout change; it does not include a remote push. The task branch first fast-forwarded over `dcfc34fb893889421a6f9736ce42783da262dadd`, which changes only the Files Plus publication record and leaves the validated runtime unchanged.

The current app uses Herdr 0.1.11 and personal layout `main-graph`. Its Files panel already uses Files Plus, and the runtime name `preview-plus` is free. Install only the runtime JavaScript and manifest into the app home's `mods/preview-plus`, back up `layouts/main-graph.json`, and replace only the `files` block with the documented paired stack. Preserve the outer panel ids, Changes/Graph nodes, surrounding layout, keys and settings. Validate the installed modules and live previews before recording completion.
