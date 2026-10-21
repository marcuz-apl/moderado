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
| `prepare-commit-msg` | Intentionally empty (Git has already written the commit tree by now). |
| `commit-msg` | Prefixes the subject with the final identifier and enforces the release rule. |

## Why the SemVer bump is explicit

`pre-commit` runs **before** Git creates the commit message file, so it cannot
see the message it is committing — reading that file classifies the *previous*
commit, which is how a `chore:` commit once received a patch bump.
`prepare-commit-msg` does see the message, but Git has already written the tree
by then, so a `VERSION` change there is never part of the commit (it lands as a
staged-but-uncommitted change).

SemVer therefore moves in one explicit step, before the commit:

```sh
npm run version:patch    # or: npm run version:minor
```

That updates `VERSION`, `apps/cli/package.json`, and `package-lock.json` together
and stages them. `pre-commit` keeps that SemVer and only moves the counter;
`commit-msg` fails closed when a `release(patch):` / `release(minor):` subject is
committed without moving SemVer beyond the latest `v*` tag, or when a subject
asks for a major bump (which needs explicit owner approval).

Ordinary `feat:`, `fix:`, `docs:` and `chore:` commits keep `m.n.p` unchanged.
`--amend` keeps the SemVer of the commit being amended and only moves the counter.
