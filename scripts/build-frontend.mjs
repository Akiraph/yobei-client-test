import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = (process.env.TAURI_ENV_PLATFORM ?? '').toLowerCase();
const mobile = platform.includes('android') || platform.includes('ios');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.exe' : 'vite');
const extension = resolve(root, 'extension');
const tasks = mobile
  ? [{ cwd: root, args: ['build'] }]
  : [
      { cwd: extension, args: ['build'] },
      { cwd: extension, args: ['build', '-c', 'vite.content.config.ts'] },
      { cwd: root, args: ['build'] },
    ];

for (const task of tasks) {
  const result = spawnSync(vite, task.args, {
    cwd: task.cwd,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
