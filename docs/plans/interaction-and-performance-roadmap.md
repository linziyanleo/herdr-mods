# Interaction and performance roadmap

Status: **discussion draft, 2026-11-16**. This document records three requested directions, not an implementation commitment or a record of completed acceptance. No runtime, installed mod, shortcut, layout or package-management behavior changes with this document. Baseline: repository commit `a1f70b3`.

Prioritize lifecycle correctness, then the Files → Preview → agent workflow, then measured Plugins performance and motion. These can be reviewed in small independent stages. Concrete techniques below are proposals until measured and agreed; no latency, frame-rate or memory target is claimed as achieved.

## 1. Herdr 0.1.16 watcher and request lifecycle

### Current evidence

[Herdr 0.1.16](https://github.com/herdrdev/herdr-app/blob/v0.1.16/CHANGELOG.md) adds cancellable folder watches and fixes stale `herdr-app shot` frames. Its [mod guide](https://github.com/herdrdev/herdr-app/blob/v0.1.16/docs/mods.md) says to retain the watch promise and call `cancel()` when the folder is no longer shown. Cancellation resolves that call with an empty array without cancelling another caller's watch. Verify installed generated APIs before adopting this dependency; an upstream release is not proof of the running version.

[Files Plus workspace.js](../../files-plus/mods/files-plus/workspace.js) tracks watch tokens and invalidates them on context changes, but does not retain and cancel pending watch promises. [Preview Plus main.js](../../preview-plus/mods/preview-plus/main.js) removes watch-map entries without cancelling those pending calls. Token checks already reject stale work; cancellation should release resources as well, not replace those checks.

Fixed-file Preview panes still include global focused-space identity in their context. [Closed, unmerged PR #4](https://github.com/linziyanleo/herdr-mods/pull/4) describes a slow-load space-switch problem. Reproduce against the current baseline rather than assuming the old patch is sufficient or adopting it without review.

### Proposed stages

1. Retain the pending watch handle per owning directory and view. Cancel it on directory change, collapse when that watch is no longer needed, workspace replacement and pane/view close. Include workspace-config watches and Preview image dependencies, not only tree roots.
2. Keep generation/request guards after cancellation. Separate a fixed file pane's target identity from global focus; preserve space-sensitive paired and standalone modes. Keep machine identity throughout.
3. Define the minimum supported host version or a tested compatibility fallback. Retain bounded remote polling because `watchFolder` is local-only. Use `checking()` only where supported and appropriate to avoid unnecessary helper/write side effects during native checks.

### Acceptance to run

- Slow reads followed by A → B → A space switches finish or cancel cleanly: no permanent Loading, stale content, wrong-machine results or lost drafts. Repeat for background fixed-file panes and closing during a read.
- Visit at least 100 distinct directories without accumulating abandoned pending watches or losing live refresh. Record pending-handle counts and errors rather than assuming token deletion releases host resources.
- Two panes watch the same directory; close or navigate one, then edit a file. The remaining pane still refreshes.
- Collapse/reopen, change browsing root, replace workspace config, and close/reopen the pane. Atomic save, delete/recreate and filesystem errors remain observable. A cancelled empty result cannot spin a re-registration loop.
- Run unit regressions and native checks, then physically exercise the flows and inspect fresh screenshots on the actual host version. Repeat required platform-specific behavior separately.

## 2. Complete the Files → Preview → agent workflow

### Preserve the useful baseline

Files already supports path search, three opening destinations, reuse of existing file panes/tabs and per-space browsing overrides. Preview already supports local text editing, expected-content saves, draft recovery and confirmed discard. These are existing capabilities, not proposed new features. See [Files Plus recipe](../../files-plus/RECIPE.md), [Preview Plus recipe](../../preview-plus/RECIPE.md), [open-files.js](../../files-plus/mods/files-plus/open-files.js) and [Preview main.js](../../preview-plus/mods/preview-plus/main.js).

The goal is a coherent keyboard-led workflow, not accumulating more preview formats.

### Proposed discussion and stages

1. Define keyboard focus movement and commands across search/tree, preview and the intended agent terminal. Preserve existing shortcuts, editor-native navigation and IME behavior. Decide whether commands are pane-local or explicitly global before choosing bindings.
2. Explore **temporary preview versus pinned file** semantics. A temporary slot may be reused while browsing; pinning must preserve a stable file. Do not replace a dirty editor, silently discard a draft or create duplicate pinned panes. Decide how this interacts with existing Tab / Pane / Inside right panel preferences and existing-file reuse before implementation.
3. Keep **Add to agent `@`** explicit. Its captured-terminal, quoting, relative-root and no-Enter behavior is not equivalent to native `drag_paths`. Native dragging is a separate proposed path-transfer option, not permission to remove or redefine `@` insertion. Preserve machine identity and do not route a local copy silently into a remote terminal.
4. Provide a small reusable example layout and documented setup, starting from the [existing paired-layout example](../../preview-plus/README.md#pair-with-files-plus). Keep a terminal, Files tree and Preview accessible together without changing the user's installed layout. Preserve unrelated nodes, sizing and bindings; make cloning/installing the example a separate explicit action.

### Acceptance to run

- Complete search → keyboard selection → temporary preview → pin → return to tree → insert `@` into the intended agent without pointer input. Check focus and selected item after Escape, Back and repeated navigation.
- Temporary previews are reused; pinned files remain stable; repeated opens focus the correct existing file and machine. New selection during a slow preview cannot steal focus when the old read finishes.
- Edit, navigate, pin, close/reopen and switch spaces with unsaved text. Preserve recoverable drafts, confirmed discard and expected-content conflict protection. External changes and failed writes never silently overwrite disk or draft. Remote/truncated files remain read-only unless a separately approved design changes that boundary.
- `@` uses the captured intended terminal, quotes Unicode/space/quote-containing paths, restores the clipboard when applicable and never submits Enter. Dragging outside a valid target cancels; native path dragging must not accidentally add `@` or change its semantics.
- Validate the example in a disposable home at narrow/wide sizes and light/dark themes, with actual keyboard/pointer input and inspected screenshots. It must be reproducible without the maintainer's personal paths or layout.

### Decisions still open

Which command pins a temporary preview? Does an edit automatically pin, or block replacement with a clear choice? Which existing opening preference owns the temporary slot? What keyboard sequence reaches the agent without overriding shell/editor bindings? Resolve these with a small interaction prototype before broad implementation.

## 3. Plugins: network, rendering and natural motion

### Existing behavior, not new promises

[Mods Plus recipe](../../mods-plus/RECIPE.md) and [main.js](../../mods-plus/mods/mods-plus/main.js) already implement cache-first catalog loading, paginated cards, bounded image batches and native loading feedback. The documented background system has deduplication, deadlines, concurrency limits and candidate validation. Do not describe the current implementation as wholly serial or uncached.

The catalog currently sorts during rendering and builds non-virtual rows for the visible limit; image loading proceeds in batches of four up to that limit. These are investigation points, not proof of a bottleneck. Network, helper work, JavaScript rendering, native layout and GPU presentation need separate evidence.

### Proposed stages

1. **Measure and improve network behavior.** Record cold/warm dialog entry, requests and bytes, cache hits, catalog/image/helper timings and failure paths. Investigate request coalescing, cache freshness policy, conditional requests and visible-first image priorities only where the current transport and endpoints support them. Preserve stale/error labels, bounded concurrency and explicit refresh behavior. Do not raise concurrency blindly or convert automatic update checking into automatic application.
2. **Reduce unnecessary rendering.** Measure filtering/sorting and row rebuild counts with realistic and large catalogs. Consider memoized derived lists, retained card views or native virtualization if measurements justify their complexity. Preserve selection, scroll position, search/filter state, update badges and review tokens during incremental updates. No new DOM/browser rendering layer is assumed.
3. **Add natural native motion after state transitions are correct.** Discuss short, restrained transitions for loading-to-content, opening details, returning and changing filters; keep clear feedback for long operations and errors. Prefer supported native GPUI animation over JavaScript frame timers. Avoid whole-grid re-entry animations, layout jumps, input delay and movement that obscures confirmation/error state. Respect host reduced-motion support where available, or define an explicit fallback before implementation.

### Acceptance to run

- Compare cold and warm entry with a recorded catalog size, network condition and host version; report request counts, bytes and latency distributions. Choose performance budgets after baseline measurement, not as untested promises.
- Slow/offline/failed catalog and image requests retain usable cached content with honest freshness/error status. Repeated refreshes, closing/reopening and rapid filter changes do not produce duplicate uncontrolled work or late responses replacing a newer view.
- Scroll a large catalog, filter rapidly, open details, cancel review and return. Preserve scroll/selection and prevent offscreen image work from starving visible content. Measure JavaScript and native work separately; do not infer smoothness from handler tests alone.
- Motion stays responsive during repeated clicks, Back, Close and updates. No animation completes into a dismissed or superseded view; inspect narrow/wide and theme variants with physical input and fresh screenshots.
- Preserve package safety: review remains separate from install/enable, local changes and shortcut conflicts stay protected, preparation failures do not mutate active files, and partial batch failures report what actually completed. Performance changes must not bypass validation or ownership checks.

## Review boundary and next discussion

Review the three stages as documentation first. Implementation, installation, binding/layout changes and publication require their own task scope. This roadmap does not reopen external-open/double-click proposals or broaden [issue #6's opt-in local-copy preview scope](https://github.com/linziyanleo/herdr-mods/issues/6#issuecomment-6910734927).

Next discussion: agree the host compatibility floor and lifecycle tests, choose temporary/pinned preview semantics and keyboard flow, then establish the Plugins baseline and select the smallest measured optimization. Record completed checks separately from this proposed acceptance list.
