# Licensing scope and third-party material

[MIT](LICENSE) covers the original code, documentation and assets contributed by the maintainer. It does not relicense third-party code, adaptations, dependencies or assets. Keep their original copyright notices and license terms when reusing or redistributing them. MIT does not replace Apache-2.0, EPL-2.0, BSD-2-Clause, ISC or other upstream requirements.

| Package | Notices shipped with its runtime |
| --- | --- |
| Files Plus | [Herdr-derived code/assets and Lucide/Feather icons](files-plus/mods/files-plus/THIRD_PARTY.md) |
| Preview Plus | [Herdr/Cria adaptations, Mermaid dependencies, upstream MIT code and historical Radix attribution](preview-plus/mods/preview-plus/THIRD_PARTY.md) |
| Mods Plus | [Host-provided APIs and assets](mods-plus/mods/mods-plus/THIRD_PARTY.md) |

Each package and runtime directory includes a copy of `LICENSE`. Copy the entire runtime directory, including `LICENSE`, `THIRD_PARTY.md` and any `licenses/` directory. The older package-level `licenses/` files remain for existing links and attribution. The copies must stay in sync.

Preview Plus's `mermaid.bundle.js` includes elkjs under EPL-2.0 and is not an MIT-only file. Its [source and modification notes](preview-plus/mods/preview-plus/THIRD_PARTY.md#elkjs-source-and-modifications) distinguish the reproducible JavaScript bundle build from the upstream Java/GWT source build and record the remaining source-provenance verification limit.

Run `node --test tests/licenses.test.mjs` to check distributed notices and license copies. For contribution requirements, see [CONTRIBUTING.md](CONTRIBUTING.md#licensing-and-attribution).
