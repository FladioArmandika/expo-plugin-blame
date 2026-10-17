import { writeFileSync } from 'node:fs';
import { styleText } from 'node:util';
import { defineCommand, runMain } from 'citty';
import type { Platform } from './prebuild.js';
import path from 'node:path';
import { checkoutBase } from './base.js';
import { defaultCacheDir } from './cache.js';
import { compare } from './compare.js';
import { renderHtml } from './report/html.js';
import { formatComparisonMarkdown, formatMarkdown } from './report/markdown.js';
import { formatComparison, formatTerminal } from './report/terminal.js';
import { run, type RunOptions } from './run.js';

const PLATFORMS: Platform[] = ['ios', 'android', 'all'];

const main = defineCommand({
  meta: {
    name: 'expo-plugin-blame',
    description: 'Show which Expo config plugin wrote which lines in android/ and ios/.',
  },
  args: {
    dir: { type: 'positional', description: 'Expo project directory', required: false, default: '.' },
    platform: { type: 'string', description: 'ios, android or all', default: 'all' },
    only: { type: 'string', description: 'Comma-separated plugins to report (earlier plugins still run)' },
    base: { type: 'string', description: 'Compare the native output with this git ref (branch, tag or commit)' },
    html: { type: 'string', description: 'Write the colour-coded HTML report (default file: expo-plugin-blame.html)' },
    json: { type: 'string', description: 'Write the full result as JSON to this file (- for stdout)' },
    markdown: { type: 'string', description: 'Write a Markdown summary, e.g. for a PR comment (- for stdout)' },
    concurrency: { type: 'string', description: 'Prebuilds to run at once (default: CPU count)' },
    cache: { type: 'boolean', description: 'Reuse prebuilds from earlier runs (--no-cache to run them all)', default: true },
    'keep-temp': { type: 'boolean', description: 'Keep the temp copies for inspection', default: false },
  },
  async run({ args }) {
    try {
      await blameCommand(args);
    } catch (error) {
      // Expected failures (no Expo project, prebuild errors) read better without a stack.
      status('');
      console.error(styleText('red', error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  },
});

type Args = {
  dir: string;
  platform: string;
  only?: string;
  base?: string;
  html?: string | boolean;
  json?: string;
  markdown?: string;
  concurrency?: string;
  cache: boolean;
  'keep-temp': boolean;
};

const status = (text: string) => {
  if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${text}`);
};

/** Writes `text` to `file`, or to stdout for `-`. */
function output(file: string, text: string) {
  if (file === '-') process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  else writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
}

async function blameCommand(args: Args) {
  const platform = args.platform as Platform;
  if (!PLATFORMS.includes(platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(', ')}`);
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  if (concurrency !== undefined && !(concurrency >= 1)) throw new Error('--concurrency must be a number of at least 1');
  if (args.json === '-' && args.markdown === '-') throw new Error('Only one of --json and --markdown can go to stdout');
  const quiet = args.json === '-' || args.markdown === '-';
  const only = args.only?.split(',').map((s) => s.trim()).filter(Boolean);
  // `--html` with no value writes to the default file name.
  const htmlFile = args.html === true || args.html === '' ? 'expo-plugin-blame.html' : args.html || undefined;
  const options = (label: string): RunOptions => ({
    platform,
    concurrency,
    keepTemp: args['keep-temp'],
    // Base and head share one cache: keys are content hashes, so that's safe.
    cacheDir: args.cache ? defaultCacheDir(path.resolve(args.dir)) : undefined,
    onProgress: (done, total) => status(`Running prebuild ${done}/${total}${label}…`),
  });

  if (args.base !== undefined) {
    if (!args.base) throw new Error('--base needs a git ref, like --base main');
    if (htmlFile) throw new Error("--html doesn't work with --base yet. Use --markdown or --json.");
    status(`Checking out ${args.base}…`);
    const checkout = await checkoutBase(args.dir, args.base, () => status(`Installing dependencies for ${args.base}…`));
    let comparison;
    try {
      const base = await run(checkout.projectRoot, options(` for ${args.base}`));
      const head = await run(args.dir, options(' for the working tree'));
      comparison = compare({ ...base, ref: args.base, commit: checkout.commit }, head);
    } finally {
      if (!args['keep-temp']) checkout.dispose();
    }
    status('');

    if (args.json) output(args.json, JSON.stringify(comparison, null, 2));
    if (args.markdown) output(args.markdown, formatComparisonMarkdown(comparison));
    if (!quiet) {
      const shown = { ...comparison, plugins: comparison.plugins.filter((p) => !only || only.includes(p.name)) };
      console.log(formatComparison(shown, { color: process.stdout.isTTY }));
      if (args.markdown) console.log(`Markdown: ${args.markdown}`);
      if (args.json) console.log(`JSON: ${args.json}`);
      if (args['keep-temp']) {
        console.log(`Base checkout kept in ${checkout.projectRoot} (remove it with git worktree remove)`);
        for (const dir of [comparison.base.tempDir, comparison.head.tempDir]) if (dir) console.log(`Temp copies kept in ${dir}`);
      }
    }
    return;
  }

  const result = await run(args.dir, options(''));
  status('');

  if (args.json) output(args.json, JSON.stringify(result, null, 2));
  if (args.markdown) output(args.markdown, formatMarkdown(result));
  if (htmlFile) writeFileSync(htmlFile, renderHtml(result));

  if (!quiet) {
    console.log(formatTerminal(result, { color: process.stdout.isTTY, only }));
    if (htmlFile) console.log(`Report: ${htmlFile}`);
    if (args.markdown) console.log(`Markdown: ${args.markdown}`);
    if (args.json) console.log(`JSON: ${args.json}`);
    if (result.tempDir) console.log(`Temp copies kept in ${result.tempDir}`);
  }
}

runMain(main);
