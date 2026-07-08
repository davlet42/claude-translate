import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstallRoot } from '@cursor-translate/core';

export function resolveInitModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function resolveInitInstallRoot(moduleDir: string): string {
  return resolveInstallRoot(join(moduleDir, '..'));
}

export function resolveBundledCliEntry(moduleDir: string): string {
  return join(moduleDir, '..', 'cli.js');
}

export function resolveBundledMcpServer(installRoot: string): string | null {
  const candidates = [
    join(installRoot, 'node_modules', '@cursor-translate', 'mcp', 'dist', 'server.js'),
    join(installRoot, 'packages', 'mcp', 'dist', 'server.js'),
    join(installRoot, 'mcp', 'dist', 'server.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
