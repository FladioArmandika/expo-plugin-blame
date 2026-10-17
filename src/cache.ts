import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Platform } from './prebuild.js';
import type { FileContent, Snapshot } from './snapshot.js';

// Bump when snapshots change meaning in a way the code hash wouldn't catch.
const FORMAT = 1;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const sha = (...parts: (string | Buffer)[]) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
};

// Files that record exactly what's installed, from the lockfile down to node_modules.
const DEP_STATE = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'node_modules/.package-lock.json', 'node_modules/.yarn-state.yml', 'node_modules/.modules.yaml', 'node_modules/.yarn-integrity',
];

const LOCAL_EXTENSIONS = ['', '.ts', '.js', '.mjs', '.cjs', '/app.plugin.js', '/index.ts', '/index.js'];

export interface CacheInputs {
  /** The project folder, for the installed dependency state. */
  projectRoot: string;
  /** The prepared copy of the project that every step starts from. Its paths match the project's. */
  templateDir: string;
  /** The app.json in the template, if the project has one and no dynamic config. */
  staticConfig: string | undefined;
  /** Plugin entries in step order: the app config's plugins, then auto-applied names. */
  plugins: unknown[];
  platform: Platform;
}

/**
 * One cache key per step, k = 0..plugins.length. A step's key covers everything
 * its prebuild reads: this tool's code, the installed dependencies, the project
 * files, and the first k plugin entries. Local plugin files only count toward
 * the steps that include them, so editing the last plugin reuses every earlier
 * step. With a dynamic app config, the whole config file counts for every step.
 */
export function stepKeys(inputs: CacheInputs): string[] {
  // Local plugin files, by step, as paths relative to the project when inside it.
  const localFiles = new Map<number, string>();
  inputs.plugins.forEach((entry, i) => {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name !== 'string' || !(name.startsWith('.') || path.isAbsolute(name))) return;
    for (const ext of LOCAL_EXTENSIONS) {
      const file = path.resolve(inputs.projectRoot, name + ext);
      if (existsSync(file) && statSync(file).isFile()) {
        localFiles.set(i, file);
        return;
      }
    }
  });
  const pluginFiles = new Set([...localFiles.values()].map((file) => path.relative(inputs.projectRoot, file)));

  // Plugin packages linked from elsewhere in a monorepo can change without the
  // lockfile changing, so their source counts too.
  const linked: string[] = [];
  const projectRequire = createRequire(path.join(inputs.projectRoot, 'package.json'));
  for (const entry of inputs.plugins) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name !== 'string' || name.startsWith('.') || path.isAbsolute(name)) continue;
    try {
      const dir = realpathSync(path.dirname(projectRequire.resolve(`${name}/package.json`)));
      if (!dir.split(path.sep).includes('node_modules')) linked.push(name, hashDir(dir));
    } catch {
      // Not resolvable here; prebuild will say so.
    }
  }

  // Every file in the template except the plugin list and local plugin files.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(inputs.templateDir, full));
    }
  };
  walk(inputs.templateDir);
  const projectParts: string[] = [];
  for (const file of files.sort()) {
    if (pluginFiles.has(file)) continue;
    let content: string | Buffer = readFileSync(path.join(inputs.templateDir, file));
    if (file === inputs.staticConfig) {
      const json = JSON.parse(content.toString('utf8'));
      if (json.expo) delete json.expo.plugins;
      else delete json.plugins;
      content = JSON.stringify(json);
    }
    projectParts.push(file, sha(content));
  }
  const deps = DEP_STATE.map((file) => {
    const full = path.join(inputs.projectRoot, file);
    return existsSync(full) ? sha(readFileSync(full)) : '-';
  });
  const shared = sha(String(FORMAT), toolHash(), inputs.platform, ...deps, ...linked, ...projectParts);

  // Plugins after step k are still read (to keep them out of Expo's auto-apply),
  // but only by name, which is in every key.
  const names = inputs.plugins.map((entry) => describe(Array.isArray(entry) ? entry[0] : entry));
  const keys = [sha(shared, ...names, '0')];
  let rolling = keys[0]!;
  inputs.plugins.forEach((entry, i) => {
    const local = localFiles.get(i);
    rolling = sha(rolling, describe(entry), local ? sha(readFileSync(local)) : '');
    keys.push(rolling);
  });
  return keys;
}

function hashDir(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) parts.push(path.relative(root, full), sha(readFileSync(full)));
    }
  };
  walk(root);
  return sha(...parts);
}

// Plugin entries as stable text. Functions come from config files, which are
// already part of the key, so their name is enough.
function describe(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === 'function' ? `[function ${v.name}]` : v)) ?? String(value);
}

let cachedToolHash: string | undefined;
// The built code itself, so a new version or a local rebuild never reuses old snapshots.
function toolHash(): string {
  if (cachedToolHash) return cachedToolHash;
  const self = fileURLToPath(import.meta.url);
  const dir = path.dirname(self);
  const parts = [readFileSync(self)];
  for (const candidate of ['runtime/app-config.cjs', '../dist/runtime/app-config.cjs']) {
    const file = path.join(dir, candidate);
    if (existsSync(file)) parts.push(readFileSync(file));
  }
  return (cachedToolHash = sha(...parts));
}

export interface SnapshotCache {
  get(key: string): Snapshot | undefined;
  set(key: string, snapshot: Snapshot): void;
}

/** Snapshots stored as gzipped JSON files in `dir`, dropped after two weeks unused. */
export function openCache(dir: string): SnapshotCache {
  const file = (key: string) => path.join(dir, `${key.slice(0, 32)}.json.gz`);
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (now - statSync(full).mtimeMs > MAX_AGE_MS) rmSync(full, { force: true });
    }
  } catch {
    // No cache yet.
  }
  return {
    get(key) {
      try {
        const entries = JSON.parse(gunzipSync(readFileSync(file(key))).toString('utf8')) as [string, FileContent][];
        const now = new Date();
        utimesSync(file(key), now, now);
        return new Map(entries);
      } catch {
        return undefined;
      }
    },
    set(key, snapshot) {
      try {
        mkdirSync(dir, { recursive: true });
        // Write then rename, so a parallel run never reads half a file.
        const tmp = `${file(key)}.${process.pid}.tmp`;
        writeFileSync(tmp, gzipSync(JSON.stringify([...snapshot])));
        renameSync(tmp, file(key));
      } catch {
        // A cache that can't be written just means the next run is slower.
      }
    },
  };
}

/** Where the cache lives by default: node_modules/.cache, like other tools. */
export const defaultCacheDir = (projectRoot: string) => path.join(projectRoot, 'node_modules', '.cache', 'prebuild-blame');
