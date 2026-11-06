# Preview Plus implementation plan

Status: the 2026-11-06 contents/anchors, Mermaid and structured-data extension is implemented in the combined source release. Native rich-preview and Files Plus handoff checks pass. The normal Herdr home is not installed or reconfigured by this delivery. Earlier publication and installation records below are historical.

This plan merges the previous `markdown-preview` and `media-preview` plans into one mod (`preview-plus`) that works standalone or alongside [Files Plus](files-plus.md).

## Goal

Provide one unified viewer mod (`preview-plus/mods/preview-plus/`) for Markdown with contents/heading links/native Mermaid, JSON trees, CSV/TSV tables, images and PDF pages inside the Files area or a standalone pane, without requiring `files-plus`. Rich previews use the existing editable-source and guarded-save workflow.

## Operating modes (decoupled from Files Plus)

`preview-plus` supports three modes so it and `files-plus` can each be installed alone or used together:

1. **Standalone Files panel mode** (mounted in the `files` block without `props.previewStack` or `props.file`)
   - Keeps the standard single-folder file tree for the focused terminal's directory.
   - Clicking a file replaces the tree view in place: `.md`/`.markdown` open in Markdown, `.json`/`.csv`/`.tsv` in structured previews, supported images/`.pdf` in media, and other text in the source editor. Complete local UTF-8 text is editable; remote/truncated text remains read-only.
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

Markdown additionally provides a Contents toggle, same/cross-document heading anchors and native Mermaid fenced diagrams. JSON/CSV/TSV provide bounded virtual rows and the same Source toggle. The [recipe](../../preview-plus/RECIPE.md) specifies syntax subsets, display limits and the heading-from-section host constraint; the November 6 record below contains current verification scope.

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

The user initially authorized full local development on `mod/preview-plus`. Work was isolated at `.agent-worktrees/preview-plus/herdr-mods`, based on `da98d11b87f703b36709ee9811100e617d1b0682`. That initial phase covered implementation and local verification; commit, mainline integration and installation were authorized in the subsequent phase below. The installable files and setup are documented in [Preview Plus](../../preview-plus/README.md) and its [recipe](../../preview-plus/RECIPE.md).

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

Known limits match the recipe: media is local-only, PDFs require macOS, source reads keep Herdr's 1 MiB ceiling and the 400,000-character guard, cached files are removed manually, HTML image syntax and exact inline/list/table image composition are outside this implementation. The initial phase left the user app, layouts, key bindings and Files Plus source unchanged. Both disposable app/core sessions were stopped after verification; temporary receipts remain available.

## Mainline integration and local installation (2026-11-01)

The user subsequently requested merging into `main` and loading the mod into the current local Herdr for verification. This extends the prior authorization to commits, local mainline integration, runtime installation and the necessary personal-layout change; it does not include a remote push. The task branch first fast-forwarded over `dcfc34fb893889421a6f9736ce42783da262dadd`, which changes only the Files Plus publication record and leaves the validated runtime unchanged.

The app uses Herdr 0.1.11 and personal layout `main-graph`. Files Plus was already installed and matched the repository; `preview-plus` was unoccupied. Only the runtime JavaScript and manifest were copied into `~/.config/herdr-app/mods/preview-plus`. The `files` block was replaced with the documented paired stack. A structural comparison against the backup confirmed that the surrounding layout, Changes/Graph nodes and outer panel ids were unchanged. Keys and settings retained their original SHA-256 hashes.

Implementation `95ea484` and documentation `909691c` were committed separately and fast-forwarded into `main`. Live verification at the user's existing 120% zoom found two host-boundary defects: builder dimensions applied app zoom a second time to measured bounds, and a click handler attached directly to an image did not receive native clicks. Runtime fix `709dc38d54f881002cfe48acd6e1166b765728ae` converts window measurements back to builder units and puts the image in an interactive `div`; it was committed and fast-forwarded into `main` after verification.

Final verification:

- The task runtime and installed runtime both pass `herdr-app check`; installed Files Plus also passes. Runtime JavaScript/manifest bytes match `main` exactly.
- The focused test suite passes 17 tests with no failures/skips, including app-zoom fit bounds and document-image navigation.
- Actual mouse clicks in the existing window verified Files Plus handoff, Markdown Preview/Source, a relative link to the recipe, its inline image, the image viewer, 100%/Fit, and Back through image/document history to the Files tree. The complete inline screenshot and image fit inside the panel at 120% app zoom.
- A temporary mod tab displayed a synthetic two-page PDF. Actual Previous/Next clicks showed both page counts and orientations, with fit bounds visually inspected. The temporary tab was closed, and the original tab and running agent were restored. The system Open/browser controls remain outside this acceptance run.
- Final `herdr-app status` reported `main-graph`, zoom `1.2`, and `errors: []`. The live Files panel remains connected to Preview Plus for the user to try.

Layout rollback is available at `~/.config/herdr-app/backups/preview-plus-20261101-135923/main-graph.json`; the same folder retains the first installed `main.js` before the zoom repair. Installation metadata and private live screenshots are under `/tmp/herdr-preview-plus-live-6xqb90pb/`. The user-window screenshots are not committed; the repository preview continues to use synthetic data. This phase completed local integration and installation; public delivery followed under the separate publication request below.

## Public publication (2026-11-01)

The user requested publication according to Herdr's sharing instructions, authorizing the public GitHub push and the `herdr-mod` topic. The existing [linziyanleo/herdr-mods](https://github.com/linziyanleo/herdr-mods) repository was already public with that topic, so no new repository or visibility change was needed.

The [Preview Plus package](https://github.com/linziyanleo/herdr-mods/tree/main/preview-plus) follows the installed Herdr guide and the current [community sharing instructions](https://herdr.dev/mods/): one folder containing `mods/preview-plus/`, `RECIPE.md` and `preview.png`, with no `layouts/` directory. The recipe contains the six prescribed sections in order and describes the real behavior, installation assumptions, dependencies, limits, attribution and acceptance checks. No key bindings are required. Only runtime JavaScript and the manifest belong in an installation; tests, licenses and documentation remain with the distribution, and generated type files and cache data are excluded.

The four implementation, documentation and runtime-fix commits were pushed normally from `main`; `git ls-remote` confirmed remote `main` at `60d2fe0f4eac4fbdd389724aa58b6c2fc3dd9c9e`. An unauthenticated download of that public source archive matched all 18 tracked package files byte for byte. The public raw screenshot also matched the repository file: 2,562 × 1,642 pixels, SHA-256 `fef025092735b54d92f7c2774c014b3a9162eb4a2b70d94119cefd3097df34d6`, with its original sRGB chunk and no gamma override. The installed runtime still matches the published runtime, and the previously completed 17-test suite and native acceptance remain applicable because publication changes no runtime files.

The official [Mods index](https://assets.herdr.dev/mods/index.json) was checked after the push. Its `generatedAt` remains `2026-11-01T06:30:16.067Z`, and its two existing entries for this repository still reference `dcfc34fb893889421a6f9736ce42783da262dadd`. It has no `preview-plus` entry yet. GitHub publication is verified; official catalog inclusion and its served preview await a later index refresh. When the entry appears, verify its `headCommit` and download its exact `previewUrl` to compare against the screenshot hash above before claiming catalog acceptance.

## Native theme integration (2026-11-02)

The user requested a Preview Plus theme correction based on Git Graph, followed by a separate commit for button interactions in both mods. This first change reads colors directly from Herdr `theme()` and font families from resolved `settings()`. The independent light/dark palette is removed. The panel frame, header, typography, separators and tree rows use the shipped Herdr 0.1.11 Files/Changes defaults, matching the approach already verified for Files Plus. Generic GPUI type/spacing/radius tokens are not used as Herdr control defaults. Unexposed fields remain version-bound native fallbacks.

Code previews use the configured code font and unzoomed size, with syntax roles from Herdr's ANSI/dim colors. A font or same-appearance color change rebuilds an open editor from cached text in a deferred task; request/editor identity prevents a late task from replacing a newer document. The paired per-space target, Back history and file/cache/watch contracts remain unchanged.

All 20 automated Preview Plus tests and `herdr-app check preview-plus/mods/preview-plus` pass. The three added regressions cover the real panel defaults, alpha/custom colors and UI fonts, cached source updates without rereading, and Git/error semantic colors. The isolated native verifier in `/tmp/pp.LMFM9j/` completed its first three handler groups (Markdown/history/images, SVG/PDF/pages, and file-update/error states) but timed out on the paired SVG handoff while the window was inactive. Those cached screenshots did not reflect later requests, so the full verifier is not a pass. Reopening the same disposable home with an unchanged signed app copy produced a fresh SVG frame; the frame, typography, image proportions and toolbar were inspected. The package preview is the unedited `theme-base.png` capture. Pointer input through Computer Use remained unavailable (`noWindowsAvailable`), so mouse-driven hover acceptance is still a separate gap. Development, two separate commits, push and synchronization to the previously authorized daily `fanghu` setup are in scope; no layout, settings or shortcut changes are required.

The light/120% native case exposed a prior adapter error shared with Files Plus: a configured 15px code size was reduced to 12.5px before reaching the editor. Herdr's `settings()` supplies sizes at zoom 1; the app applies zoom to mods. Both source adapters now pass `font_size` directly, with no second normalization. This correction belongs to the theme commit; button feedback remains separate.

## Button feedback (2026-11-02)

The second requested commit covers Files Plus and Preview Plus button feedback. The user's follow-up explicitly cancels hand pointers: all controls keep the default arrow, and hover changes only the control itself. Both mods now use native hover/selected colors and rounded controls, explicit disabled states, and pointer-stable feedback. Preview modes retain their selection background; loading, zoom and PDF bounds disable unavailable actions. Symbol buttons have accessible names/tooltips. Presses stop propagation. Source adapter corrections remain in the separate theme commit.

Files Plus dialog primary actions use native opacity feedback instead of switching to accent colors; destructive actions use the semantic error fill. Disabled controls use dim text and a raised surface. Menu hover no longer changes keyboard selection or requests a JavaScript redraw. Default cursors also cover rows and clickable Markdown images; active drag feedback remains unchanged.

The workspace-creation button belongs to the existing personal `multi-root-spaces` clone, outside the distributed mod sources. `files-plus/patches/sidebar-default-pointer.patch` records its one-line cursor correction. It applies cleanly to the cloned mod and passes a native check in the disposable home; no retired package is restored.

All 79 automated tests pass across both mods (56 Files Plus, 23 Preview Plus), including six focused button regressions for hover/pressed declarations, cursor stability, event propagation, disabled states and media/page bounds. Source checks and whitespace checks pass. The original full native verifier remains incomplete at its background-window paired handoff, as recorded above. A fresh static comparison in the same disposable home renders the sidebar, Files Plus, Markdown with a local image and a two-page PDF without errors; `/tmp/pp.LMFM9j/controls-final.png` is the package preview. Light/Geist Mono/120% comparison and the configured 15px native editor size are checked separately. Mouse-driven hover/cursor shape inspection is not claimed because Computer Use pointer input reports `noWindowsAvailable`; the actual style declarations and disabled handlers are covered by the regressions.

## Contents, diagrams and structured data (2026-11-06)

The user authorized all three capabilities, verification, main integration and push. Development used `agent/preview-plus-community`, based on `1f82759aea1cd8c78c9de36fe624a27cab5c2253`. Native verification uses disposable app/core homes; normal-home installation and layout switching are excluded.

The implementation keeps existing document ownership, draft storage, guarded Save, conflict handling and keyboard bindings. JSON/CSV/TSV are derived previews of the retained source; no parsed-data serializer participates in saving. The shared target stays `{ file, root, on }`. Files Plus adds `.json`, `.csv` and `.tsv` routing separately in integration. Its paired native tests must set `files-plus.open-location` to `internal`, since its current default is Tab.

Markdown extracts top-level ATX/setext headings and all fence boundaries before staging local images and Mermaid. Slugs deduplicate collisions and preserve Unicode. History records the heading, Contents visibility, source mode, media state and JSON expansion; same-document anchors retain the editor. Installed GPUI only scrolls virtual lists programmatically, and their deferred rows cannot carry Markdown link handlers. The selected approach renders from the requested heading with a Whole document action, retaining native Markdown links. This limitation is explicit in the README/recipe. No DOM or web view is introduced.

Mermaid uses beautiful-mermaid 1.1.3 with elkjs 0.11.1 and entities 7.0.1, built through pinned public npm dependencies and esbuild 0.28.2. The QuickJS build patches and SVG CSS conversion adapt jjongkwann/herdr-files-plus under MIT; `ELK_PATCHES` assert exact upstream matches. The bundled renderer runs lazily in a spawned task, never in `render()` (an initial probe in render hit the host's execution budget; initialization executes all five fixtures successfully). The supported subset is flowchart, sequence, state, class and ER. Content/font/colors determine cache identity; stale requests cannot apply. Errors show source. Limits and manual disk cache eviction are documented. Runtime notices include MIT, EPL-2.0 and BSD-2-Clause licenses and the editable EPL source reconstruction procedure; no repository license is selected.

Structured data separates pure parsing from GPUI rows. JSON uses stable escaped pointers and iterative bounded flattening; CSV/TSV use a strict quote-state parser. The approach and pointer escaping adapt/reference gsydler/cria-file-preview's Apache-2.0 modules with retained attribution. Native uniform lists create only requested rows and use list-level JSON disclosure handlers. Limits are 10,000 visible rows/records, 100 table columns, 64 JSON levels and 500 displayed characters per value/cell. These limits never change editable source. Malformed input, remote/read-only and truncated-source cases stay explicit.

Validation on macOS with Herdr 0.1.13:

- `node --experimental-vm-modules --test preview-plus/tests/*.test.mjs`: 49 tests passed, no failures/skips. Includes the existing native image/PDF and Python helper tests, new parser/anchor/draft tests, virtual-range rendering, five real bundled diagram families, failures/cache changes and stale result rejection.
- `herdr-app check preview-plus/mods/preview-plus`: passed. The check covers initial rendering, not deferred rows or painted SVGs.
- `node preview-plus/tests/check-mermaid.mjs`: passed. It copies only a synthetic probe and the actual bundle into a disposable check root and executes all five diagram families in QuickJS initialization. It does not start hc or a visible native session.
- `npm ci --ignore-scripts --registry=https://registry.npmjs.org` and `npm run build -- --check` in `preview-plus`: passed, reproducing the bundled bytes from the public lockfile.

In isolated Herdr session `/tmp/pp.LO38y5`, `native-rich-verify.mjs` passed Mermaid result/error states, Contents, duplicate/Unicode/cross-document anchors, history, unsaved heading safety, JSON disclosure, CSV/TSV rows, source drafts, external-write conflicts, exact saved-byte readback and three standalone panes. `native-structured-pair.mjs` passed real Files Plus dispatch for JSON/CSV/TSV, including root/machine identity, source text, Back and retained expanded folders. Both reports contain no runtime errors. The paired test selects Internal explicitly and resizes the isolated window so the host paints changed stack content.

Implementation originates in `b8f37e3778621132adc3b590321784867d66a7cc`. The generated renderer is intentionally tracked for installation. The build escapes multiline template strings without changing their contents, so both generated and authored sources pass whitespace checks. Documentation is committed separately.

Physical keyboard/pointer dispatch, scrolling and additional platform/theme combinations remain unverified in this round: CUA could not locate the isolated window. A passing native state assertion is not proof that an asynchronous SVG has painted; the package capture is inspected separately.

Independent review identified list-context loss when an indented heading split a Markdown list. Fix `e10edde` retains list continuations, nested headings and fences in the original TextView. The same commit gives diagram scrollbar wrappers their natural image height after native screenshots exposed the host wrapper's full-height default. The 26 affected tests and source check pass. `/tmp/pp.LO38y5/rich-final.png` was visually inspected and copied to `preview.png`; it shows Contents, two decoded SVG diagrams, unsupported-diagram feedback and the real JSON/CSV views together. The three paired structured screenshots were also inspected after load and redraw.

Follow-up `e12a208` limits lazy list continuation to paragraphs so a heading or fenced item cannot swallow the next top-level Setext heading; `d1a630f` includes short hyphen underlines in that boundary. Ten focused tests passed for the continuation change, then all five anchor cases and the native source check passed for the final underline correction. The existing rich/structured fixtures do not use these list cases, so their earlier native results and inspected screenshots remain applicable.

Final independent review of `d1a630f752c80eddf6c3a3281569d872ee96fefa` passed the five anchor cases and found no validated defects. Runtime code is unchanged by the subsequent acceptance-documentation commit.

### Native fixture remount correction

Each test control directory has one driver owner. Superseded instances stop publishing, watch registration precedes request reads, and receipt transport failures stay separate from action failures. Only changed control-file snapshots receive bounded retries; document saves never use this helper. The rich verifier waits for a new driver identity after remounts. Five deterministic interleaving tests pass, followed by the successful native reruns above.
