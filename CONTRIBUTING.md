# Development guide

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

## Sharing

To list a mod or layout in the Herdr community, make the repository public and add the `herdr-mod` or `herdr-layout` topic. Each shared directory must include `RECIPE.md` and `preview.png`.
