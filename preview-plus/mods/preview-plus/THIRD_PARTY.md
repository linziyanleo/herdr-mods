# Third-party notices

Original Preview Plus contributions are covered by the accompanying [MIT license](LICENSE). These third-party components, including adapted source and the mixed-license renderer, retain their own licenses. Keep this file, `LICENSE` and `licenses/` with the installed runtime and any redistribution.

| Component | Version/source | License | Use and modifications |
| --- | --- | --- | --- |
| Herdr Files | [Herdr 0.1.11](https://github.com/herdrdev/herdr-app) | [Apache-2.0](licenses/Herdr-APACHE-2.0.txt) | Directory enumeration, bounded browsing and Git-status handling; adapted for the standalone preview tree, request ownership and local-file integration. |
| Radix Colors (historical) | [radix-ui/colors](https://github.com/radix-ui/colors) | [MIT](licenses/Radix-MIT.txt) | Earlier releases used its palette; the current mod uses the host theme. Notice retained. |
| beautiful-mermaid | [1.1.3](https://github.com/lukilabs/beautiful-mermaid) | [MIT](licenses/beautiful-mermaid-MIT.txt) | Bundled SVG renderer, unmodified library source. |
| elkjs | [0.11.1](https://github.com/kieler/elkjs/tree/0.11.1) | [EPL-2.0](licenses/elkjs-EPL-2.0.txt) | Bundled layout engine; build-time patches support frozen prototypes, QuickJS globals and synchronous message dispatch. |
| entities | [7.0.1](https://github.com/fb55/entities/tree/v7.0.1) | [BSD-2-Clause](licenses/entities-BSD-2-Clause.txt) | Bundled entity decoding, unmodified. |
| Herdr Files Plus | [jjongkwann/herdr-files-plus](https://github.com/jjongkwann/herdr-files-plus/tree/b43c4e3e1dc2305c952ef923abda78abea095f70) | [MIT](licenses/Herdr-Files-Plus-MIT.txt) | `build/build.mjs` adapts its QuickJS patches. `mermaid.js` adapts its SVG color/font conversion and file caching; adds bounded input, diagram subset validation, in-flight sharing and theme/content cache identity. |
| Cria File Preview | [gsydler/cria-file-preview](https://github.com/gsydler/cria-file-preview/tree/62c2d220d1567988ea230a200197527febf02e20) | [Apache-2.0](licenses/Cria-APACHE-2.0.txt) | `structured.js` adapts JSON Pointer escaping and the pure JSON-row/quote-state parser approach from `json-tree.js` and `delimited.js`. Traversal, strict errors, limits and editable-source integration are changed. Its heading-from-section navigation is an API reference, not imported viewer code. |

## elkjs source and modifications

elkjs remains under [EPL-2.0](licenses/elkjs-EPL-2.0.txt), including the locally modified component. Its [2017 and 2021 Kiel University copyright notices](licenses/elkjs-NOTICE.txt) are also included explicitly in the bundle banner; esbuild's automatic legal-comment retention alone did not retain them.

The exact JavaScript inputs used by Preview Plus are pinned, with integrity hashes, in [package-lock.json](https://github.com/linziyanleo/herdr-mods/blob/main/preview-plus/package-lock.json). The public `elkjs@0.11.1` npm package supplies the generated `lib/elk.bundled.js`; the corresponding [elkjs 0.11.1 source tree](https://github.com/kieler/elkjs/tree/0.11.1) contains the JavaScript wrappers, Java sources and upstream build scripts.

All local executable changes are in [build/build.mjs](https://github.com/linziyanleo/herdr-mods/blob/main/preview-plus/build/build.mjs): the four asserted `ELK_PATCHES` handle a frozen prototype, the QuickJS global and the GWT watchdog/error timers; a module-local timer shim makes fake-worker message dispatch synchronous. The build fails if a patch does not match exactly once. `build/notices.mjs` adds the upstream notices without changing executable code. These local elkjs modifications are provided under EPL-2.0, not MIT.

To reproduce the Preview Plus JavaScript bundle from the repository's `preview-plus/` directory, use Node 22+ and run `npm ci --ignore-scripts`, `npm run build`, then `npm run build -- --check`. This rebuilds from the published JavaScript package. It does **not** compile the underlying ELK Java/GWT sources, and the npm package alone is not a complete editable upstream source tree.

For that upstream build, follow [elkjs's build instructions](https://github.com/kieler/elkjs/blob/0.11.1/README.md#building) and obtain the [Eclipse ELK source](https://github.com/eclipse/elk). Upstream requires a sibling ELK checkout. The exact ELK revision used for the published elkjs 0.11.1 JavaScript has not yet been verified here. Do not treat the JavaScript rebuild or these links as verification of a complete corresponding-source build; resolve that provenance before claiming one.

esbuild 0.28.2 (MIT) is a build-only dependency and is not installed at runtime. The installed renderer requires none of the npm development dependencies.

No browser, Node, Chromium, server or network call is used by the installed diagram renderer. Fonts come from the user's machine; generated SVGs have remote font imports and browser CSS variables/color mixing removed.
