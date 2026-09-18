# Alfazen Git hooks

Run this once after cloning:

```sh
git config core.hooksPath .githooks
```

`pre-commit` updates `VERSION` to `v<m.n.p>+<yymmddc>` using the UTC date and
the daily counter (`1`–`9`, then `a`–`z`). Ordinary commits keep `m.n.p`
unchanged; only `release(minor):` and `release(patch):` bump SemVer.
`prepare-commit-msg` prefixes the resulting version,
including on `--amend`, and `commit-msg` validates it.
