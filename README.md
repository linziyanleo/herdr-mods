# herdr-mods

A collection of mods for [Herdr](https://github.com/herdrdev/herdr-app).

Each mod has its own directory with documentation, a native screenshot and runtime files. The directory structure follows [obrunogonzaga/herdr-mods](https://github.com/obrunogonzaga/herdr-mods).

## Mods

| Mod | Purpose |
| --- | --- |
| [Files Plus](files-plus/RECIPE.md) | Browse and search single-folder and multi-root workspaces, manage files, and send `@` references to agents. |
| [Preview Plus](preview-plus/RECIPE.md) | Edit local text files, read Markdown with contents and Mermaid diagrams, browse JSON and CSV/TSV, and preview images and PDFs. |
| [Mods Plus](mods-plus/RECIPE.md) | Browse catalogs or import GitHub packages, review installation and update changes, and enable or remove mods and layouts. |

## License

Original project code, documentation and assets are available under [MIT](LICENSE). Third-party code, adaptations and assets retain their own licenses, including Apache-2.0, EPL-2.0, BSD-2-Clause and ISC. Preview Plus's bundled elkjs is **not** relicensed under MIT. See [licensing scope and third-party notices](THIRD_PARTY.md).

## Development

- [Development guide](CONTRIBUTING.md) covers directory structure, local API references and verification.
- [Credential management](docs/credentials.md) covers GitHub authentication and local configuration storage.
- [AGENTS.md](AGENTS.md) provides instructions for coding agents working in this repository.

Local Herdr documentation is at `~/.config/herdr-app/AGENTS.md`. Use the documentation and type definitions provided by the installed version.
