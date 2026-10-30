# Contributing

Contributions to mods, documentation, and bug fixes are welcome. Follow the [repository commit and language rules](AGENTS.md#open-source-contributions).

## Before you start

Search existing issues and PRs for related work. Read the affected mod's `RECIPE.md` before changing it. Discuss broad or breaking changes in an issue before starting. Small fixes and documentation changes can go straight to a PR.

For bug reports, include your Herdr version, operating system, reproduction steps, expected behavior, and actual behavior. Remove private information from logs and screenshots as described in [Credential management](docs/credentials.md).

## Directory structure

Use one top-level directory per mod, named with lowercase letters and hyphens. Use this structure when adding a mod.

```text
<mod-name>/
  RECIPE.md
  preview.png
  mods/
    <runtime-name>/
      main.js
      mod.json
```

A top-level directory can contain multiple runtime mods. Add `layouts/`, `keys.json`, assets and separate licenses as needed. The initial setup includes no sample mods or installation scripts.

Use `RECIPE.md` to describe what users see, interactions, APIs, external dependencies, limitations and acceptance checks. Use a screenshot of the running mod for the preview. Preserve licenses and attribution when using or modifying someone else's code.

## Local references

Read the files provided by the installed version before development.

| File | Purpose |
| --- | --- |
| `~/.config/herdr-app/AGENTS.md` | How Herdr works, mod structure and app commands |
| `~/.config/herdr-app/herdr.d.ts` | App data, commands and file access APIs |
| `~/.config/herdr-app/gpui-kit.d.ts` | GPUI elements, events and layout APIs |

If `HERDR_APP_HOME` is set, read the corresponding files there. Herdr updates these files with each version. Do not keep copies in the repository.

## Implementation

- Default-export a class extending `View` from `main.js`. Describe the native GPUI interface in `render`.
- Use Herdr's `exec` and `fetch` for external calls. Put asynchronous tasks in `cx.spawn` and use `cx.timer` for scheduled tasks. Do not save `cx` for later callbacks.
- Herdr's live data changes trigger rendering. Do not poll spaces, tabs or agents. Prefer colors from `theme()`.
- Document the external programs, network services, credentials and file paths the mod uses.
- Make setup reproducible outside the maintainer's machine. Make paths and service endpoints configurable, document required versions, and use placeholders in examples.

## Installation and verification

Check the app directory for an existing mod or layout with the same name. If there is a conflict, choose a new name and update references. Copy only the files the mod needs and merge shortcuts individually.

Run a check for each installed runtime mod.

```sh
herdr-app check ~/.config/herdr-app/mods/<runtime-name>
```

If `HERDR_APP_HOME` is set, replace the default path with the actual installation path. After the check passes, verify interactions, empty states and error states in the window. Capture a screenshot for UI changes.

```sh
herdr-app status
herdr-app shot /tmp/herdr-mod-preview.png
```

The `check` command loads and renders the mod once. Verify interactions separately. Record the acceptance steps you actually ran in the mod's `RECIPE.md`.

## Pull requests

1. Fork the repository and create a topic branch from `main`.
2. Keep the PR focused on one mod or one cohesive change. Keep commits focused and follow the [commit format](AGENTS.md#open-source-contributions).
3. Update the affected `RECIPE.md`, installation instructions, and preview when behavior or appearance changes. Add a README entry when adding a mod.
4. Run the relevant verification above. For documentation-only changes, check links and examples and run `git diff --check`.
5. Open a PR against `main`. Use a draft PR for work that is not ready for review.

Include the following in the PR description:

- The problem, resulting behavior, affected mods, and related issues.
- Your Herdr version and operating system for mod changes, the verification commands you ran, and their results. Identify skipped checks and explain why.
- A screenshot captured with `herdr-app shot` for UI changes.
- New dependencies, credential requirements, external calls, and any breaking changes with migration steps.

Address review comments and update verification results when follow-up changes affect them. Keep discussion respectful and focused on the change.

## Licensing and attribution

Contribute only code and assets you have permission to share. For reused material, record the source and license in the mod's `RECIPE.md`. Preserve the original license files, copyright notices, and required attribution alongside that material.

Explain new third-party dependencies and their licenses in the PR. Repository license decisions require maintainer approval, as described in [the repository rules](AGENTS.md#open-source-contributions).

## Sharing

To list a mod or layout in the Herdr community, make the repository public and add the `herdr-mod` or `herdr-layout` topic. Each shared directory must include `RECIPE.md` and `preview.png`.
