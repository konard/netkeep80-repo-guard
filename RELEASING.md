# Release procedure

This document describes how to cut a new release of `repo-guard` so that downstream consumers can pin to a stable version.

## Versioning

`repo-guard` follows [Semantic Versioning](https://semver.org/):

- **patch** (`x.y.Z`) — bug fixes, no API changes
- **minor** (`x.Y.0`) — backwards-compatible new features
- **major** (`X.0.0`) — breaking changes to CLI flags, policy schema, or JSON output

## Steps to release

1. **Ensure `main` is green.** All CI jobs (`validate`, `smoke-pack`) must pass before cutting a release.

2. **Bump the version** in `package.json`:
   ```bash
   npm version patch   # or minor / major
   ```
   This updates `package.json`, creates a git commit, and creates a local tag (e.g. `v1.0.1`).

3. **Push the commit and tag:**
   ```bash
   git push origin main --follow-tags
   ```

4. **Publish to npm:**
   ```bash
   npm publish
   ```
   The `files` field in `package.json` controls exactly what is included in the published artifact (`src/`, `schemas/`, `templates/`, `docs/`, `README.md`, `LICENSE`).

5. **Create a GitHub release** from the pushed tag. Use the tag name (e.g. `v1.0.1`) as the release title and list notable changes in the body.

## Verifying the published package

After publishing, run the smoke test locally to confirm the installable artifact works:

```bash
npm pack
TARBALL=$(ls repo-guard-*.tgz)
TMPDIR=$(mktemp -d)
npm install --prefix "$TMPDIR" "$PWD/$TARBALL"
"$TMPDIR/node_modules/.bin/repo-guard" --repo-root "$PWD"
```

This is the same check the `smoke-pack` CI job runs on every PR.

## Pinning for downstream consumers

After a release is tagged and published, consumers can pin to it:

```bash
# Pin to a specific version
npm install -g repo-guard@1.0.0

# Use a specific version via npx without installing
npx repo-guard@1.0.0
```

In GitHub Actions:
```yaml
- run: npx repo-guard@1.0.0
```
