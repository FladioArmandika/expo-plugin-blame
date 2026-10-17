import { describe, expect, it } from 'vitest';
import { BASELINE, blame, type Step } from '../src/blame.js';
import type { Snapshot } from '../src/snapshot.js';

const snap = (files: Record<string, string | { binary: string }>): Snapshot =>
  new Map(
    Object.entries(files).map(([file, v]) => [
      file,
      typeof v === 'string' ? { kind: 'text', text: v } : { kind: 'binary', hash: v.binary },
    ]),
  );
const steps = (...names: string[]): Step[] => names.map((name, index) => ({ index, name, auto: false }));

describe('blame', () => {
  it('attributes each added line to the step that added it', () => {
    const result = blame(steps('a', 'b'), [
      snap({ 'f.txt': 'base\n' }),
      snap({ 'f.txt': 'base\nfrom a\n' }),
      snap({ 'f.txt': 'base\nfrom a\nfrom b\n', 'new.txt': 'b only\n' }),
    ]);
    expect(result.changes.map((c) => [c.step, c.file, c.status, c.added, c.removed])).toEqual([
      [0, 'f.txt', 'modified', 1, 0],
      [1, 'f.txt', 'modified', 1, 0],
      [1, 'new.txt', 'added', 1, 0],
    ]);
    expect(result.files.find((f) => f.file === 'f.txt')!.lines.map((l) => l.owner)).toEqual([BASELINE, 0, 1]);
    expect(result.overlaps).toEqual([{ file: 'f.txt', steps: [0, 1], kind: 'file' }]);
  });

  it('flags a step that rewrites lines from an earlier plugin', () => {
    const result = blame(steps('a', 'b'), [
      snap({ 'f.txt': 'base\n' }),
      snap({ 'f.txt': 'base\nkey=a\n' }),
      snap({ 'f.txt': 'base\nkey=b\n' }),
    ]);
    expect(result.changes[1]!.overwrote).toEqual([0]);
    expect(result.overlaps).toEqual([{ file: 'f.txt', steps: [0, 1], kind: 'lines' }]);
  });

  it("doesn't flag changes to baseline lines as conflicts", () => {
    const result = blame(steps('a'), [snap({ 'f.txt': 'x=1\n' }), snap({ 'f.txt': 'x=2\n' })]);
    expect(result.changes[0]).toMatchObject({ added: 1, removed: 1, overwrote: [] });
    expect(result.overlaps).toEqual([]);
  });

  it('tracks binary files and deletions', () => {
    const result = blame(steps('a', 'b'), [
      snap({ 'icon.png': { binary: '1' }, 'old.txt': 'x\n' }),
      snap({ 'icon.png': { binary: '2' }, 'old.txt': 'x\n' }),
      snap({ 'icon.png': { binary: '3' } }),
    ]);
    expect(result.changes.map((c) => [c.step, c.file, c.status, c.binary, c.overwrote])).toEqual([
      [0, 'icon.png', 'modified', true, []],
      [1, 'icon.png', 'modified', true, [0]],
      [1, 'old.txt', 'deleted', false, []],
    ]);
  });
});
