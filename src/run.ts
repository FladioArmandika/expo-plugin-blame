import { availableParallelism } from 'node:os';
import path from 'node:path';
import { blame, type BlameResult, type Step } from './blame.js';
import { loadExpoProject } from './expo.js';
import { mapLimit, runPrebuild, type Platform } from './prebuild.js';
import { normalizeSnapshots, readSnapshot, type Snapshot } from './snapshot.js';
import { openCache, stepKeys } from './cache.js';
import { createWorkspace } from './workspace.js';

export interface RunOptions {
  platform?: Platform;
  concurrency?: number;
  keepTemp?: boolean;
  /** Folder for cached snapshots. Leave out to always run every prebuild. */
  cacheDir?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RunResult extends BlameResult {
  projectRoot: string;
  sdkVersion: string | undefined;
  platform: Platform;
  /** Prebuilds that actually ran. */
  prebuilds: number;
  /** Steps whose output came from the cache instead. */
  cached: number;
  durationMs: number;
  /** Set when the temp workspace was kept. */
  tempDir?: string;
}

export async function run(projectRoot: string, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const root = path.resolve(projectRoot);
  const platform = options.platform ?? 'all';
  const project = loadExpoProject(root);
  const steps: Step[] = [
    ...project.plugins.map((name, index) => ({ index, name, auto: false })),
    ...project.autoPlugins.map((name, i) => ({ index: project.plugins.length + i, name, auto: true })),
  ];

  const workspace = createWorkspace(project);
  try {
    // Step k runs prebuild with the first k plugins; k = 0 is the baseline.
    const counts = Array.from({ length: steps.length + 1 }, (_, k) => k);
    const cache = options.cacheDir ? openCache(options.cacheDir) : undefined;
    const keys = cache
      ? stepKeys({
          projectRoot: root,
          templateDir: workspace.template,
          staticConfig: project.dynamicConfigPath ? undefined : 'app.json',
          plugins: [...project.pluginEntries, ...project.autoPlugins],
          platform,
        })
      : [];
    const snapshots: (Snapshot | undefined)[] = counts.map((k) => cache?.get(keys[k]!));
    const missing = counts.filter((k) => !snapshots[k]);
    let done = 0;
    await mapLimit(missing, options.concurrency ?? availableParallelism(), async (k) => {
      const dir = workspace.stepDir(k);
      await runPrebuild(project.expoCli, dir, k, platform);
      const snapshot = readSnapshot(dir);
      cache?.set(keys[k]!, snapshot);
      snapshots[k] = snapshot;
      options.onProgress?.(++done, missing.length);
    });
    // Copies, so normalizing never touches what's in the cache.
    const all = snapshots.map((s) => new Map(s!));
    normalizeSnapshots(all);

    return {
      ...blame(steps, all),
      projectRoot: root,
      sdkVersion: project.sdkVersion,
      platform,
      prebuilds: missing.length,
      cached: counts.length - missing.length,
      durationMs: Date.now() - started,
      tempDir: options.keepTemp ? workspace.root : undefined,
    };
  } finally {
    if (!options.keepTemp) workspace.dispose();
  }
}
