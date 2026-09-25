# Project Handoff

Updated: 2026-09-25 UTC
Branch: `feature/vscode-extension` (working line); `master` deliberately left at `9bbd641`
Last implementation commit: `86f0e42` (`v0.4.0+2609251`) on `feature/vscode-extension`, pushed
Status: extension icon shipped on the branch; master untouched until the milestone increment is accepted

## Summary

The Moderado VS Code extension had no icon of its own: `apps/vscode/package.json` declared no top-level `icon`, VSIX packaging never staged an image asset, and the only asset (`media/icon.svg`) is the monochrome Activity Bar glyph. The extension now ships a dedicated 128x128 branded PNG icon that is centered, correctly sized, and covered by tests.

## Completed

- Added `apps/vscode/scripts/generate_icon.mjs`: dependency-free deterministic PNG generator (Node built-ins only) with `--check` (fails when the committed PNG drifts from the code) and `--preview` (ASCII proof). It is the single source of truth for the mark geometry and palette.
- Added `apps/vscode/media/icon.png` (128x128 RGBA, 3075 bytes): full-bleed indigo/violet rounded badge with a white shield carrying cut-out `< / >` code marks. Mark bounding box 70x87 px centered at (63.5, 64).
- Corrected the mark mapping to account for the viewBox origin; the first revision displaced the shield +15.2 px right and +9.5 px down, which rendered as a mark stuck in the lower-right corner.
- `apps/vscode/package.json`: added `"icon": "media/icon.png"`, added the `icons` script, and made `build` regenerate the icon.
- `apps/vscode/scripts/package_vsix.mjs`: exported `buildManifest`/`buildContentTypes`/`collectMediaFiles`; the VSIX now declares `Microsoft.VisualStudio.Services.Icons.Default`, adds `png` to `[Content_Types].xml`, and fails closed when the declared icon is missing or is not a PNG.
- `apps/vscode/tests/branding.test.ts`: 9 tests covering icon/glyph separation, PNG structure, brand-color and glyph pixels, centering plus minimum size, generator sync (`--check`), monochrome-safety of the Activity Bar SVG, and VSIX icon staging.
- `apps/vscode/README.md`: "Branding assets" section documenting both assets and the regeneration/verification commands.

## In progress

- Local visual confirmation: `apps/vscode/moderado-vscode-0.4.0.vsix` needs reinstalling to view the icon; the extension version is unchanged, so uninstall first or pass `--force`.
- Integration to `master` once this increment is accepted (`git switch master && git merge --ff-only feature/vscode-extension`).

## Working tree

- Clean on `feature/vscode-extension`; the icon work is committed as `86f0e42` and pushed.
- The stale worktree `.worktrees/vscode-extension` was removed; its SDD ledger is archived (git-ignored) at `.worktrees/superpowers-archive/sdd/2026-09-24-vscode-extension/`.
- Generated and gitignored: `apps/vscode/moderado-vscode-0.4.0.vsix`, `apps/vscode/dist/`.

## Checks

- Centering regression — confirmed red first (mark 14.5 px off-center horizontally) before the mapping fix.
- `npx vitest run apps/vscode/tests` — PASS (6 files, 36 tests; 9 in `branding.test.ts`).
- `npm test` — PASS (62 files, 0 failures).
- `npm run typecheck` — PASS.
- `git diff --check` — clean.
- `node apps/vscode/scripts/package_vsix.mjs` — PASS; archive contains `extension/media/icon.png` (3075 bytes) with the `Icons.Default` asset, and `[Content_Types].xml` maps `png` to `image/png`.

## Decisions and context

- The extension icon is a raster PNG because VS Code and the Marketplace require one; the Activity Bar glyph stays a monochrome `currentColor` SVG because VS Code requires monochrome container icons. Both keep the same shield-and-code mark.
- The palette is Moderado indigo/violet, deliberately not VS Code blue, so the extension no longer reads as VS Code branding.
- `VERSION` is untouched: the Alfazen git hooks compute the next connected identifier at commit time from the commit subject.
- No new runtime dependency was introduced; the generator uses only Node built-ins.
- Branch model in force: `master` is the integration line and only moves via `merge --ff-only` from `feature/vscode-extension`; extension work is committed on the branch. `0.4.0` stays untagged and unpublished until the milestone acceptance criteria pass.
- No `release/0.3.x` branch is created pre-emptively: tag `v0.3.4` is the fork point, and a `hotfix/0.3.x` branch is created from it only if a patch to the shipped CLI is actually required.
- Published refs are append-only: `master` must not be reset or force-pushed again.

## Blockers

- None.

## Next action

1. Reinstall the VSIX (`code --uninstall-extension marcuz-apl.moderado-vscode` then `code --install-extension apps/vscode/moderado-vscode-0.4.0.vsix`) and confirm the icon renders centered in the Extensions view.
2. Integrate to `master` only when the extension increment is green: `git switch master && git merge --ff-only feature/vscode-extension && git push origin master`.
3. Add `.github/workflows/ci.yml` (`pull_request` + `push: [master]` running `npm ci && npm test && npm run typecheck`) and document the branch/merge policy in `AGENTS.md`, including "published refs are append-only".
4. Optional cleanup: the `agents/who-are-you` worktree/branch and the ~25 `refs/cline|agents/.../checkpoints/*` refs.
