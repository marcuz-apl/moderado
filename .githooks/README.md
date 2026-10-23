# Alfazen Git hooks

Run this once after cloning:

```sh
git config core.hooksPath .githooks
```

Every commit gets a connected identifier `v<m.n.p>+<yymmddc>` using the UTC date
and a daily counter (`1`–`9`, then `a`–`z`).

| Hook | Responsibility |
|---|---|
| `pre-commit` | Advances the build counter, preserves the SemVer it finds, and stages `VERSION`. |
| `prepare-commit-msg` | Leaves the captured commit tree unchanged. |
| `commit-msg` | Prefixes the subject with the build identifier and enforces release rules. |
| `post-commit` | For an unbumped `feat:` commit, updates `p` and package versions, then amends the same commit with the new tree and subject. |

## Feature and release bumps

`pre-commit` runs before Git prepares the current commit message, so it only
advances the UTC build counter. Git captures the commit tree before
`prepare-commit-msg`, so that hook cannot add a feature version bump to the
commit. `post-commit` checks the committed subject and amends that same commit
with the patch and package version changes; it does not create a follow-up
commit. A recursion guard makes the amend run once.

Every `feat:` commit automatically bumps the patch number unless a SemVer bump
has already been staged. The amend updates `VERSION`, `apps/cli/package.json`,
and `package-lock.json` together. Minor releases remain explicit:

```sh
npm run version:patch    # or: npm run version:minor
```

`pre-commit` keeps the chosen SemVer and moves the counter; `commit-msg` fails
closed when a `release(patch):` / `release(minor):` subject is committed without
moving SemVer beyond the latest `v*` tag, or when a subject asks for a major
bump (which needs explicit owner approval).

`fix:`, `docs:` and `chore:` commits keep `m.n.p` unchanged. A stamped amend
keeps the existing SemVer and only moves the counter.
