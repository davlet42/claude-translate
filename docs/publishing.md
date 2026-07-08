# Publishing to npm

Single package: **`claude-translate`** (unscoped, under your npm user account).

Runtime dependency `@cursor-translate/core@^0.2.0` is already on npm — publish only this repo.

---

## CI (GitHub Actions)

| Trigger | Workflow |
|---|---|
| push/PR `main` | `.github/workflows/ci.yml` — `npm ci` + `npm test` |
| tag `v*` | `.github/workflows/publish.yml` — test + `npm publish` |
| manual | Actions → **Publish npm** → **Run workflow** |

### GitHub secret

Repo **Settings → Secrets and variables → Actions** → **`NPM_TOKEN`**

Use the same **Automation** classic token as [cursor-translate](https://github.com/davlet42/cursor-translate) (must include publish on unscoped `claude-translate`). Create at [npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) with **Bypass 2FA**.

### Release flow

```bash
# 1. Bump version in package.json + plugin/.claude-plugin/plugin.json
# 2. Regenerate lockfile from registry (see below)
npm ci && npm test

git commit -am "Bump version to 0.1.x"
git push origin main

git tag v0.1.x && git push origin v0.1.x
```

CI publishes to npm. GitHub Release is separate:

```bash
gh release create v0.1.x --title "v0.1.x" --latest --notes "…"
```

---

## Lockfile trap (local dev)

If `npm install` runs next to `~/Projects/cursor-translate`, `package-lock.json` may link `../cursor-translate/packages/core`. CI will break. Regenerate in isolation:

```bash
TMP=$(mktemp -d)
cp package.json "$TMP/"
cd "$TMP" && npm install
cp package-lock.json ~/Projects/claude-translate/
cd ~/Projects/claude-translate && rm -rf node_modules && npm ci && npm test
```

---

## Manual publish (fallback)

```bash
npm login
npm whoami
npm ci && npm test
npm publish
```
