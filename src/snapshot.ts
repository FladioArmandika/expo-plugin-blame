import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePbxproj, parseObjects } from './normalize/pbxproj.js';

export type FileContent = { kind: 'text'; text: string } | { kind: 'binary'; hash: string };

/** Generated native files, keyed by POSIX path relative to the project root. */
export type Snapshot = Map<string, FileContent>;

// Build output and dependency folders that can appear under android/ or ios/.
const SKIP_DIRS = new Set(['Pods', 'build', '.gradle', '.cxx', 'node_modules', '.kotlin']);

export function readSnapshot(projectDir: string): Snapshot {
  const snapshot: Snapshot = new Map();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(projectDir, full).split(path.sep).join('/');
        const bytes = readFileSync(full);
        snapshot.set(
          rel,
          bytes.includes(0)
            ? { kind: 'binary', hash: createHash('sha1').update(bytes).digest('hex') }
            : { kind: 'text', text: bytes.toString('utf8') },
        );
      }
    }
  };
  for (const platform of ['android', 'ios']) {
    try {
      walk(path.join(projectDir, platform));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return snapshot;
}

const isPbxproj = (file: string) => file.endsWith('.pbxproj');

/**
 * Normalizes every `project.pbxproj` in the snapshots, keeping the object ids
 * the baseline (first snapshot) already has so unchanged lines stay identical.
 */
export function normalizeSnapshots(snapshots: Snapshot[]): void {
  const baseline = snapshots[0];
  if (!baseline) return;
  const stable = new Map<string, Set<string>>();
  for (const [file, content] of baseline) {
    if (isPbxproj(file) && content.kind === 'text') stable.set(file, new Set(parseObjects(content.text).keys()));
  }
  for (const snapshot of snapshots) {
    for (const [file, content] of snapshot) {
      if (isPbxproj(file) && content.kind === 'text') {
        snapshot.set(file, { kind: 'text', text: normalizePbxproj(content.text, stable.get(file)) });
      }
    }
  }
}
