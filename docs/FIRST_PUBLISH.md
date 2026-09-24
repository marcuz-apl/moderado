# First Public Release via npmjs.com + GitHub Actions

A field log of how Moderado published `moderado@0.3.0` for the first time
(2026-09-22). Read this before cutting `v0.3.1`: the normal path is now CI,
but the first publish could not be, for reasons explained below.

Companion runbook: [`RELEASING.md`](./RELEASING.md) (the standing procedure).
Install instructions for users: root [`README.md`](../README.md#install-moderado).

---

## 1. What users can install today (v0.3.0)

| Method | Command | Status |
|---|---|---|
| npm global | `npm install -g moderado` | Works (`latest` -> `0.3.0`) |
| Bun | `bun add -g moderado` | Works (same registry) |
| pnpm / Yarn | `pnpm add -g moderado` / `yarn global add moderado` | Works (same registry) |
| Try without installing | `npx -y moderado@latest --help` | Works |
| Prebuilt binary (no Node needed) | Download from GitHub Release v0.3.0, verify `.sha256` + `manifest.json` | Works (win-x64, macos-arm64, linux-x64) |
| `curl \| bash` installer | `curl -fsSL .../scripts/install.sh \| bash` | Available (`scripts/install.sh`) |
| winget / Scoop / Homebrew / AUR | reviewable manifests on every GitHub Release | Available (see `RELEASING.md` section 4) |
| Chocolatey | -- | Out of scope |

Post-install: `moderado --help`, then `/connect` in the TUI
(Node.js >= 20 required for the npm path only).

---

## 2. Why the first publish was manual

Our `publish.yml` authenticates to npm via OIDC trusted publishing
(`permissions: id-token: write` plus `npm publish --provenance`), with no
long-lived `NPM_TOKEN` anywhere. That is the right end state, but it has a
chicken-and-egg limitation: the trusted-publisher setting lives on the
package's npmjs.com page (`npmjs.com/package/<name>/access`), which does
not exist until the first version is published. There is nothing to
configure for a never-published name, so the first-ever Publish workflow
run failed at `npm publish` with `E404 ... not in this registry` --
expected, not a bug in the workflow.

A second wrinkle: `--provenance` requires the OIDC token that only exists
inside GitHub Actions. Running `npm publish --provenance` on a laptop fails
with `EUSAGE / Automatic provenance generation not supported for provider:
null`. The manual first publish must therefore omit `--provenance`.

Known upstream gap: npm/documentation#1926 (no documented first-publish
flow for OIDC; reporters fell back to a manual first publish, after which
OIDC worked).

## 3. First-publish recipe (one-time bootstrap, done for `moderado`)

Prerequisites: an npmjs.com account (2FA on), logged in locally
(`npm login`, check `npm whoami`), on the release tag, with the verified
tarball built (`npm run verify:package` produces
`apps/cli/moderado-<version>.tgz`; it is git-ignored).

```powershell
cd <repo>
git checkout v0.3.0
npm publish apps/cli/moderado-0.3.0.tgz --access public
```

No `--provenance` locally (see section 2). Notes from the real run:

1. A fresh account with 2FA `auth-and-writes` gets `E403 ... Two-factor
   authentication or granular access token with bypass 2fa enabled is
   required` without an OTP. Fix: append `--otp=<6-digit-code>` from the
   authenticator app (codes rotate every 30 s, retry fast on expiry).
2. Fallback if OTP keeps racing: mint a granular access token at
   npmjs.com -> Access Tokens (Read+Write scoped to the package, bypass-2FA
   enabled, short expiry), `npm login` with it, publish, then revoke it.
3. `npm view moderado versions` returning `E404` before the publish is the
   green light: the name is unclaimed and the publish claims it under the
   logged-in account. After success it returns `[ '0.3.0' ]`.
4. Never commit tokens or OTPs. Neither touched the repo in our run.

Then create the GitHub Release (the workflow's last step never ran in the
failed attempt):

```powershell
gh release create "v0.3.0" --verify-tag --title "Moderado v0.3.0" --generate-notes
```

And attach the verified binaries from the green Verify run
(`gh run download <run-id> -n moderado-binaries`), after checking each
`.sha256` against `manifest.json` and smoke-testing one binary
(`moderado-win-x64.exe --help`). For v0.3.0 this meant 7 assets:
3 binaries plus 3 checksums plus `manifest.json`.

## 4. Enable OIDC so v0.3.1+ publishes from CI (do once, now possible)

Now that `npmjs.com/package/moderado/access` exists, add the trusted
publisher (GitHub Actions), copying exactly -- npm validates nothing at
save time, mismatches surface only at publish:

| npm field | Value |
|---|---|
| Organization / User | `marcuz-apl` (the GitHub repository owner) |
| Package | `moderado` |
| Repository | `marcuz-apl/moderado` |
| Workflow filename | `publish.yml` (exact, with extension) |
| Environment | `release` (or blank; `publish.yml` declares `environment: release`) |
| Allowed actions | Enable direct `npm publish` (the workflow does not use `npm stage publish`) |

Trusted publisher entries created after 2026-09-03 allow staging by default;
direct publishing must be enabled explicitly. An `E403 ... OIDC permission
denied for this action` after provenance generation is consistent with a
stage-only entry. In npmjs.com, open the package's Settings -> Trusted
publishing and check the allowed actions and all fields above. npm does not
permit editing an existing connection; replace an incorrect entry.

Repo side is now correct: `publish.yml` has `id-token: write`,
publishes with `--provenance`, and `apps/cli/package.json`
`repository.url` is `https://github.com/marcuz-apl/moderado.git`
(exact match required).

`publish.yml` now uses Node 22 and installs npm 11.5.1, meeting npm's OIDC
minimum versions.

---

## 5. Steady state (every release after this one)

1. Local pre-flight (`build`, `test`, `typecheck`, `verify:package`) per
   `RELEASING.md` section 1, with `apps/cli/package.json` synced to `VERSION`.
2. Push the tag: the Verify release artifacts workflow runs read-only
   (`contents: read`); download and smoke-test `moderado-npm-package` and
   `moderado-binaries`.
3. Dispatch Publish Moderado release with `confirm: PUBLISH`, `tag: v<semver>`:
   CI re-verifies, runs `npm publish --provenance`, creates the GitHub
   Release. No tokens, no OTP, no manual steps.
4. Never re-run Publish for an already-published version (the registry
   rejects overwrites).


