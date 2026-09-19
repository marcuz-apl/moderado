# Releasing Moderado

M6.1 creates and verifies a standalone npm tarball. It does not publish that
tarball to npm.

## Create a review artifact

Push a tag whose name matches the SemVer portion of the root `VERSION` file,
for example `v0.2.20` for `v0.2.20+260919u`, or start **Verify release
package** manually in GitHub Actions. The workflow runs the offline tests,
builds Moderado, installs the packed tarball into an empty temporary prefix,
and uploads `moderado-npm-package` as an artifact.

Download that artifact and inspect its contents before using it. A maintainer
may verify it locally with:

```bash
npm install -g ./moderado-<version>.tgz
moderado --help
```

The workflow has read-only repository permissions and never publishes to npm.
Public npm publication will be a separately reviewed change using npm trusted
publishing with GitHub Actions OIDC; no npm access token is stored here.
