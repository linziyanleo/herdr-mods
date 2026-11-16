# Interaction and performance implementation

2026-11-16. All three roadmap directions are implemented locally. Automated and native lifecycle checks passed; physical acceptance is partial. The Mac locked during input testing, and Computer Use reported that automatic unlock was paused after physical input. The remaining keyboard, scrolling, motion and theme/size exercises below are **not passed**.

The [focused independent-acceptance follow-up](#focused-independent-acceptance-follow-up) records the subsequent fixes and current verification. Earlier measurements/results below retain their original scope.

## Scope and environment

- Baseline: `a1f70b3c8e3af98559953c51e512069c83bc58cf`, isolated `interaction-performance/herdr-mods` worktree.
- Implementation: local Codex `gpt-6.1-sol`, reasoning `max`, verified from this session's resolved runtime metadata. No implementation or review was delegated.
- Installed host: Herdr **0.1.16**, herdr-core **0.1.21**, macOS Darwin **27.2.0**, arm64, 14 logical CPUs. Installed generated APIs, app instructions, contribution/credential requirements and all affected recipes were inspected.
- Compatibility floor: Herdr **0.1.16**. Cancellable `watchFolder` calls and `checking()` are used directly. Older hosts need an upgrade; remote paths retain bounded polling because native watches are local-only.
- Native work used disposable `HERDR_APP_HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `HC_SESSION` and telemetry-disabled settings. Separately targetable instances used unchanged copies of the signed app bundle.
- No commits, pushes, PRs, issue comments, daily mod installation, personal shortcut/layout edits or license changes. Root `README.md` and the roadmap remain byte-identical to the main checkout; its pre-existing `.gitignore` and README changes were preserved. This report records implementation authorization without rewriting the original discussion draft.

The staged plan was: establish host/API support and reproduce lifecycle failures; implement cancellation and request ownership; choose and exercise the paired keyboard contract; measure the existing catalog before optimizing; finish focused regressions, native checks, documentation and a diff audit.

## Implemented decisions

### 1. Watch and read ownership

Files keeps the raw pending watch promise in each root/config owner and cancels it on replacement, unneeded-root collapse and close. Recursive roots remain watched while expansion, active search or an internal preview needs them. Config watches register before reading/resolving physical paths and cannot publish into a replacement workspace. Workspace identity includes the machine and config file. Windows avoids the POSIX physical-path helper; existing local-only workspace restrictions remain.

Preview independently owns directory watches for the document and local Markdown image dependencies. Navigation releases removed dependencies and closes the standalone tree watch. Collapsed/reopened tree reads have per-path identities, including stale failures. Empty cancellation batches stop every loop. Generation/request guards remain after cancellation; one caller never cancels its peer's promise. Watch failures are visible, with existing safety/remote refresh as recovery.

The fixed-file slow A→B→A regression was reproduced on the baseline: the targeted test failed with `Panel did not settle`. A fixed pane's context now uses its supplied file/machine/captured space rather than global focused-space identity. Paired/standalone browsing remains space-sensitive. The current fix was developed against this reproduction, without copying closed PR #4.

### 2. Files → Preview → agent

The paired stack has one reusable temporary slot. Keyboard Enter/F6 uses it independently of pointer Tab/Pane/Inside preferences. Existing same-path/same-machine Tab/Pane reuse still runs first. Pin/F7 freezes the slot without creating another pane; editing or recovering a dirty draft pins automatically. A pinned file rejects replacement/cross-file links. Save or confirmed discard permits unpinning, which keeps the current file until the next explicit selection. A selection identity makes an explicit reopen work after following a link. Pinning preserves the current editor/focus rather than remounting it.

Files retains query, selected result/row and expansion state on return. `files-plus.search`/`focus`, `return`, `preview`, `add-to-agent`, `agent` and `preview-plus.focus`, `pin`, `agent`, `back` expose the flow. Unmodified local F6/F7/F8 handle preview/back, add-reference/pin and terminal focus. Modified keys and editor save/IME/native navigation retain their ownership; no global bindings were installed.

Explicit `@` insertion captures the intended terminal before Preview takes focus, checks space/machine availability, quotes whitespace/Unicode/quote-containing paths, rejects control characters, pastes without Enter and restores the previous text clipboard only while it still owns it. F8 also supports a live layout terminal without a model pane and rejects a closed/different-machine target. Native dragging does not substitute for `@`.

Expected-content saves, dirty drafts, confirmed discard, external conflicts, remote/truncated read-only behavior and existing formats remain. A superseded slow read cannot replace newer content or steal terminal focus. The path-free [example layout](../../preview-plus/examples/files-preview-agent.json) includes tabs, spaces, an active terminal and the paired slot; it changes nothing until explicitly copied/selected in a chosen home.

### 3. Plugins work and motion

The baseline already had cache-first loading, four concurrent feeds, task deduplication/deadlines, 24-card pages and four-card image batches. Those mechanisms remain. Measurements found concurrent downloads of shared image URLs within a batch; media now coalesces those URLs, retaining the existing disk cache and four-worker limit. Newly revealed pages get image priority. Per-image failures and stale cached catalog state remain visible.

Derived filter/sort results are memoized against immutable package-array identity and controls. Native card child views survive unrelated parent renders; only changed package/media/theme/width/motion props rebuild a card, and cards beyond the revealed page are released. Native scroll state survives details/back. Catalog/details/settings/media replies cannot update a closed or superseded view; media also belongs to its starting catalog snapshot.

A native virtual-grid prototype was rejected after the real host logged deferred callback errors: 0.1.16 virtual rows cannot register the required card/size callbacks. Initial `check` and `status.errors` did not expose that failure. The final implementation uses retained child views and native scrolling, with the existing pagination bound. Card clicks start async work in the parent's event context; a physical card click verified that path.

Motion is limited to supported native opacity transitions: 120ms control feedback and 140ms image arrival. A macOS AppKit accessibility query at dialog opening enables motion only when Reduce Motion explicitly returns false; unknown platforms/query failures stay static. `props.motion: false` opts out. The spinner retains its text and stays static in that mode. No JS frame timer, DOM layer, grid re-entry or animated layout reflow was added. Changing the OS preference while a dialog is open requires reopening it. Review/install/enable, ownership, local changes, shortcut conflicts and package validation keep their existing gates.

## Measurements

### Transport and helper work

Five alternating before/after runs used identical recorded public feed bodies, **1,302 packages**, first 24 community mods, real curl against loopback, 20ms response delay, 32KiB synthetic image bodies and four workers. Cold used a new temporary home; warm reused it. Each phase verified 48 preview/avatar references and file sizes; every recorded phase had zero errors. Counts exclude HTTP headers/TLS, native RPC, decoding and GPU work. Feed capture is read-only; its snapshot and hashes are retained outside source.

Values below are the median across five runs, with observed min–max in parentheses.

| Measure | Baseline | Implemented |
| --- | --- | --- |
| Cold requests | 45 (44–47) | 43 (43–43) |
| Cold response body bytes | 5,609,092 (5,576,324–5,674,628) | 5,543,556 (constant) |
| Warm requests / body bytes | 0 / 0 | 0 / 0 |
| Cold catalog helper, ms | 286.574 (263.838–347.821) | 296.026 (243.769–316.574) |
| Cold media helper, ms | 1,519.663 (1,168.545–2,778.141) | 1,921.299 (1,085.447–2,069.624) |
| Warm catalog helper, ms | 38.146 (22.436–43.392) | 37.613 (31.676–38.988) |
| Warm media helper, ms | 37.844 (32.563–57.398) | 36.507 (34.616–58.108) |

The reliable result is removal of 1–4 duplicate cold downloads in this workload, median two requests/65,536 body bytes. Warm caching was already effective. **Network/helper latency improvement is inconclusive**: distributions overlap, the Mac was busy (load averages 16.93/19.30/23.62 on 14 logical CPUs), and local HTTP scheduling/curl startup contribute substantially. No real-CDN latency or production-byte reduction is inferred from fixed-size synthetic images. No concurrency increase, TTL rewrite or unsupported conditional-request scheme was justified.

### JavaScript catalog descriptions

Five alternating runs per side, 20 iterations per scenario, Node VM executing the actual `renderCatalog` method and, where present, its retained-card synchronization. No extra diagnostic selector calls are included in these final numbers. Both sides use identical fixture inputs, controls, widths and limits. Retained fake entities materialize their actual child descriptions. UI tests separately verify events/badges/stale replies. This excludes native layout, bridge, presentation and GPU work.

Times are medians of the five run medians, with the range of those medians. Large-page scenarios reveal up to 240 cards; card counts include only newly constructed descriptions in each 20-iteration scenario.

| Entries / scenario | Baseline ms | Implemented ms | Card descriptions before → after |
| --- | --- | --- | --- |
| 96 / same state | 0.294 (0.286–0.741) | 0.037 (0.033–0.038) | 480 → 24 |
| 1,302 / same state | 4.015 (3.901–4.040) | 0.015 (0.015–0.015) | 480 → 24 |
| 1,302 / filter change | 3.779 (3.724–3.803) | 1.340 (1.290–1.552) | 480 → 304 |
| 1,302 / large page | 4.617 (4.524–4.970) | 0.031 (0.031–0.035) | 4,800 → 216 |
| 4,096 / same state | 14.187 (14.005–14.757) | 0.015 (0.015–0.015) | 480 → 24 |
| 4,096 / filter change | 13.850 (13.726–13.991) | 3.940 (3.588–4.341) | 480 → 323 |
| 4,096 / large page | 14.714 (14.663–15.269) | 0.029 (0.029–0.031) | 4,800 → 216 |

A separate, unreported-timing CPU profile sampled 888 stacks: 87.7% were in the baseline sort comparator, mapping the repeated-work limiter to `visiblePackages`. Memoization removes that repeated sort; retained child views remove unrelated card reconstruction. Initial/filter-changed lists still perform real filtering/sorting. These are bounded JS work results, **not FPS or end-to-end responsiveness claims**.

One inspected native 4,096-entry flow recorded 32 parent renders and 63 card constructions through initial display, resize, search and details click. Its coarse outer-description timers were 0–2ms, excluding native layout/GPU and child presentation. This is a native integration observation, not a controlled native before/after latency comparison.

## Verification results

| Check | Actual result |
| --- | --- |
| Files full Node suite | **93/93 passed**, no skips; plus 3 focused reference tests after adding Unicode/control-character/clipboard-owner assertions |
| Preview Node suite | **72/72 full-suite cases passed**, no skips; 3 focused cases passed again after the final empty-slot correction. Includes fixed slow A→B→A, stale failure after collapse/reopen, superseded focus, close, pin/drafts and conflict cases |
| Plugins Python | **57 passed**: helper 4, catalog 18, updates 9, review 22, jobs 3, acceptance 1 |
| Plugins UI events | **19/19 passed**, including bounded media, stale/closed replies, retained card/badge/click context and static/motion branches |
| License checks | **5/5 passed** |
| Latest source native checks | Files, Preview and Mods Plus all `herdr-app check` exit 0 in a fresh disposable home |
| Native Preview lifecycle | One-second background read + dirty A→B→A passed. 100 directories: active 1, peak 2, started 102, errors 0. Same-directory peer close + external edit: active 1, errors 0 |
| Native Files lifecycle | 100 directories: active 1, peak 1, started 101, errors 0. Same-directory peer close + file creation: active 1, peak 2, errors 0. Collapse: active 0 and unchanged registration count over 250ms; reopen passed |
| Native lifecycle logs | Final isolated lifecycle session: zero matching runtime/error/interrupted log lines; `status.errors` empty |
| Package safety native handlers | 12 groups passed: discovery, cancelled review, install without activation, conflicts, enable, update review/drift refusal/apply, removal, bulk mod/layout, inactive stored layout and prompt-only handoff. The initial virtual-grid rendering failed separately and is not counted as a UI pass |
| Physical native input | Plugins search `Panel 1` and card click opened details in the retained implementation. Files search typing was exercised, but a complete keyboard handoff was not established before lock |
| Screenshots | Inspected actual wide paired-layout/tree and Plugins catalog frames from `herdr-app shot`. Details were verified through AX/state, not an inspected detail screenshot. Frames predate the final nonvisual safety guards. Locked-session lifecycle captures are artifacts, not visual acceptance evidence |
| Diff audit | Runtime/test/doc changes restricted to the three packages, one example and this report. Root originals preserved; final `git diff --check` required below |

Initial fixture expectation/timing failures were corrected and rerun; they are retained in the earlier logs. Sandbox native-launch/validation timeouts were not passes; required checks were rerun in the isolated core outside that restriction. A later cold-read found and fixed a stale directory-read failure that could delete a reopened listing; the full Preview suite then passed. No external independent review was claimed; the owner will perform that review.

### Remaining acceptance and limits

- Full physical search → arrows/Enter → temporary preview → pin → return → explicit `@`, including clipboard/no-Enter readback, remains unverified. The first keyboard attempt lost focus during instance activation; it is not counted as a successful flow. Final focus/captured-terminal handlers are covered by automated tests, not a completed physical sequence.
- Physical large-catalog scrolling, rapid Back/Close, review cancellation, live motion under repeated input, and example/Plugins narrow+wide × light+dark screenshots remain incomplete because the Mac is locked. The static fallback is handler-tested; motion-enabled presentation and actual OS Reduce Motion switching are not visually accepted.
- No native FPS, GPU, memory or end-to-end cold/warm dialog latency result. No live SSH/remote, Linux or Windows native run. Existing remote/Windows paths were preserved and narrowed tests cover relevant ownership, but these are not cross-platform acceptance claims.
- The retained grid keeps explicitly revealed pages mounted; it is not viewport virtualization. Card/image work remains bounded by the existing page limit and four-image batches. Cache eviction remains the existing policy.
- The existing Plugins safety verifier copies its fixture batch prompt to the system clipboard and does not back up/restore the previous clipboard. That copy occurred in this run; the prior clipboard was not retained. Set an expendable clipboard baseline before independently running that verifier. This is separate from the tested conditional restoration in `@` insertion.

## Evidence on this Mac

Artifacts are deliberately outside tracked source and may expire. Reproduce rather than treating these paths as permanent CI artifacts.

| Location | Contents |
| --- | --- |
| `/tmp/herdr-mods-files-all-final.txt`, `/tmp/herdr-mods-preview-all-final.txt` | Full final Node runs |
| `/tmp/herdr-mods-reference-final.txt`, `/tmp/herdr-mods-workspace-final.txt`, `/tmp/herdr-mods-ui-final.txt`, `/tmp/herdr-mods-catalog-final.txt` | Focused final regressions |
| `/tmp/herdr-mods-{helper,licenses}-tests.txt`, `/tmp/herdr-mods-{review,updates,jobs,acceptance}-verified.txt` | Other suite logs |
| `/tmp/herdr-mods-native-checks-final.json`, `/tmp/herdr-mods-{files,preview}-native-audit.txt` | Source native-check commands/results and final Files/Preview audit checks |
| `/tmp/pp.5g2Gt8/session.json`, `lifecycle-report.json`, `app.log` | Final actual Files/Preview lifecycle run |
| `/tmp/pp.5Fpbl1/paired-zoomed.png` | Inspected paired example/tree frame before lock |
| `/tmp/mp.EU41Pe/catalog-actual.png`, `catalog-after-resize.png`, `catalog-after-large.json`, `native-report.json`, `app.log` | Native Plugins frames/counters, safety-handler report and retained prototype/hot-reload errors |
| `/tmp/herdr-mods-feeds/`, `/tmp/herdr-mods-comparison/` | Exact four feed bodies, five alternating validated network runs and receipts |
| `/tmp/herdr-mods-render-comparison/`, `/tmp/herdr-mods-cpu-profile-final/` | Final render runs and separate CPU profile |
| `/tmp/herdr-mods-cleanup.json`, `/tmp/herdr-mods-delivery-evidence.json` | Owned-resource cleanup, original command target and final path/hash/diff audit |
| `/tmp/herdr-mods-baseline/` | Runtime-only baseline extracted with `git show HEAD:<path>` |

Herdr's startup automatically repoints `~/.local/bin/herdr-app` to the launched bundle, including a disposable copy. Cleanup must restore its original installed-bundle target after stopping test instances; no personal mod/layout/key files need modification. The fixture commands below inherit this host behavior, so record the link before repeating them and restore it afterwards. Cleanup results are recorded at the end of this report.

## Independent reproduction

Use the same installed host floor, an unlocked Mac for physical input, and a fresh disposable home. Read `herdr-app --skill` and installed generated APIs first. Do not point these fixtures at the daily home.

```sh
node --experimental-vm-modules --test files-plus/tests/*.test.mjs
node --experimental-vm-modules --test preview-plus/tests/*.test.mjs
node --test mods-plus/tests/ui.test.cjs
python3 mods-plus/tests/helper.test.py
python3 mods-plus/tests/catalog.test.py
python3 mods-plus/tests/updates.test.py
python3 mods-plus/tests/review.test.py
python3 mods-plus/tests/jobs.test.py
python3 mods-plus/tests/acceptance.test.py
```

Run each source native check with `HERDR_APP_HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME` and `HC_SESSION` scoped to a new temporary directory; `checking()` suppresses initial helpers. Then run actual lifecycle acceptance:

```sh
node preview-plus/tests/native-session.mjs --distinct-bundle --lifecycle
node preview-plus/tests/native-lifecycle.mjs <printed-session.json>
```

The lifecycle driver now covers **both** packages. It instruments raw pending native promises in the disposable copies and delays `slow.txt` reads by one second. Read the JSON report, native log and fresh screenshot separately.

For keyboard acceptance in that home, copy `preview-plus/examples/files-preview-agent.json` into its `layouts/` and explicitly switch to it. Create ordinary, slow and Unicode/space/quote-named disposable files in the fixture space. Activate only that window, focus Files with `files-plus.search` (or bind a free entry key only in the disposable home), then perform the full sequence above. Check dirty navigation/close/reopen and external conflicts. Paste a recognizable clipboard baseline before `@`; verify the terminal contains the quoted reference with an unsubmitted prompt and the clipboard baseline was restored. Repeat the example at narrow/wide sizes and light/dark appearances; inspect newly captured `herdr-app shot` files.

For Plugins safety, `node mods-plus/tests/native-fixture.mjs` prints a prepared home/session. Launch an unchanged signed-app copy with `open -n -a <copied-bundle>` and every `--env NAME=value` from the receipt. Wait for `herdr-app status` in that environment, create a fixture space with `space.new`, and switch to the receipt's `mods-plus-test` layout. Run `node mods-plus/tests/native-verify.mjs <session.json>` in that environment. No real package/network mutation is needed.

The same fixture provides `mods-plus-catalog`. Switch its root content with `layout.set` to `{ "mod": "mods-plus-catalog", "props": { "count": 1302, "limit": 24, "motion": false, "label": "acceptance", "record": "<base>/catalog.json" } }` in a root block. Repeat with count 4096. Search, scroll, open details and return; verify query, scroll and badges. Omit `motion: false` for the separate OS-aware motion exercise. `MODS_PLUS_BASELINE=<baseline-runtime>` when preparing the fixture also provides `mods-plus-baseline` for a native comparison; such a controlled native comparison was not completed in this run.

For measurements, extract only tracked runtime files from the baseline commit into `/tmp`, preserving their package-relative paths. Avoid checking out over this worktree. Alternate these commands five times and retain each JSON output:

```sh
# First capture the public feeds once; subsequent runs replay their exact bodies.
python3 mods-plus/tests/benchmark.py --live --feeds /tmp/mods-feeds --samples 1
python3 mods-plus/tests/benchmark.py --runtime <baseline-mods-runtime> --feeds /tmp/mods-feeds --samples 1
python3 mods-plus/tests/benchmark.py --feeds /tmp/mods-feeds --samples 1
node mods-plus/tests/benchmark.cjs <baseline-mods-runtime> 20
node mods-plus/tests/benchmark.cjs mods-plus/mods/mods-plus 20
```

Use `herdr-app do app.quit` only with each disposable receipt's environment. Stop only its matching temporary core after its tasks finish. Keep the evidence files, restore the command symlink recorded before launch, and run `git diff --check`. No commit or publication is part of acceptance.

## Changed paths

- `files-plus/{README.md,RECIPE.md}`; runtime `mods/files-plus/{actions.js,mod.json,roots.js,search.js,tree.js,workspace.js}`; tests `{actions.test.mjs,native-driver.js,native-session.mjs,panel.test.mjs,runtime.mjs,structured-open.test.mjs,tree.test.mjs,workspace.test.mjs}`.
- `preview-plus/{README.md,RECIPE.md}`; runtime `mods/preview-plus/{main.js,mod.json,tree.js}`; tests `{editor.test.mjs,native-driver.js,native-driver.test.mjs,native-session.mjs,preview.test.mjs,runtime.mjs}`; new `tests/native-lifecycle.mjs` and `examples/files-preview-agent.json`.
- `mods-plus/{README.md,RECIPE.md}`; runtime `mods/mods-plus/{catalog.py,helper.py,main.js}`; tests `{catalog.test.py,native-fixture.mjs,ui.test.cjs}`; new `tests/{benchmark.cjs,benchmark.py,native-catalog.js}`.
- This report. The root README addition and original roadmap are pre-existing input, not implementation edits.

Cleanup and final diff results: all four receipt-identified disposable app instances quit successfully and their cores stopped; the additional final-check core also stopped after its only test finished. Two original sandbox-check processes left waiting after a failed launch were terminated after command/cwd verification. The `herdr-app` link now resolves to the original installed bundle. Evidence files remain under `/tmp`. `git diff --check` and new-file whitespace checks passed; the audit identified 41 implementation paths and confirmed both original documents still match main. No independent review, commit, push or daily installation was performed.

## Focused independent-acceptance follow-up

2026-11-16, started 11:46 UTC, same worktree and local GPT-6.1-Sol max. Independent acceptance supplied 189/189 Node passes, all six Python suite passes and concrete failing repros. This follow-up made only the requested fixes. It used **no system clipboard, keyboard, foreground/window-activation automation or daily-window/config changes**. Clipboard tests use the existing in-memory mocks. Independent snapshots, repros and logs were read without alteration. The stopped `/tmp/pp.46tift` instance was not reused as current evidence.

### Fixes

1. **Media timer:** the new safety poll had called the destructive reload path. Timers now probe the existing media signature first; equal signatures retain the loaded media, pan `(43,29)`, zoom, PDF page and focus. Actual signature changes reload; missing/restored files remain observable/recoverable. Explicit Refresh still forces reload. Remote images/PDFs remain unsupported and their error state is not cleared every ten seconds. Direct timer tests cover local PNG/PDF and both remote unsupported cases without waiting a wall-clock minute.
2. **Progressive media:** `gallery.media` consumes completed URL futures, publishing cumulative snapshots into the existing job directory with atomic replacement. `jobs.status` exposes those snapshots while the one batch worker is running. The UI displays changed snapshots immediately when observed, retains per-field pending feedback and rejects closed/stale consumers. Shared-URL coalescing, four-card batches, four download workers and 500ms polling remain. Job deduplication also includes media URL identity, preventing a newly opened catalog from joining an older job for changed sources. There is no per-image worker/job/status process and no added initial-wait delay. Package review/install/enable/ownership code is unchanged.
3. **Effective `@` destination:** both captured pane availability and focused receiving destination use `shown || terminal`. They are checked before focus, after the asynchronous focus yield and immediately before submitting paste, including a replacement during the clipboard write boundary. Refusal produces no paste/Enter and conditional clipboard restoration remains. Fallback capture also captures the shown destination. Only mocked clipboard tests ran.
4. **Watch warning ownership:** warnings now belong to dependency directories. Navigation/removal drops obsolete failures; a healthy peer callback cannot clear another still-required failed dependency. Pending physical-path close/replace/peer tests still prove cancellation without obsolete rearm.
5. **Native fixture:** `files-plus-driver` was a different module identity from the product names recognized by `location(previous)`. When the mod pane lost its terminal cwd, the wrapper switched from `/private/tmp/...` to the space's `/tmp/...` path during the initial read; the stale-read guard correctly rejected that context. A diagnostic test demonstrates canonical Files retaining the prior cwd while the renamed driver falls back to the space folder. The lifecycle fixture now wraps the canonical `files-plus` identity and records `this.location()` consistently. No product canonicalization code was changed. Background launch uses `open -g -n`. Nonempty native callbacks increment an events counter; fresh writes after 100 directories and after peer close must increase it and update content within **8s**, below both fallback intervals.

### Measured batch availability

One bounded diagnostic run per version used four valid 1×1 PNGs via real curl/loopback: one 1,000ms response and three 20ms responses. It exercised the actual gallery, helper, batch job and the existing 500ms status cadence. First usable means a validated cached PNG path/metadata exposed through the job result/progress channel, not a GPU frame. Zero image/content errors occurred. These are single observations, not general latency/FPS claims; Python startup, curl and status RPC overhead remain visible.

| Version / cache | Job starts | Status polls | First usable ms | Complete ms | First while job running | Requests |
| --- | --- | --- | --- | --- | --- | --- |
| Clean `a1f70b3`, cold | 1 | 3 | 2,206.624 | 2,207.444 | No | 4 |
| Delivered snapshot, cold | 1 | 3 | 2,156.773 | 2,159.218 | No | 4 |
| Fixed, cold | 1 | 2 | 827.106 | 1,475.355 | **Yes** | 4 |
| Clean baseline, warm | 1 | 1 | 830.365 | 831.328 | No | 0 |
| Delivered snapshot, warm | 1 | 1 | 796.070 | 797.489 | No | 0 |
| Fixed, warm | 1 | 1 | 782.481 | 783.825 | No | 0 |

The fixed run observed at most four simultaneous downloads. Fast assets were available before the slow batch completed; warm cache made no requests. The 500ms/process overhead remains a limitation. The independently confirmed JS memoization measurements were reused; no JS rendering benchmark was repeated.

### Targeted checks and reproduction

```sh
node --experimental-vm-modules --test --test-name-pattern='periodic media|watch warnings|pending physical' preview-plus/tests/preview.test.mjs
node --experimental-vm-modules --test files-plus/tests/actions.test.mjs
node --experimental-vm-modules --test --test-name-pattern='canonical Files pane' files-plus/tests/panel.test.mjs
node --test mods-plus/tests/ui.test.cjs
python3 mods-plus/tests/catalog.test.py
python3 mods-plus/tests/helper.test.py
python3 mods-plus/tests/jobs.test.py
python3 mods-plus/tests/progressive-media.py --expect-progress
node preview-plus/tests/native-session.mjs --background --lifecycle
node preview-plus/tests/native-lifecycle.mjs <new-session.json>
```

Results: Preview timer/watch cases **9 passed**; Files actions **14 passed**; canonical fixture diagnostic **1 passed**; Plugins UI **21 passed**; Python catalog **18**, helper **4**, jobs **4** passed. A separate copied/adapted independent lifecycle diagnostic passed **5/5**, retaining all pending-pwd/peer/config-owner checks and changing only the stale-warning expectation. The independent evidence itself was untouched. No full 189-case rerun or six-suite rerun is claimed for this focused follow-up; unchanged independent results were reused.

New native session `/tmp/pp.hun3fk`: both 100-directory sequences, fresh callback writes, peer-close callbacks and collapse/no-hot-loop checks passed. Preview ended with events **4**, peak active **2**, errors **0**; Files ended with events **2**, peak active **2**, errors **0**. Both recorded `windowActive: false`; native status had `errors: []` and its log had zero runtime errors. This is background RPC acceptance, not physical UI acceptance. The initial/deferred-source native checks from the first delivery are historical; no new potentially foreground native-check launcher was used under this follow-up's stricter restrictions.

New logs: `/tmp/herdr-followup-{preview-final,actions,files-identity,lifecycle,ui-final,catalog-initial,helper,jobs-final}.txt`; measurements `/tmp/herdr-followup-progress-{baseline,before,final}.json`; native receipt/summary/health `/tmp/herdr-followup-native-{session,result,summary,health}.json`. All new measurement/native artifacts are outside tracked source.

Follow-up changed files: Files `actions.js`, `actions.test.mjs`, `panel.test.mjs`, `native-driver.js`, README; Preview `main.js`, `media.js`, `preview.test.mjs`, `native-session.mjs`, `native-lifecycle.mjs`, README/RECIPE; Plugins `catalog.py`, `helper.py`, `jobs.py`, `main.js`, `jobs.test.py`, `ui.test.cjs`, new `tests/progressive-media.py`, README/RECIPE; this report. Remaining physical acceptance stays unrun and was forbidden in this follow-up. Native cleanup and final diff results are recorded in `/tmp/herdr-followup-cleanup.json` and `/tmp/herdr-followup-audit.json`.

Final cleanup passed: the new background app quit, its core and the runner core stopped, and its IPC status is no longer reachable. The CLI still points to `/Users/fanghu/Applications/Herdr.app/Contents/MacOS/Herdr`. `git diff --check` passed and the original main documents still match byte-for-byte. No commit, push, PR, installation, real clipboard use or foreground action occurred in this follow-up.
