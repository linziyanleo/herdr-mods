# herdr-mods

A collection of mods for [Herdr](https://github.com/herdrdev/herdr-app).

Each mod has its own top-level directory. Implemented mods include documentation, a preview image and installation files. Planned mods contain a documentation entry and an implementation plan. The directory structure follows [obrunogonzaga/herdr-mods](https://github.com/obrunogonzaga/herdr-mods).

## Mods

| Mod | Purpose | Status |
| --- | --- | --- |
| [Files Plus](files-plus/RECIPE.md) | Browse and search single-folder and multi-root workspaces, manage files, and send `@` references to agents. | Available |
| [Preview Plus](preview-plus/RECIPE.md) | Read Markdown with a document outline and Mermaid diagrams, browse JSON trees and CSV/TSV tables, edit source, and preview images and PDFs. | Available |
| [Mods Plus](mods-plus/RECIPE.md) | Browse official catalogs or import GitHub packages, review installation changes and shortcut conflicts, and manage mods and layouts. | Available |

## Development

- [Development guide](CONTRIBUTING.md) covers directory structure, local API references and verification.
- [Credential management](docs/credentials.md) covers GitHub authentication and local configuration storage.
- [AGENTS.md](AGENTS.md) provides instructions for coding agents working in this repository.

Local Herdr documentation is at `~/.config/herdr-app/AGENTS.md`. Use the documentation and type definitions provided by the installed version.
