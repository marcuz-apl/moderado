# Community Distribution Runbook (everything except Chocolatey)

Status: `moderado@0.3.0` is live on npm and the GitHub Release `v0.3.0`
carries all 7 binary assets. The Homebrew tap
([homebrew-moderado](https://github.com/marcuz-apl/homebrew-moderado)) and
Scoop bucket ([scoop-moderado](https://github.com/marcuz-apl/scoop-moderado))
are seeded with the verified v0.3.0 manifests (byte-identical to
`npm run generate:manifests` output against the release `manifest.json`).
The winget submission is open as
[microsoft/winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175)
(awaiting validation + merge). AUR still needs its first upload (below).
Chocolatey is deliberately out of scope.

CI already does the heavy lifting: `release.yml` builds the three binaries
and generates the manifests; `publish.yml` attaches `moderado.rb`,
`moderado.json`, `Moderado.yaml`, and `PKGBUILD` to every GitHub Release.
What remains per channel is submission + per-release bumps.

---

## 1. curl installer (`scripts/install.sh`)

Live now, zero submission needed. Linux x64 and macOS arm64 only (Windows
users take the `.exe`, Scoop, or winget):

```bash
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash
curl -fsSL .../install.sh | bash -s -- --version v0.3.0 --dir ~/.local/bin
```

Security properties (deliberate, do not regress): downloads the binary, the
`.sha256` sidecar, and `manifest.json`; aborts unless the file hash matches
**both**; never executes downloaded code before verification; `--version`
pins a release instead of tracking `latest`. Covered by
`apps/cli/tests/install_script.test.ts` (happy path + manifest-mismatch
refusal against a local fixture server).

## 2. Homebrew tap — seeded, keep in sync

- Tap repo: `marcuz-apl/homebrew-moderado`, formula `Formula/moderado.rb`.
- Users: `brew tap marcuz-apl/moderado && brew install moderado`.
- Per release: copy `distribution/homebrew/moderado.rb` from the CI
  `moderado-distribution` artifact (or the GitHub Release attachment) over
  `Formula/moderado.rb` and commit. Verify first with
  `npm run generate:manifests -- artifacts/release/manifest.json /tmp/d
  https://github.com/marcuz-apl/moderado/releases/download/vX.Y.Z`
  and `diff` — for v0.3.0 the tap file was byte-identical.
- No homebrew-core submission planned; a personal tap is the standard path.

## 3. Scoop bucket — seeded, keep in sync

- Bucket repo: `marcuz-apl/scoop-moderado`, manifest `bucket/moderado.json`.
- Users: `scoop bucket add moderado
  https://github.com/marcuz-apl/scoop-moderado && scoop install moderado`.
- Per release: same flow — copy `distribution/scoop/moderado.json` over
  `bucket/moderado.json` and commit (v0.3.0 verified byte-identical).

## 4. winget — submitted, awaiting merge

- Package ID: `MarcuzApl.Moderado`. First submission is open as
  [microsoft/winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175)
  (three manifests under `manifests/m/MarcuzApl/Moderado/0.3.0/`, validated
  locally with `winget validate` before push). Wait for the validation
  pipeline + merge (typically hours–days).
- Per release: one manifest PR (automatable with `wingetcreate update
  MarcuzApl.Moderado -u <exe-url> -v <version>`).
- Until the PR merges, Windows users install via the `.exe`, Scoop, or
  `winget install --manifest <downloaded Moderado.yaml>`.
- Note: our draft is `InstallerType: portable` — true today (the exe runs
  standalone); re-check if packaging ever changes.

## 5. AUR — first submission still owed

- Package name: `moderado-bin`. The `distribution/aur/PKGBUILD` (also on the
  Release) is the payload: `pkgver` + `sha256sums_x86_64` already track the
  verified Linux binary.
- One-time: an Arch user (or the maintainer) submits with `makepkg --printsrcinfo`
  + `aurpublish` or the AUR web upload; per release it is one checksum bump.
- Until then, Arch users build the attached `PKGBUILD` directly with `makepkg -si`.

## 6. Automation gaps (owner decision)

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
