# Credential management

## GitHub

Reuse the account already signed in through GitHub CLI. Check authentication status with this command.

```sh
gh auth status
```

Run `gh auth login` on a machine that is not signed in yet. Let GitHub CLI and the system keychain manage authentication. Keep tokens out of the repository, Git remote URLs and mod source files.

## Mod credentials

There are no mods or service credentials to configure yet. When adding an external service, document credential names, minimum permissions and how the mod reads them in its `RECIPE.md`. Prefer authentication managed by the service's CLI or the system keychain.

For local configuration, commit examples containing only empty values or placeholders. Store actual values in files ignored by Git. Tools that use `.env` must load it explicitly. Do not assume Herdr loads it automatically.

Keep credentials out of Herdr's `shared.json`, `data/` and other runtime state files. Remove sensitive information from logs, screenshots and example responses before committing them.

## Local configuration

[.env.example](../.env.example) contains only a development path placeholder. It has no secrets. To override the default path, copy it to `.env` and load it explicitly in the local tool that uses it.

`.gitignore` excludes `.env`, local configuration, credential directories and common private key files. Ignore rules do not remove files already tracked by Git. Review staged changes before committing.
