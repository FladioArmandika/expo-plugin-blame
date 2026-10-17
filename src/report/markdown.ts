import type { Comparison } from '../compare.js';
import type { RunResult } from '../run.js';

/** Lets a bot find and update its earlier comment instead of posting a new one. */
export const MARKER = '<!-- prebuild-blame -->';

// GitHub rejects comments over 65,536 characters; leave room for the rest.
const DIFF_BUDGET = 50_000;

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const counts = (f: { added: number; removed: number; binary: boolean; status?: string }) => {
  const parts = f.binary ? ['binary'] : [];
  if (f.added) parts.push(`+${f.added}`);
  if (f.removed) parts.push(`−${f.removed}`);
  if (f.status === 'added') parts.push('(new)');
  if (f.status === 'deleted') parts.push('(deleted)');
  return parts.join(' ');
};

function diffs(files: { file: string; patch: string; binary: boolean }[]): string[] {
  const out: string[] = [];
  let used = 0;
  let skipped = 0;
  for (const f of files) {
    if (f.binary || !f.patch) continue;
    // Drop jsdiff's "Index:" and "====" header lines; the summary names the file.
    const body = f.patch.split('\n').filter((l) => !l.startsWith('Index: ') && !/^=+$/.test(l)).join('\n').trim();
    const block = `<details><summary>${f.file}</summary>\n\n\`\`\`diff\n${body.replace(/```/g, '`​``')}\n\`\`\`\n\n</details>`;
    if (used + block.length > DIFF_BUDGET) {
      skipped++;
      continue;
    }
    used += block.length;
    out.push(block);
  }
  if (skipped) out.push(`_${skipped} more diff${skipped === 1 ? '' : 's'} left out to fit in a comment. Run prebuild-blame locally to see everything._`);
  return out;
}

const footer = (prebuilds: number, ms: number, sdk: string | undefined) =>
  `<sub>${sdk ? `SDK ${sdk.split('.')[0]} · ` : ''}${prebuilds} prebuilds in ${(ms / 1000).toFixed(1)}s · [prebuild-blame](https://github.com/FladioArmandika/prebuild-blame)</sub>`;

/** A PR-comment-sized summary of how the native output changed since the base. */
export function formatComparisonMarkdown(cmp: Comparison): string {
  const { base, head } = cmp;
  const lines = [MARKER, `### prebuild-blame: native changes since ${code(base.ref)}`, ''];

  if (!cmp.files.length) {
    lines.push(`No changes to the generated \`android/\` and \`ios/\` files since ${code(base.ref)} (${base.commit}).`);
  } else {
    if (base.sdkVersion !== head.sdkVersion) lines.push(`Expo SDK changed from ${base.sdkVersion ?? '?'} to ${head.sdkVersion ?? '?'}.`, '');
    lines.push('| Plugin | Changes |', '| --- | --- |');
    for (const p of cmp.plugins) {
      const tags = [p.auto ? 'auto' : '', p.status === 'added' ? 'new' : p.status === 'removed' ? 'removed' : ''].filter(Boolean);
      const name = code(p.name) + (tags.length ? ` (${tags.join(', ')})` : '');
      const changes = p.files.length ? p.files.map((f) => `${code(f.file.split('/').pop()!)} ${counts(f)}`).join(', ') : 'no native changes';
      lines.push(`| ${cell(name)} | ${cell(changes)} |`);
    }
    lines.push('');
    for (const o of cmp.newOverlaps) {
      if (o.kind === 'lines') {
        for (const c of o.clashes) lines.push(`> [!WARNING]\n> ${code(c.plugin)} now changes lines in ${code(o.file)} written by ${c.overwrote.map(code).join(', ')}.\n`);
      } else {
        lines.push(`- ${code(o.file)} is now edited by ${o.plugins.map(code).join(', ')}.`);
      }
    }
    if (cmp.newOverlaps.some((o) => o.kind === 'file')) lines.push('');
    lines.push(`**${cmp.files.length} generated file${cmp.files.length === 1 ? '' : 's'} changed**`, '');
    lines.push(...diffs(cmp.files).flatMap((d) => [d, '']));
  }

  lines.push('', footer(base.prebuilds + head.prebuilds, base.durationMs + head.durationMs, head.sdkVersion));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/** The plain blame summary as Markdown. */
export function formatMarkdown(result: RunResult): string {
  const name = (i: number) => result.steps[i]?.name ?? `step ${i + 1}`;
  const lines = [MARKER, '### prebuild-blame', '', '| Plugin | Changes |', '| --- | --- |'];
  for (const step of result.steps) {
    const changes = result.changes.filter((c) => c.step === step.index);
    const summary = changes.length ? changes.map((c) => `${code(c.file.split('/').pop()!)} ${counts(c)}`).join(', ') : 'no native changes';
    lines.push(`| ${cell(code(step.name) + (step.auto ? ' (auto)' : ''))} | ${cell(summary)} |`);
  }
  lines.push('');
  for (const o of result.overlaps) {
    if (o.kind === 'lines') {
      for (const c of result.changes.filter((c) => c.file === o.file && c.overwrote.length)) {
        lines.push(`> [!WARNING]\n> ${code(name(c.step))} changes lines in ${code(o.file)} written by ${c.overwrote.map((s) => code(name(s))).join(', ')}.\n`);
      }
    } else {
      lines.push(`- ${code(o.file)} is edited by ${o.steps.map((s) => code(name(s))).join(', ')}.`);
    }
  }
  lines.push('', footer(result.prebuilds, result.durationMs, result.sdkVersion));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
