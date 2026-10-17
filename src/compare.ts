import { createTwoFilesPatch, diffArrays } from 'diff';
import { BASELINE, type FileBlame } from './blame.js';
import type { RunResult } from './run.js';

/** Owner name for lines from Expo's template and defaults. */
export const EXPO_DEFAULTS = 'Expo defaults';

export interface ComparedFile {
  file: string;
  status: 'added' | 'modified' | 'deleted';
  binary: boolean;
  added: number;
  removed: number;
  /** Unified diff from base to head; empty for binary files. */
  patch: string;
}

export interface PluginDelta {
  name: string;
  auto: boolean;
  /** `added` and `removed` mean the plugin is only in head or only in base. */
  status: 'added' | 'removed' | 'kept';
  /** Lines this plugin owns in head but not base, and the reverse, per file. */
  files: { file: string; added: number; removed: number; binary: boolean }[];
}

export interface Comparison {
  base: RunResult & { ref: string; commit: string };
  head: RunResult;
  files: ComparedFile[];
  plugins: PluginDelta[];
  /** Overlaps in head that base doesn't have. */
  newOverlaps: {
    file: string;
    kind: 'lines' | 'file';
    plugins: string[];
    /** For `lines`: which plugin changed lines written by which others. */
    clashes: { plugin: string; overwrote: string[] }[];
  }[];
}

const ownerName = (result: RunResult, owner: number) =>
  owner === BASELINE ? EXPO_DEFAULTS : (result.steps[owner]?.name ?? `step ${owner + 1}`);

const joinLines = (blame: FileBlame | undefined) =>
  blame && !blame.binary ? blame.lines.map((l) => l.text + '\n').join('') : '';

/**
 * Compares the final native output of two runs and blames each changed line on
 * the plugin that owns it: the head's owner for added lines, the base's for
 * removed ones.
 */
export function compare(base: Comparison['base'], head: RunResult): Comparison {
  const baseFiles = new Map(base.files.map((f) => [f.file, f]));
  const headFiles = new Map(head.files.map((f) => [f.file, f]));
  const files: ComparedFile[] = [];
  const counts = new Map<string, Map<string, { added: number; removed: number; binary: boolean }>>();
  const count = (name: string, file: string, added: number, removed: number, binary = false) => {
    const byFile = counts.get(name) ?? new Map();
    counts.set(name, byFile);
    const entry = byFile.get(file) ?? { added: 0, removed: 0, binary };
    entry.added += added;
    entry.removed += removed;
    byFile.set(file, entry);
  };

  for (const file of [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort()) {
    const a = baseFiles.get(file);
    const b = headFiles.get(file);
    const status = !a ? 'added' : !b ? 'deleted' : 'modified';

    if (a?.binary || b?.binary) {
      if (a && b && a.binary && b.binary && a.hash === b.hash) continue;
      files.push({ file, status, binary: true, added: 0, removed: 0, patch: '' });
      const owner = b ? ownerName(head, b.lines[0]!.owner) : ownerName(base, a!.lines[0]!.owner);
      count(owner, file, 0, 0, true);
      continue;
    }

    const oldLines = a?.lines ?? [];
    const newLines = b?.lines ?? [];
    let added = 0;
    let removed = 0;
    let i = 0;
    let j = 0;
    const parts = diffArrays(oldLines.map((l) => l.text), newLines.map((l) => l.text));
    // Where parts start in the old and new line lists.
    const starts = parts.map((part) => {
      const at = { i, j };
      if (!part.added) i += part.value.length;
      if (!part.removed) j += part.value.length;
      return at;
    });
    // On the same SDK, Expo's defaults don't change, so a default line that
    // comes or goes was replaced by whichever plugin's lines sit next to it.
    const sameSdk = base.sdkVersion === head.sdkVersion;
    const neighbour = (k: number, wanted: 'added' | 'removed'): string | undefined => {
      for (const n of [k + 1, k - 1]) {
        const part = parts[n];
        if (!part || !part[wanted]) continue;
        const owner = wanted === 'added' ? newLines[starts[n]!.j]!.owner : oldLines[starts[n]!.i]!.owner;
        if (owner !== BASELINE) return ownerName(wanted === 'added' ? head : base, owner);
      }
      return undefined;
    };
    parts.forEach((part, k) => {
      const n = part.value.length;
      if (part.added) {
        for (let m = 0; m < n; m++) {
          const owner = newLines[starts[k]!.j + m]!.owner;
          count((owner === BASELINE && sameSdk && neighbour(k, 'removed')) || ownerName(head, owner), file, 1, 0);
        }
        added += n;
      } else if (part.removed) {
        for (let m = 0; m < n; m++) {
          const owner = oldLines[starts[k]!.i + m]!.owner;
          count((owner === BASELINE && sameSdk && neighbour(k, 'added')) || ownerName(base, owner), file, 0, 1);
        }
        removed += n;
      }
    });
    if (!added && !removed && status === 'modified') continue;
    files.push({
      file, status, binary: false, added, removed,
      patch: createTwoFilesPatch(file, file, joinLines(a), joinLines(b), base.ref, 'head', { context: 3 }),
    });
  }

  const baseSteps = new Map(base.steps.map((s) => [s.name, s]));
  const headSteps = new Map(head.steps.map((s) => [s.name, s]));
  const plugins: PluginDelta[] = [];
  // Head's order first, then plugins that were removed, then Expo's own changes.
  const names = [...headSteps.keys(), ...[...baseSteps.keys()].filter((n) => !headSteps.has(n)), EXPO_DEFAULTS];
  for (const name of names) {
    const step = headSteps.get(name) ?? baseSteps.get(name);
    const status = name === EXPO_DEFAULTS || (headSteps.has(name) && baseSteps.has(name)) ? 'kept' : headSteps.has(name) ? 'added' : 'removed';
    const byFile = counts.get(name);
    if (status === 'kept' && !byFile) continue;
    plugins.push({
      name,
      auto: step?.auto ?? false,
      status,
      files: [...(byFile ?? [])].map(([file, c]) => ({ file, ...c })),
    });
  }

  // An overlap is new when it involves a plugin, or a clash between two plugins,
  // that base didn't have on that file. Order and unrelated plugins don't count.
  const clashesOf = (result: RunResult, file: string) =>
    result.changes
      .filter((c) => c.file === file && c.overwrote.length)
      .map((c) => ({ plugin: ownerName(result, c.step), overwrote: c.overwrote.map((s) => ownerName(result, s)) }));
  const baseByFile = new Map(base.overlaps.map((o) => [o.file, o]));
  const newOverlaps: Comparison['newOverlaps'] = [];
  for (const o of head.overlaps) {
    const before = baseByFile.get(o.file);
    const plugins = o.steps.map((s) => ownerName(head, s));
    const basePlugins = new Set(before?.steps.map((s) => ownerName(base, s)));
    const basePairs = new Set(clashesOf(base, o.file).flatMap((c) => c.overwrote.map((w) => `${c.plugin}<${w}`)));
    const clashes = clashesOf(head, o.file)
      .map((c) => ({ plugin: c.plugin, overwrote: c.overwrote.filter((w) => !basePairs.has(`${c.plugin}<${w}`)) }))
      .filter((c) => c.overwrote.length);
    if (clashes.length) newOverlaps.push({ file: o.file, kind: 'lines', plugins, clashes });
    else if (plugins.some((p) => !basePlugins.has(p))) newOverlaps.push({ file: o.file, kind: 'file', plugins, clashes: [] });
  }

  return { base, head, files, plugins, newOverlaps };
}
