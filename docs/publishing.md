# Publishing

Order matters — the engine lives in the cursor-translate repo:

1. **Publish the engine** from `cursor-translate` (bumped to 0.2.0 with the `claude-cli` provider):
   ```bash
   cd ../cursor-translate
   npm publish -w packages/core --access public
   npm publish -w packages/mcp --access public   # optional but used by init's MCP wrapper
   ```
2. **Publish claude-translate** (depends on `@cursor-translate/core@^0.2.0`):
   ```bash
   npm install        # now resolves from the registry; commit the generated package-lock.json
   npm test
   npm publish --access public
   ```
   Also remove the temporary "no lockfile" note from `.github/workflows/ci.yml` (switch `npm install` → `npm ci`).
3. **Marketplace**: push this repo to GitHub as `davlet42/claude-translate`. The root `.claude-plugin/marketplace.json` makes the repo itself installable:
   ```
   /plugin marketplace add davlet42/claude-translate
   /plugin install claude-translate@claude-translate
   ```

Local development without published packages:

```bash
cd ../cursor-translate/packages/core && npm link
cd ../mcp && npm link
cd ../../../claude-translate && npm link @cursor-translate/core @cursor-translate/mcp
npm run build && npm test
```

Note: `plugin/hooks/*.sh` and `log-metrics.mjs` must keep their executable bit (git tracks it; verify after checkout on a fresh clone).
