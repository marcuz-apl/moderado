# Releasing Moderado

Moderado adheres to **M7.3 Guarded Public Release Workflow**: all releases to npm and GitHub Releases are explicit, reviewable maintainer actions protected by multi-stage verification gates and npm OIDC trusted publishing. Storing long-lived `NPM_TOKEN` secrets in repository settings is prohibited.

---

## 1. Local Pre-Flight Certification

Before initiating any release, sync the publishable npm version with the connected
version, then run the local verification suite:

```bash
# 0. Sync apps/cli/package.json (and package-lock.json) with the SemVer portion
#    of VERSION, so the release tag and the published artifact agree.
#    Example: VERSION "v0.2.61+260921G" -> "version": "0.2.61"
cat VERSION

# 1. Ensure clean build across all workspace packages
npm run build

# 2. Run the complete offline test suite (49 suites, 343 tests)
npm test

# 3. Verify TypeScript type correctness
npm run typecheck

# 4. Run standalone npm package packaging and sandbox smoke test
npm run verify:package
```

The release tag is derived from `cut -d+ -f1 VERSION` (for example `v0.2.61`), and
`npm run verify:package` produces `apps/cli/moderado-<package.json version>.tgz`.
Both must carry the same `major.minor.patch`, otherwise the GitHub Release would
attach an artifact whose version disagrees with its tag.

`npm run verify:package` automatically:
- Bundles internal workspace dependencies (`@moderado/core`, `@moderado/contracts`, `@moderado/providers`, `@moderado/tools`) into `apps/cli/dist/vendor`.
- Rewrites internal module specifiers to relative paths.
- Packs the production `.tgz` tarball.
- Verifies that forbidden source code, user config, logs, or raw `node_modules` are excluded.
- Installs the tarball into an isolated temporary prefix and runs `moderado --help` to confirm smoke test passes.

---

## 2. Push Release Tag (Artifact Verification Gate)

When ready for release, tag the verified commit with the SemVer portion of `VERSION`
(`cut -d+ -f1 VERSION`; for this release `v0.2.61`):

```bash
git tag "$(cut -d+ -f1 VERSION)"
git push origin "$(cut -d+ -f1 VERSION)"
```

Pushing a `v*` tag automatically triggers the read-only verification workflow:
- **Workflow**: [`.github/workflows/release.yml`](../.github/workflows/release.yml) (**Verify release artifacts**)
- **Permissions**: `contents: read` (read-only; strictly incapable of publishing).
- **Actions performed**:
  - Verifies tag matches `VERSION`.
  - Runs full test suite offline.
  - Builds the production npm package artifact (`moderado-npm-package`).
  - Compiles standalone native binary bundles across 3 platforms:
    - `windows-latest` (`node22-win-x64`)
    - `macos-latest` (`node22-macos-arm64`)
    - `ubuntu-latest` (`node22-linux-x64`)
  - Generates distribution metadata manifests and uploads review artifacts.

Maintainers should download and smoke-test the generated tarball locally:
```bash
npm install -g ./moderado-0.2.61.tgz
moderado --help
```

---

## 3. Guarded Public Publication Gate

Public publication requires explicit maintainer confirmation through the manual workflow:

- **Workflow**: [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) (**Publish Moderado release**)
- **Trigger**: Manual `workflow_dispatch` only (never runs on push).
- **Required Inputs**:
  - `confirm`: Must enter string `PUBLISH` (exact match required).
  - `tag`: The verified release tag to publish (e.g. `v0.2.61`).
- **Permissions**:
  - `id-token: write` for npm OIDC Provenance.
  - `contents: write` for GitHub Release creation.
- **Execution flow**:
  1. Checks out the exact release tag commit.
  2. Runs `npm test` and `npm run verify:package` in the clean runner environment.
  3. Publishes to the public npm registry with cryptographic provenance:
     ```bash
     npm publish apps/cli/*.tgz --provenance --access public
     ```
  4. Creates the official GitHub Release with auto-generated release notes:
     ```bash
     gh release create "${TAG}" --verify-tag "${TAG}" --title "Moderado ${TAG}" --generate-notes
     ```

No long-lived credentials or API tokens are stored in the repository. Authentication is handled entirely via GitHub OIDC trusted publishing.

