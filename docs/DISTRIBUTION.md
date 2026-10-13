# Community Distribution Runbook (everything except Chocolatey)

The latest published CLI is `moderado@0.4.10`. Its unified `/connect` flow
supports the Gateway and direct provider connections; `/login` is no longer
offered. The previous `0.4.8` release uses `/login` for the Gateway, and the
earlier `0.3.10` release is self-contained and does not require the Gateway.
All three use the `moderado` command name. Install the current version with
`npm install -g moderado`; pin `moderado@0.3.10` to keep the self-contained CLI.

The GitHub Release `v0.4.10` includes binaries, checksum sidecars, a
`manifest.json`, and reviewable distribution manifests. The Homebrew tap
([homebrew-moderado](https://github.com/marcuz-apl/homebrew-moderado)) and
Scoop bucket ([scoop-moderado](https://github.com/marcuz-apl/scoop-moderado))
are both updated to **v0.4.10** after verifying every binary checksum against
its `.sha256` sidecar. Windows installation is supported through npm and Scoop.
Chocolatey is out of scope.

CI builds the binaries and release artifacts. After a release, refresh the
Homebrew and Scoop manifests from the verified release assets.

## End-user updates

The `moderado update` and `moderado upgrade` commands are available starting
with v0.4.18. The published v0.4.10 release described above does not include
them, so install v0.4.18 or later with the original installer before using
these commands.

Run `moderado update` to install the latest published release within the
installed major version. Run `moderado upgrade` to install the latest published
release, including a major version change. Both commands target the current
installation channel, show the installed and target versions, and report the
outcome. An already-current installation exits successfully. Restart Moderado
after a successful update. Cancellation or an unsafe/failed update exits
nonzero; rerun after cancellation, or use the manual command for the original
installer when the installation cannot be identified safely.

The CLI updates global npm installations in place with the selected version,
preserving the global npm prefix and leaving unrelated global packages alone.
It recognizes Moderado-managed standalone binaries installed at the default
`~/.local/bin/moderado` path by the curl installer. Those binaries are updated
in place after release metadata, artifact checksums, and the manifest are
verified. A failed download or verification leaves the installed binary
untouched. A standalone install made with a custom installer `--dir` path is
not recognized for in-place updates; use the original installer to update it.
The CLI does not migrate between installation channels.

Installations managed by Homebrew or Scoop must be updated through those tools:

```bash
brew upgrade moderado
scoop update moderado
```

For an installation that cannot be safely identified or replaced, the CLI fails
closed and prints manual guidance. Use the installer or package manager that
originally installed Moderado, for example `npm install -g moderado`,
`brew upgrade moderado`, or `scoop update moderado`. Other npm-compatible
installers should likewise be updated with their original package manager.

---

## 1. curl installer (`scripts/install.sh`)

Live now, zero submission needed. Linux x64 and macOS arm64 only. Windows users
can install through npm or Scoop.

```bash
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash
curl -fsSL .../install.sh | bash -s -- --version v0.4.10 --dir ~/.local/bin
```

Security properties (deliberate, do not regress): downloads the binary, the
`.sha256` sidecar, and `manifest.json`; aborts unless the file hash matches
**both**; never executes downloaded code before verification; `--version`
pins a release instead of tracking `latest`. Covered by
`apps/cli/tests/install_script.test.ts` (happy path + manifest-mismatch
refusal against a local fixture server).

## 2. Homebrew tap — at v0.4.10, keep in sync

- Tap repo: `marcuz-apl/homebrew-moderado`, formula `Formula/moderado.rb`.
- Users: `brew tap marcuz-apl/moderado && brew install moderado`.
- Per release: copy `distribution/homebrew/moderado.rb` from the CI
  `moderado-distribution` artifact (or the GitHub Release attachment) over
  `Formula/moderado.rb` and commit. Verify first with
  `npm run generate:manifests -- artifacts/release/manifest.json /tmp/d
  https://github.com/marcuz-apl/moderado/releases/download/vX.Y.Z`
  and `diff` — for v0.3.7 the tap file was byte-identical.
- **Outstanding: none — bumped to v0.4.10** from the verified release manifest.
- No homebrew-core submission planned; a personal tap is the standard path.

## 3. Scoop bucket — at v0.4.10, keep in sync

- Bucket repo: `marcuz-apl/scoop-moderado`, manifest `bucket/moderado.json`.
- Users: `scoop bucket add moderado
  https://github.com/marcuz-apl/scoop-moderado && scoop install moderado`.
- Per release: same flow — copy `distribution/scoop/moderado.json` over
  `bucket/moderado.json` and commit (v0.3.7 verified byte-identical).
- **Outstanding: none — bumped to v0.4.10** from the verified release manifest.

## 4. Windows installation

The supported Windows install options are npm and Scoop. The existing Winget
submission for 0.3.10 is left as-is; no Winget submission or package-index
release is planned for 0.4.10.

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
