import path from 'node:path';
import { styleText } from 'node:util';
import type { FileChange } from '../blame.js';
import type { Comparison, PluginDelta } from '../compare.js';
import type { RunResult } from '../run.js';

type Style = Parameters<typeof styleText>[0];

export interface TerminalOptions {
  color?: boolean;
  /** Only show these plugins (names as listed in the app config). */
  only?: string[];
}

/** Short names for files: the basename, or more of the path where basenames clash. */
function shortNames(files: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const file of new Set(files)) byBase.set(path.posix.basename(file), [...(byBase.get(path.posix.basename(file)) ?? []), file]);
  for (const [base, group] of byBase) {
    for (const file of group) names.set(file, group.length === 1 ? base : file);
  }
  return names;
}

export function formatTerminal(result: RunResult, options: TerminalOptions = {}): string {
  const paint = (style: Style, text: string) => (options.color ? styleText(style, text) : text);
  const names = shortNames(result.changes.map((c) => c.file));
  const stepName = (i: number) => result.steps[i]?.name ?? `step ${i + 1}`;
  const shown = result.steps.filter((s) => !options.only || options.only.includes(s.name));
  const width = Math.max(0, ...shown.map((s) => s.name.length + (s.auto ? 7 : 0)));

  const counts = (c: FileChange) => {
    if (c.binary) return paint('yellow', c.status === 'modified' ? '(binary)' : `(binary, ${c.status})`);
    const parts = [];
    if (c.added) parts.push(paint('green', `+${c.added}`));
    if (c.removed) parts.push(paint('red', `-${c.removed}`));
    if (c.status !== 'modified') parts.push(paint('dim', `(${c.status === 'added' ? 'new' : 'deleted'})`));
    return parts.join(' ');
  };

  const sdk = sdkLabel(result.sdkVersion);
  const lines = [
    paint('bold', 'prebuild-blame') +
      paint('dim', ` · ${sdk} · ${result.steps.length} plugins · ${result.prebuilds} prebuilds in ${(result.durationMs / 1000).toFixed(1)}s${result.platform === 'all' ? '' : ` · ${result.platform} only`}`),
  ];

  for (const step of shown) {
    const label = step.name + (step.auto ? paint('dim', ' (auto)') : '');
    const pad = ' '.repeat(width - step.name.length - (step.auto ? 7 : 0) + 2);
    const changes = result.changes.filter((c) => c.step === step.index);
    const summary = changes.length
      ? changes.map((c) => `${names.get(c.file)} ${counts(c)}`).join(', ')
      : paint('dim', 'no native changes');
    lines.push(`  ${paint('cyan', label)}${pad}${summary}`);
  }

  const relevant = result.overlaps.filter((o) => !options.only || o.steps.some((s) => options.only!.includes(stepName(s))));
  for (const overlap of relevant) {
    const who = overlap.steps.map(stepName).join(', ');
    if (overlap.kind === 'lines') {
      for (const c of result.changes.filter((c) => c.file === overlap.file && c.overwrote.length)) {
        lines.push(paint('yellow', `  ⚠ ${names.get(overlap.file)}: ${stepName(c.step)} changed lines written by ${c.overwrote.map(stepName).join(', ')}`));
      }
    } else {
      lines.push(paint('dim', `  · ${names.get(overlap.file)} touched by ${who}`));
    }
  }

  return lines.join('\n');
}

const sdkLabel = (version: string | undefined) => (version ? `SDK ${version.split('.')[0]}` : 'Expo');

export function formatComparison(cmp: Comparison, options: Pick<TerminalOptions, 'color'> = {}): string {
  const paint = (style: Style, text: string) => (options.color ? styleText(style, text) : text);
  const { base, head } = cmp;
  const names = shortNames(cmp.files.map((f) => f.file));
  const sdk = sdkLabel(base.sdkVersion) === sdkLabel(head.sdkVersion)
    ? sdkLabel(head.sdkVersion)
    : `${sdkLabel(base.sdkVersion)} → ${sdkLabel(head.sdkVersion).replace('SDK ', '')}`;
  const seconds = ((base.durationMs + head.durationMs) / 1000).toFixed(1);
  const lines = [
    paint('bold', 'prebuild-blame') +
      paint('dim', ` · ${base.ref} (${base.commit}) → working tree · ${sdk} · ${base.prebuilds + head.prebuilds} prebuilds in ${seconds}s${head.platform === 'all' ? '' : ` · ${head.platform} only`}`),
  ];

  const tag = (p: PluginDelta) =>
    [p.auto ? 'auto' : '', p.status === 'added' ? 'new' : p.status === 'removed' ? 'removed' : ''].filter(Boolean).join(', ');
  const labels = cmp.plugins.map((p) => p.name + (tag(p) ? ` (${tag(p)})` : ''));
  const width = Math.max(0, ...labels.map((l) => l.length));
  cmp.plugins.forEach((p, i) => {
    const label = labels[i]!;
    const painted = paint('cyan', p.name) + (tag(p) ? paint('dim', ` (${tag(p)})`) : '');
    const summary = p.files.length
      ? p.files
          .map((f) => {
            const parts = f.binary ? [paint('yellow', '(binary)')] : [];
            if (f.added) parts.push(paint('green', `+${f.added}`));
            if (f.removed) parts.push(paint('red', `-${f.removed}`));
            return `${names.get(f.file)} ${parts.join(' ')}`;
          })
          .join(', ')
      : paint('dim', 'no native changes');
    lines.push(`  ${painted}${' '.repeat(width - label.length + 2)}${summary}`);
  });

  for (const o of cmp.newOverlaps) {
    if (o.kind === 'lines') {
      for (const c of o.clashes) {
        lines.push(paint('yellow', `  ⚠ ${names.get(o.file) ?? path.posix.basename(o.file)}: ${c.plugin} now changes lines written by ${c.overwrote.join(', ')}`));
      }
    } else {
      lines.push(paint('dim', `  · ${names.get(o.file) ?? path.posix.basename(o.file)} is now touched by ${o.plugins.join(', ')}`));
    }
  }

  const n = cmp.files.length;
  lines.push(n ? paint('dim', `  ${n} generated file${n === 1 ? '' : 's'} changed`) : '  No changes to the generated native files.');
  return lines.join('\n');
}
