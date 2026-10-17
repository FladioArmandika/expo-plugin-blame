import { writeFileSync } from 'node:fs';
import { styleText } from 'node:util';
import { defineCommand, runMain } from 'citty';
import type { Platform } from './prebuild.js';
import { formatTerminal } from './report/terminal.js';
import { run } from './run.js';

const PLATFORMS: Platform[] = ['ios', 'android', 'all'];

const main = defineCommand({
  meta: {
    name: 'prebuild-blame',
    description: 'Show which Expo config plugin wrote which lines in android/ and ios/.',
  },
  args: {
    dir: { type: 'positional', description: 'Expo project directory', required: false, default: '.' },
    platform: { type: 'string', description: 'ios, android or all', default: 'all' },
    only: { type: 'string', description: 'Comma-separated plugins to report (earlier plugins still run)' },
    json: { type: 'string', description: 'Write the full result as JSON to this file (- for stdout)' },
    concurrency: { type: 'string', description: 'Prebuilds to run at once (default: CPU count)' },
    'keep-temp': { type: 'boolean', description: 'Keep the temp copies for inspection', default: false },
  },
  async run({ args }) {
    try {
      await blameCommand(args);
    } catch (error) {
      // Expected failures (no Expo project, prebuild errors) read better without a stack.
      if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
      console.error(styleText('red', error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  },
});

type Args = { dir: string; platform: string; only?: string; json?: string; concurrency?: string; 'keep-temp': boolean };

async function blameCommand(args: Args) {
  const platform = args.platform as Platform;
  if (!PLATFORMS.includes(platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(', ')}`);
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  if (concurrency !== undefined && !(concurrency >= 1)) throw new Error('--concurrency must be a number of at least 1');
  const toStdout = args.json === '-';

  const result = await run(args.dir, {
    platform,
    concurrency,
    keepTemp: args['keep-temp'],
    onProgress: (done, total) => {
      if (process.stderr.isTTY) process.stderr.write(`\rRunning prebuild ${done}/${total}…`);
    },
  });
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

  if (args.json) {
    const json = JSON.stringify(result, null, 2);
    if (toStdout) process.stdout.write(json + '\n');
    else writeFileSync(args.json, json + '\n');
  }
  if (!toStdout) {
    const only = args.only?.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(formatTerminal(result, { color: process.stdout.isTTY, only }));
    if (args.json) console.log(`JSON: ${args.json}`);
    if (result.tempDir) console.log(`Temp copies kept in ${result.tempDir}`);
  }
}

runMain(main);
