import { runResolveFromHookInput } from './resolve.js';

export async function runHookResolve(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  const input = JSON.parse(raw) as Record<string, unknown>;
  const output = await runResolveFromHookInput(input);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
