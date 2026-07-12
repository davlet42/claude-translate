// Keep the plugin-marketplace manifests on the same version as package.json.
// The /plugin manager reads versions from these manifests (not from npm), so
// a release that bumps only package.json ships to npm/GitHub but the
// marketplace keeps offering the old version.
//
//   node scripts/sync-plugin-version.mjs          # write manifests from package.json
//   node scripts/sync-plugin-version.mjs --check  # exit 1 if any manifest drifted
//
// Wired into: `npm version` (sync + stage) and `prepack` (check).
import { readFileSync, writeFileSync } from 'node:fs';

const check = process.argv.includes('--check');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const targets = [
  {
    path: 'plugin/.claude-plugin/plugin.json',
    apply: (json) => {
      json.version = version;
    },
  },
  {
    path: '.claude-plugin/marketplace.json',
    apply: (json) => {
      for (const plugin of json.plugins ?? []) {
        plugin.version = version;
      }
    },
  },
];

let drifted = false;
for (const target of targets) {
  const json = JSON.parse(readFileSync(target.path, 'utf8'));
  const before = JSON.stringify(json);
  target.apply(json);
  if (JSON.stringify(json) === before) {
    continue;
  }
  drifted = true;
  if (check) {
    console.error(`${target.path}: version drifted from package.json (${version})`);
  } else {
    writeFileSync(target.path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${target.path}: synced to ${version}`);
  }
}

if (check && drifted) {
  console.error('Run `node scripts/sync-plugin-version.mjs` (or `npm version …`) and commit the manifests.');
  process.exit(1);
}
