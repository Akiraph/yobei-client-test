import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'extension');
const vite = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.exe' : 'vite');

for (const args of [['build'], ['build', '-c', 'vite.content.config.ts']]) {
  const result = spawnSync(vite, args, {
    cwd: extension,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
