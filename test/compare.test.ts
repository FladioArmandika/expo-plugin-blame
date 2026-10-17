import { describe, expect, it } from 'vitest';
import { blame } from '../src/blame.js';
import { compare, EXPO_DEFAULTS } from '../src/compare.js';
import { formatComparisonMarkdown, MARKER } from '../src/report/markdown.js';
import { formatComparison } from '../src/report/terminal.js';
import type { RunResult } from '../src/run.js';
import type { Snapshot } from '../src/snapshot.js';

const snap = (files: Record<string, string>): Snapshot =>
  new Map(Object.entries(files).map(([file, text]) => [file, { kind: 'text', text }]));

/** A run where plugin `names[i]` produced `snapshots[i + 1]`. */
function runOf(names: string[], snapshots: Record<string, string>[], sdkVersion = '58.0.0'): RunResult {
  const steps = names.map((name, index) => ({ index, name, auto: false }));
  return {
    ...blame(steps, snapshots.map(snap)),
    projectRoot: '/app',
    sdkVersion,
    platform: 'all',
    prebuilds: snapshots.length,
    durationMs: 1000,
  };
}

const base = (result: RunResult) => ({ ...result, ref: 'main', commit: 'abc1234' });

describe('compare', () => {
  it('reports nothing when the output is the same', () => {
    const run = runOf(['a'], [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\na\n' }]);
    const cmp = compare(base(run), run);
    expect(cmp.files).toEqual([]);
    expect(cmp.plugins).toEqual([]);
    expect(formatComparison(cmp)).toContain('No changes to the generated native files.');
    expect(formatComparisonMarkdown(cmp)).toContain('No changes');
  });

  it('blames added lines on head and removed lines on base', () => {
    const before = runOf(['a', 'gone'], [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\na=1\n' }, { 'f.txt': 'x\na=1\ngone\n' }]);
    const after = runOf(['a', 'new'], [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\na=2\n' }, { 'f.txt': 'x\na=2\n', 'n.txt': 'new\n' }]);
    const cmp = compare(base(before), after);
    expect(cmp.files.map((f) => [f.file, f.status, f.added, f.removed])).toEqual([
      ['f.txt', 'modified', 1, 2],
      ['n.txt', 'added', 1, 0],
    ]);
    expect(cmp.plugins.map((p) => [p.name, p.status, p.files.map((f) => `${f.file} +${f.added} -${f.removed}`)])).toEqual([
      ['a', 'kept', ['f.txt +1 -1']],
      ['new', 'added', ['n.txt +1 -0']],
      ['gone', 'removed', ['f.txt +0 -1']],
    ]);
  });

  it('blames a replaced default line on the plugin that replaced it', () => {
    const before = runOf(['a'], [{ 'f.txt': 'target=16\n' }, { 'f.txt': 'target=16\n' }]);
    const after = runOf(['a'], [{ 'f.txt': 'target=16\n' }, { 'f.txt': 'target=17\n' }]);
    expect(compare(base(before), after).plugins.map((p) => [p.name, p.files[0]!.added, p.files[0]!.removed])).toEqual([['a', 1, 1]]);
  });

  it('keeps template changes on Expo when the SDK changed', () => {
    const before = runOf([], [{ 'f.txt': 'sdk 57\n' }], '57.0.0');
    const after = runOf([], [{ 'f.txt': 'sdk 58\n' }], '58.0.0');
    expect(compare(base(before), after).plugins.map((p) => p.name)).toEqual([EXPO_DEFAULTS]);
  });

  it('only flags overlaps that are new', () => {
    const files = (b: string) => [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\nk=a\n' }, { 'f.txt': `x\n${b}\n` }];
    const clash = runOf(['a', 'b'], files('k=b'));
    expect(compare(base(clash), clash).newOverlaps).toEqual([]);

    const calm = runOf(['a', 'b'], files('k=a\nb'));
    const cmp = compare(base(calm), clash);
    expect(cmp.newOverlaps).toEqual([{ file: 'f.txt', kind: 'lines', plugins: ['a', 'b'], clashes: [{ plugin: 'b', overwrote: ['a'] }] }]);
    expect(formatComparison(cmp)).toContain('⚠ f.txt: b now changes lines written by a');
  });

  it('writes a Markdown comment with a marker, a table and diffs', () => {
    const before = runOf(['a'], [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\n' }]);
    const after = runOf(['a'], [{ 'f.txt': 'x\n' }, { 'f.txt': 'x\nadded | by a\n' }]);
    const md = formatComparisonMarkdown(compare(base(before), after));
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain('| `a` | `f.txt` +1 |');
    expect(md).toContain('+added | by a');
    expect(md).toContain('<details><summary>f.txt</summary>');
  });
});
