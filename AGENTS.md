# Herdr mods

This repository is for multiple Herdr mods. Keep each mod in a separate top-level directory, as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Before development

- Read `~/.config/herdr-app/AGENTS.md`, then consult `herdr.d.ts` and `gpui-kit.d.ts` in the same directory as needed. If `HERDR_APP_HOME` is set, read the files in that directory instead.
- Herdr runs native GPUI JavaScript without a DOM, Node.js APIs or `setTimeout`.
- Herdr rewrites its bundled documentation, type definitions, mods and layouts on startup. Use `mod.clone` or `layout.clone` before changing a bundled mod or layout.

## Changes and verification

- Write default repository documentation in English. Links may point to Chinese documentation.
- Maintain source files in this repository. Before installation, check for name conflicts and copy only the files the target mod needs.
- Preserve existing key bindings when merging shortcuts. Installing mods and switching layouts must be within the user's authorized scope.
- Run `herdr-app check <mod folder>` after changing a mod. For UI changes, inspect the running window and a screenshot captured with `herdr-app shot`.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for API guidance and verification steps. Follow [docs/credentials.md](docs/credentials.md) for credential handling.
