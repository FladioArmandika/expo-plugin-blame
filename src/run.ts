import { availableParallelism } from 'node:os';
import path from 'node:path';
import { blame, type BlameResult, type Step } from './blame.js';
import { loadExpoProject } from './expo.js';
import { mapLimit, runPrebuild, type Platform } from './prebuild.js';
import { normalizeSnapshots, readSnapshot, type Snapshot } from './snapshot.js';
import { createWorkspace } from './workspace.js';

export interface RunOptions {
  platform?: Platform;
  concurrency?: number;
  keepTemp?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface RunResult extends BlameResult {
  projectRoot: string;
  sdkVersion: string | undefined;
  platform: Platform;
  prebuilds: number;
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
    let done = 0;
    const snapshots: Snapshot[] = await mapLimit(counts, options.concurrency ?? availableParallelism(), async (k) => {
      const dir = workspace.stepDir(k);
      await runPrebuild(project.expoCli, dir, k, platform);
      const snapshot = readSnapshot(dir);
      options.onProgress?.(++done, counts.length);
      return snapshot;
    });
    normalizeSnapshots(snapshots);

    return {
      ...blame(steps, snapshots),
      projectRoot: root,
      sdkVersion: project.sdkVersion,
      platform,
      prebuilds: counts.length,
      durationMs: Date.now() - started,
      tempDir: options.keepTemp ? workspace.root : undefined,
    };
  } finally {
    if (!options.keepTemp) workspace.dispose();
  }
}
