import { spawn } from 'node:child_process';
import { STEP_ENV } from './steps.js';

export type Platform = 'ios' | 'android' | 'all';

/** Runs `expo prebuild` in `dir` with the first `step` plugins active. */
export function runPrebuild(expoCli: string, dir: string, step: number, platform: Platform): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [expoCli, 'prebuild', '--no-install', '--clean', '--platform', platform], {
      cwd: dir,
      env: { ...process.env, [STEP_ENV]: String(step), CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_GIT_STATUS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`expo prebuild failed at step ${step} (exit ${code}):\n${output.trim()}`));
    });
  });
}

/** Maps `items` through `fn` with at most `limit` running at once, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
