# Changelog

## 2026-11-27

### Mods Plus

- Sort Newest by the catalog's push timestamps, including packages without a preview. Use Refresh catalog to fetch current listings while keeping cached results available if a feed fails.

## 2026-11-23

### Files Plus

- Rank exact filename matches first and support initials, ordered letters, and literal path terms. Show the workspace root beside results when it helps distinguish files.
- Paste the roots of a multi-root workspace into the current agent's input from the root folder menu. The user decides when to submit. [PR #9](https://github.com/linziyanleo/herdr-mods/pull/9)

### Preview Plus

- Add Go to line and Find in Source. Search the displayed text, including unsaved edits, and let callers open a file at a specific line and column.
- Preview same-path local copies of remote images and PDFs under explicitly configured `localSyncRoots`. The setting is off by default. The preview labels these files **Local copy** and warns that the contents may differ. [Issue #6](https://github.com/linziyanleo/herdr-mods/issues/6) · [PR #7](https://github.com/linziyanleo/herdr-mods/pull/7)

### Mods Plus

- Add an Installed packages view for prepared updates, local changes, conflicts, and failed checks.
- Fix catalog refreshes that cut off slow downloads while data was still arriving. Compress catalog responses, share the gallery request across both example lists, and keep cached entries available when refresh fails.
- Restore a package's previous files, shortcuts, and installation record if applying its update fails. Earlier successful updates in the same batch are kept.

### Documentation

- Add the [competitive improvement roadmap](docs/plans/competitive-improvements.md) for all three mods.
