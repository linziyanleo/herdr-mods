# herdr-mods

A collection of mods for [Herdr](https://github.com/herdrdev/herdr-app).

Each mod has its own top-level directory. Implemented mods include documentation, a preview image and installation files. Planned mods contain a documentation entry and an implementation plan. The directory structure follows [obrunogonzaga/herdr-mods](https://github.com/obrunogonzaga/herdr-mods).

## Mods

| Mod | Purpose | Status |
| --- | --- | --- |
| [Files Plus](files-plus/RECIPE.md) | Combine single-folder and workspace file browsing with right-click file copy/paste, root-aware path copying, `@` agent reference insertion, Finder reveal, and file CRUD. | Available |
| [Preview Plus](preview-plus/RECIPE.md) | View formatted Markdown, images, and PDF pages with Preview/Source toggle, relative link navigation, fit, zoom, and page controls; works standalone or with Files Plus. | Available |
| [Mods Plus](mods-plus/RECIPE.md) | Browse official mod and layout catalogs, manage packages, and open Plugins from the sidebar footer. | Available |

## Development

- [Development guide](CONTRIBUTING.md) covers directory structure, local API references and verification.
- [Credential management](docs/credentials.md) covers GitHub authentication and local configuration storage.
- [AGENTS.md](AGENTS.md) provides instructions for coding agents working in this repository.

Local Herdr documentation is at `~/.config/herdr-app/AGENTS.md`. Use the documentation and type definitions provided by the installed version.
