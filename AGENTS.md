# Repository agent guide

This file governs the entire `dsh-kimi-subscription` repository. Use it whenever an Agent modifies, tests, installs, publishes, or diagnoses this project.

## Repository identity

- Canonical repository: `https://github.com/BaronCyrus/dsh-kimi-subscription`
- npm package: `dsh-kimi-subscription`
- DSH plugin row: `kimi-subscription`
- Model group display name: `Kimi subscription`
- Owner's canonical local checkout: `/Volumes/M.2/WorkSpace/dsh-kimi-subscription`
- On another machine, treat the Git repository root as the canonical checkout.

Do not edit the obsolete copy under `ClaudeLession`. On the owner's machine, the `web` profile intentionally uses a local `link:` to this WorkSpace checkout for iteration. Preserve that link unless the user explicitly asks to replace it with an npm-installed version.

## Project boundaries

- This is a permanent DSH profile plugin, not a temporary dynamic Cordis Plugin.
- Host code belongs in `src/index.js` and supporting Host modules.
- Browser UI belongs in `src/client.jsx` and is built through the DSH client module wrapper in `tsdown.config.mjs`.
- The subscription route must remain separate from generic `kimi-coding` and Kimi Open Platform routes.
- Never introduce a silent fallback to another provider or paid API.
- Kimi Code subscriptions are for interactive use. Do not add batch automation, resale, or service-repackaging features.

## Security requirements

- Never print, log, commit, return to the browser, or include in diagnostics any API key, access token, refresh token, npm token, account identifier, or raw credential-store value.
- Do not read or display npm configuration files or credential values. `npm whoami` and sanitized token metadata are acceptable when required for a release.
- Credentials and provider usage requests must remain Host-side.
- Browser RPC must remain loopback-authorized and return only minimal owned JSON projections.
- Keep OAuth verification URLs restricted to official Kimi HTTPS origins.
- Keep usage requests bounded by a timeout and configured with `redirect: 'error'`.
- Preserve unrelated DSH plugins, profiles, sessions, settings, and credentials.
- Do not start, stop, or restart DSH without explicit user permission.

## Source and generated files

- Edit source files under `src/`; do not hand-edit generated `lib/index.js` or `lib/client.js`.
- `lib/` is tracked and must be regenerated with `pnpm run build` after source changes.
- `.artifacts/` and `node_modules/` are ignored and must never be committed.
- Update or add tests under `tests/` for behavior changes.
- Update `README.md`, `CHANGELOG.md`, `SECURITY.md`, compatibility metadata, and third-party notices when the change affects their claims.

## Required validation

For code or package changes, run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` must complete all tests, rebuild Host and Client bundles, and create the versioned tarball in `.artifacts/`.

For documentation-only changes, at minimum run:

```sh
pnpm run test
```

Before committing, also run:

```sh
git diff --check
git status --short --branch
```

Do not claim runtime success merely because a build succeeds. Live GUI verification requires a manual DSH restart and user credentials; do not consume subscription quota unless the user explicitly requests a live model call.

## Local iteration workflow

1. Fetch the remote and inspect the working tree before editing:

   ```sh
   git fetch origin --tags --prune
   git status --short --branch
   ```

2. Preserve remote/user edits. Never force-push or rewrite published tags.
3. Implement the requested change in the canonical WorkSpace checkout.
4. Add tests and run the required validation.
5. If the user requested only local iteration, stop after validation unless they explicitly ask for commit, push, or release.
6. If committing was requested, use a focused commit message and push `main` normally.

The active owner profile should continue to resolve:

```text
link:/Volumes/M.2/WorkSpace/dsh-kimi-subscription
```

After a local build, tell the user that the running DSH process still requires a manual restart before Host or Client changes appear.

## Installation and profile verification

For an ordinary user installation from npm:

```sh
dsh plugin --profile web add dsh-kimi-subscription@<exact-version>
dsh plugin --profile web list dsh-kimi-subscription --depth 0
dsh --profile web --dump-config
```

Verify that the package appears once and that the composed config contains exactly one `kimi-subscription` row. Use an exact version for reproducible verification. Do not replace the owner's local development link with npm unless explicitly asked.

## Release authorization

`npm publish`, Git tags, GitHub Releases, and version publication are externally visible and partially irreversible. Execute them only when the user explicitly asks to publish or release and confirms the target version. A request to “modify,” “test,” or “commit” alone is not release authorization.

Never reuse, move, delete, or overwrite a published npm version or Git tag. If a published version needs a correction, create a new patch version.

## Release checklist

1. Synchronize and confirm a clean base:

   ```sh
   git fetch origin --tags --prune
   git status --short --branch
   git log --oneline HEAD..origin/main
   ```

   Fast-forward clean remote changes before editing. Never discard remote changes.

2. Confirm the requested SemVer is unused:

   ```sh
   npm view dsh-kimi-subscription@<version> version --json
   git ls-remote --exit-code --tags origin refs/tags/v<version>
   ```

   For an unused npm version, `npm view` normally returns `E404`. An existing npm version or Git tag requires choosing a new version.

3. Update all release metadata together:

   - `package.json` version
   - `CHANGELOG.md`
   - version-specific README commands or links
   - compatibility or notices when applicable

4. Validate and inspect the exact release artifact:

   ```sh
   pnpm install --frozen-lockfile
   pnpm run check
   npm publish .artifacts/dsh-kimi-subscription-<version>.tgz --access public --dry-run --json
   tar -tzf .artifacts/dsh-kimi-subscription-<version>.tgz
   shasum -a 256 .artifacts/dsh-kimi-subscription-<version>.tgz
   git diff --check
   ```

5. Commit, create an annotated tag, and push without force:

   ```sh
   git add <release-files>
   git commit -m "chore: prepare release v<version>"
   git tag -a v<version> -m "dsh-kimi-subscription v<version>"
   git push origin main
   git push origin v<version>
   ```

6. Confirm GitHub CI succeeds for the release commit before declaring the release healthy.

7. Verify npm authentication without exposing secrets:

   ```sh
   npm whoami
   ```

   npm requires publish 2FA or a valid write-capable Granular Access Token that satisfies the registry's current policy. On `E401`, `E403`, or `EOTP`, stop and ask the user to fix authentication locally. Never request that a token, password, or one-time code be pasted into chat.

8. Publish the exact tarball that passed validation:

   ```sh
   npm publish .artifacts/dsh-kimi-subscription-<version>.tgz --access public
   ```

9. Verify npm before creating release claims:

   ```sh
   npm view dsh-kimi-subscription@<version> name version dist-tags dist.tarball dist.shasum dist.integrity repository --json
   ```

   Download the npm tarball into a temporary directory, compare its SHA-256 with the local artifact, install it in a temporary directory, and smoke-test the exported Host bundle.

10. Create the matching GitHub Release from the same artifact:

    ```sh
    gh release create v<version> \
      .artifacts/dsh-kimi-subscription-<version>.tgz \
      --repo BaronCyrus/dsh-kimi-subscription \
      --verify-tag --latest \
      --title "dsh-kimi-subscription v<version>" \
      --notes-file <release-notes-file>
    ```

11. Verify the GitHub Release is public/latest and that its downloaded asset SHA-256 matches both the local and npm tarballs.

12. Report the npm package URL, GitHub Release URL, CI URL, version, commit, tests, and checksum. Keep the owner's DSH profile linked to the canonical WorkSpace checkout unless explicitly instructed otherwise.

## Failure handling

- Distinguish code/test failures from Git divergence, npm authentication, immutable-version conflicts, registry propagation, GitHub API, and DSH profile failures.
- Never disable TLS verification, expose credentials, force-push, delete tags, unpublish versions, wipe a profile, or silently switch to a different package name.
- If npm succeeds but GitHub Release creation fails, report that npm is already irreversible and repair only the GitHub side.
- If a tag is pushed but npm fails, do not move the tag. Fix authentication without changing content, or create a new patch version if artifact content must change.
- Report exactly what changed, what external operations succeeded, and what remains unverified.
