# Releasing Moderado

Moderado adheres to **M7.3 Guarded Public Release Workflow**: all releases to npm and GitHub Releases are explicit, reviewable maintainer actions protected by multi-stage verification gates and npm OIDC trusted publishing. Storing long-lived `NPM_TOKEN` secrets in repository settings is prohibited.

Release context: the latest published tag is `v0.4.54`, published on 2026-10-29
to npm (`moderado@0.4.54`, OIDC provenance) and to GitHub Releases with
binaries, checksum sidecars, and the distribution manifests. It carries the
account-free Gateway defaults and **Change server** selection first staged as
the never-tagged `v0.4.52`, the `save_to_documents` tool and the padded
sent-question band from `v0.4.53`, and the `/detail` answer-tone toggle with its
visible, bounded web search. `0.3.10` remains
available as the earlier self-contained CLI. Windows installation uses npm and
Scoop; the `winget` and AUR manifests are published as reviewable release
attachments but are not submitted to those indexes.

---

## 1. Local Pre-Flight Certification

Before initiating any release, sync the publishable npm version with the connected
version, then run the local verification suite:

```bash
# 0. Bump SemVer explicitly. This updates VERSION, apps/cli/package.json, and
#    package-lock.json together and stages them, so the release tag and the
#    published artifact cannot disagree. `pre-commit` only advances the UTC
#    build counter, and `commit-msg` rejects a release subject without a bump.
npm run version:patch        # or: npm run version:minor
cat VERSION

# 1. Ensure clean build across all workspace packages
npm run build

# 2. Run the complete offline test suite
npm test

# 3. Verify TypeScript type correctness
npm run typecheck

# 4. Run standalone npm package packaging and sandbox smoke test
npm run verify:package
```

The release tag is derived from `cut -d+ -f1 VERSION`, and
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
(`cut -d+ -f1 VERSION`):

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
npm install -g ./moderado-0.4.54.tgz
moderado --help
```

---

## 3. Guarded Public Publication Gate

Public publication requires explicit maintainer confirmation through the manual workflow:

- **Workflow**: [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) (**Publish Moderado release**)
- **Trigger**: Manual `workflow_dispatch` only (never runs on push).
- **Required Inputs**:
  - `confirm`: Must enter string `PUBLISH` (exact match required).
  - `tag`: The verified release tag to publish (for example, `v0.4.54`).
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
  4. Creates the official GitHub Release with binaries, checksums, the verified manifest, and Scoop/Homebrew manifests:
     ```bash
     gh release create "${TAG}" --verify-tag --title "Moderado ${TAG}" --generate-notes "artifacts/release/moderado-win-x64.exe#moderado-win-x64.exe" "artifacts/release/moderado-win-x64.exe.sha256" "artifacts/release/moderado-macos-arm64#moderado-macos-arm64" "artifacts/release/moderado-macos-arm64.sha256" "artifacts/release/moderado-linux-x64#moderado-linux-x64" "artifacts/release/moderado-linux-x64.sha256" "artifacts/release/manifest.json#manifest.json" "distribution/homebrew/moderado.rb#moderado.rb" "distribution/scoop/moderado.json#moderado.json"
     ```

No long-lived credentials or API tokens are stored in the repository. Authentication is handled entirely via GitHub OIDC trusted publishing.

---

## 4. Community Distribution Channels

Every release publishes reviewable manifests alongside the binaries, so
community-maintained packages stay in sync without hand-written hashes:

- **Scoop**: submit `distribution/scoop/moderado.json` to a `scoop-moderado`
  bucket (`bucket/moderado.json`). Per-release cost is one JSON bump.
- **Homebrew**: publish `distribution/homebrew/moderado.rb` through a
  `homebrew-moderado` tap (`brew tap <owner>/moderado; brew install moderado`).
- **curl installer**: `scripts/install.sh` downloads the matching binary for
  Linux x64 or macOS arm64 from the latest GitHub Release, verifies its
  SHA-256 checksum against both the `.sha256` sidecar and `manifest.json`,
  and refuses to install on mismatch:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash
  ```

Binaries are unsigned (`signed: false` in `manifest.json`); expect first-run
prompts from Windows SmartScreen and macOS Gatekeeper. Chocolatey is
deliberately out of scope.

`npm run generate:manifests` also emits `distribution/winget/Moderado.yaml` (plus
its `en-US` locale file) and `distribution/aur/PKGBUILD`, and `publish.yml`
attaches both to the GitHub Release so they can be reviewed. Submitting them to
the winget-pkgs or AUR indexes stays a manual maintainer decision; no automated
submission job exists.
