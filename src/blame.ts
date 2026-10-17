import { createTwoFilesPatch, diffArrays } from 'diff';
import type { FileContent, Snapshot } from './snapshot.js';

/** Line owner for lines that come from Expo's template and defaults. */
export const BASELINE = -1;

export interface Step {
  /** Index into the plugin list, 0-based. Step i's output includes plugins 0..i. */
  index: number;
  name: string;
  /** Applied automatically by Expo because the package is installed. */
  auto: boolean;
}

export interface FileChange {
  step: number;
  file: string;
  status: 'added' | 'modified' | 'deleted';
  binary: boolean;
  added: number;
  removed: number;
  /** Unified diff against the previous step; empty for binary files. */
  patch: string;
  /** Earlier plugin steps whose lines this change removed or replaced. */
  overwrote: number[];
}

export interface FileBlame {
  file: string;
  binary: boolean;
  /** Final content, one entry per line, with the step that last wrote it. */
  lines: { text: string; owner: number }[];
}

export interface Overlap {
  file: string;
  steps: number[];
  /** `lines`: a later plugin changed lines an earlier plugin wrote. `file`: same file, separate lines. */
  kind: 'lines' | 'file';
}

export interface BlameResult {
  steps: Step[];
  changes: FileChange[];
  files: FileBlame[];
  overlaps: Overlap[];
}

const splitLines = (text: string): string[] => {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

const textOf = (content: FileContent | undefined) => (content?.kind === 'text' ? content.text : '');

/**
 * Attributes every change between consecutive snapshots to the step that made
 * it. `snapshots[0]` is the baseline and `snapshots[i + 1]` is the output with
 * `steps[i]` added.
 */
export function blame(steps: Step[], snapshots: Snapshot[]): BlameResult {
  const changes: FileChange[] = [];
  const owners = new Map<string, { text: string; owner: number }[]>();
  const binaryOwner = new Map<string, number>();

  for (const [file, content] of snapshots[0]!) {
    if (content.kind === 'text') owners.set(file, splitLines(content.text).map((text) => ({ text, owner: BASELINE })));
    else binaryOwner.set(file, BASELINE);
  }

  for (const step of steps) {
    const before = snapshots[step.index]!;
    const after = snapshots[step.index + 1]!;
    const files = new Set([...before.keys(), ...after.keys()]);

    for (const file of [...files].sort()) {
      const a = before.get(file);
      const b = after.get(file);
      if (sameContent(a, b)) continue;
      const status = !a ? 'added' : !b ? 'deleted' : 'modified';

      if (a?.kind === 'binary' || b?.kind === 'binary') {
        const prev = binaryOwner.get(file);
        changes.push({
          step: step.index, file, status, binary: true, added: 0, removed: 0, patch: '',
          overwrote: prev !== undefined && prev !== BASELINE && a ? [prev] : [],
        });
        owners.delete(file);
        if (b) binaryOwner.set(file, step.index);
        else binaryOwner.delete(file);
        continue;
      }

      const old = owners.get(file) ?? [];
      const next: { text: string; owner: number }[] = [];
      const overwrote = new Set<number>();
      let added = 0;
      let removed = 0;
      let i = 0;
      for (const part of diffArrays(old.map((l) => l.text), splitLines(textOf(b)))) {
        if (part.added) {
          added += part.count ?? part.value.length;
          for (const text of part.value) next.push({ text, owner: step.index });
        } else if (part.removed) {
          for (const _ of part.value) {
            const owner = old[i++]!.owner;
            if (owner !== BASELINE) overwrote.add(owner);
            removed++;
          }
        } else {
          for (const _ of part.value) next.push(old[i++]!);
        }
      }

      changes.push({
        step: step.index, file, status, binary: false, added, removed,
        patch: createTwoFilesPatch(file, file, textOf(a), textOf(b), '', '', { context: 3 }),
        overwrote: [...overwrote].sort((x, y) => x - y),
      });
      if (b) owners.set(file, next);
      else owners.delete(file);
    }
  }

  const files: FileBlame[] = [
    ...[...owners].map(([file, lines]) => ({ file, binary: false, lines })),
    ...[...binaryOwner].map(([file, owner]) => ({ file, binary: true, lines: [{ text: '', owner }] })),
  ].sort((x, y) => x.file.localeCompare(y.file));

  return { steps, changes, files, overlaps: findOverlaps(changes) };
}

function sameContent(a: FileContent | undefined, b: FileContent | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text;
  if (a.kind === 'binary' && b.kind === 'binary') return a.hash === b.hash;
  return false;
}

function findOverlaps(changes: FileChange[]): Overlap[] {
  const byFile = new Map<string, FileChange[]>();
  for (const change of changes) byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]);

  const overlaps: Overlap[] = [];
  for (const [file, fileChanges] of byFile) {
    const steps = [...new Set(fileChanges.map((c) => c.step))];
    if (steps.length < 2) continue;
    const clash = fileChanges.some((c) => c.overwrote.length > 0);
    overlaps.push({ file, steps, kind: clash ? 'lines' : 'file' });
  }
  return overlaps.sort((x, y) => (x.kind === y.kind ? x.file.localeCompare(y.file) : x.kind === 'lines' ? -1 : 1));
}
