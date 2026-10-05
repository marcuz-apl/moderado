# Community Distribution Runbook (everything except Chocolatey)

Status: `moderado@0.3.10` is live on npm as `latest`, and the GitHub Release
`v0.3.10` carries all 11 assets (3 binaries, 3 checksum sidecars,
`manifest.json`, and the 4 community manifests). The Homebrew tap
([homebrew-moderado](https://github.com/marcuz-apl/homebrew-moderado)) and
Scoop bucket ([scoop-moderado](https://github.com/marcuz-apl/scoop-moderado))
are both at **v0.3.10**, bumped after verifying every binary checksum against
its `.sha256` sidecar. The winget submission has passed validation and is
awaiting moderator approval; it is not yet searchable or installable by ID.
[microsoft/winget-pkgs#444475](https://github.com/microsoft/winget-pkgs/pull/444475)
contains the 0.3.10 manifest. After the PR merges, allow the community source
index time to refresh before searching or installing by ID.
Chocolatey is deliberately out of scope.

CI already does the heavy lifting: `release.yml` builds the three binaries
and generates the manifests; `publish.yml` attaches `moderado.rb`,
`moderado.json`, and `Moderado.yaml` to every GitHub Release. After a release,
refresh the Homebrew and Scoop manifests and submit the new winget manifest.

---

## 1. curl installer (`scripts/install.sh`)

Live now, zero submission needed. Linux x64 and macOS arm64 only (Windows
users take the `.exe`, Scoop, or winget):

```bash
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash
curl -fsSL .../install.sh | bash -s -- --version v0.3.10 --dir ~/.local/bin
```

Security properties (deliberate, do not regress): downloads the binary, the
`.sha256` sidecar, and `manifest.json`; aborts unless the file hash matches
**both**; never executes downloaded code before verification; `--version`
pins a release instead of tracking `latest`. Covered by
`apps/cli/tests/install_script.test.ts` (happy path + manifest-mismatch
refusal against a local fixture server).

## 2. Homebrew tap — at v0.3.10, keep in sync

- Tap repo: `marcuz-apl/homebrew-moderado`, formula `Formula/moderado.rb`.
- Users: `brew tap marcuz-apl/moderado && brew install moderado`.
- Per release: copy `distribution/homebrew/moderado.rb` from the CI
  `moderado-distribution` artifact (or the GitHub Release attachment) over
  `Formula/moderado.rb` and commit. Verify first with
  `npm run generate:manifests -- artifacts/release/manifest.json /tmp/d
  https://github.com/marcuz-apl/moderado/releases/download/vX.Y.Z`
  and `diff` — for v0.3.7 the tap file was byte-identical.
- **Outstanding: none — bumped to v0.3.10** in commit `e968625`, copied from
  the v0.3.10 Release attachment after checksum verification.
- No homebrew-core submission planned; a personal tap is the standard path.

## 3. Scoop bucket — at v0.3.10, keep in sync

- Bucket repo: `marcuz-apl/scoop-moderado`, manifest `bucket/moderado.json`.
- Users: `scoop bucket add moderado
  https://github.com/marcuz-apl/scoop-moderado && scoop install moderado`.
- Per release: same flow — copy `distribution/scoop/moderado.json` over
  `bucket/moderado.json` and commit (v0.3.7 verified byte-identical).
- **Outstanding: none — bumped to v0.3.10** in commit `f7d2e9d`, copied from
  the v0.3.10 Release attachment after checksum verification.

## 4. winget — 0.3.10 submitted, awaiting moderator approval

- Package ID: `MarcuzApl.Moderado`. The 0.3.0 submission
  ([#439175](https://github.com/microsoft/winget-pkgs/pull/439175)) was closed
  as out of date and superseded by
  **[#444475](https://github.com/microsoft/winget-pkgs/pull/444475)**,
  which has passed validation but remains open pending moderator approval.
- The PR carries the required three-file layout under
  `manifests/m/MarcuzApl/Moderado/0.3.10/`: `MarcuzApl.Moderado.yaml` (version),
  `MarcuzApl.Moderado.installer.yaml` (portable, x64), and
  `MarcuzApl.Moderado.locale.en-US.yaml` (defaultLocale).
- `InstallerSha256` is the published `moderado-win-x64.exe.sha256` sidecar from
  the v0.3.10 release (`54263b4801995d99147fb1a720dd52f104c38c4ba76ea6e74d0d2b5cbafeff0f`),
  verified against the attached binary.
- The PR was opened for 0.3.9 and updated **in place** to 0.3.10, so a single
  moderation cycle yields the corrected version instead of two competing
  submissions for the same `PackageIdentifier`.
- Microsoft runs a 10-stage validation pipeline on the PR (`01. Pull Request
  Validation` through `10. Validation Completed`), plus a `license/cla` check.
  A full pass on 2026-09-30 went green through `10. Validation Completed`, which
  includes downloading and installing the real binary; the pipeline re-queues
  and is slow, so allow time and check
  `gh pr checks <id> --repo microsoft/winget-pkgs` rather than assuming failure.
- This is the authoritative validation. Do **not** rely on a local
  `winget validate` run: on `v1.30.140-preview` it reports "multi file manifest
  is incomplete" even for an unmodified, already-merged Microsoft manifest
  (`Microsoft.PowerShell` 7.6.6.0), so that message is a limitation of the
  local preview build, not a defect in these files.
- Per release after the first merge: one manifest PR (automatable with
  `wingetcreate update MarcuzApl.Moderado -u <exe-url> -v <version>`).
- Until it merges and reaches the community source index, Windows users can
  install the standalone `moderado-win-x64.exe` from the Release.
- Note: the draft is `InstallerType: portable` — true today (the exe runs
  standalone); re-check if packaging ever changes.

## 5. Automation gaps (owner decision)

- Tap/bucket bumps are currently manual copies. Auto-push from `publish.yml`
  needs a cross-repo PAT (`TAP_PUSH_TOKEN`) with write access to the two
  repos — the default `GITHUB_TOKEN` cannot leave the main repo. Say the word
  and it is one job: download `moderado-distribution`, commit each file to
  its repo. Until then, the manual copy + `diff` check above is the procedure.
- `publish.yml` still needs `npm install -g npm@latest` before `npm publish`
  (OIDC floor is npm 11.5.1; setup-node on Node 20 ships npm 10).
- Unsigned binaries (`signed: false`): SmartScreen/Gatekeeper prompt on first
  run everywhere. A code-signing cert (~EUR 200+/yr) is the only fix; not
  worth it yet.
