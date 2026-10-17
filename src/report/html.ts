import { BASELINE, type FileBlame, type FileChange, type Step } from '../blame.js';
import type { RunResult } from '../run.js';
import { runStats } from './stats.js';

// Categorical hues that stay distinct on light and dark backgrounds.
const PALETTE = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6366f1', '#06b6d4'];

// Baseline runs longer than this collapse, keeping CONTEXT lines around plugin lines.
const COLLAPSE_AFTER = 8;
const CONTEXT = 3;

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fileId = (file: string) => 'f-' + file.replace(/[^A-Za-z0-9]+/g, '-');

const color = (step: number) => `var(--p${step % PALETTE.length})`;

const dot = (step: number) => `<i class="dot" style="--c:${color(step)}"></i>`;

export function renderHtml(result: RunResult): string {
  const name = (i: number) => result.steps[i]?.name ?? `step ${i + 1}`;
  const files = result.files.filter((f) => f.lines.some((l) => l.owner !== BASELINE));
  const sdk = result.sdkVersion ? `SDK ${result.sdkVersion.split('.')[0]}` : 'Expo';
  const project = result.projectRoot.split(/[\\/]/).pop() ?? result.projectRoot;

  const body = `
<header>
  <h1>expo-plugin-blame <span class="muted">${esc(project)}</span></h1>
  <p class="muted">${sdk} · ${result.steps.length} plugins · ${runStats(result.prebuilds, result.cached, result.durationMs)} · ${esc(result.platform)}</p>
  <nav class="legend" aria-label="Plugins">${result.steps.map((s) => legendChip(s, result.changes)).join('')}</nav>
  ${overlaps(result, name)}
</header>
<div class="tabs">
  <input type="radio" name="tab" id="tab-files" checked><label for="tab-files">By file</label>
  <input type="radio" name="tab" id="tab-plugins"><label for="tab-plugins">By plugin</label>
  <div class="panel" id="panel-files">
    <aside>${files.map((f) => fileLink(f)).join('') || '<p class="muted">No plugin changed any native file.</p>'}</aside>
    <main>${files.map((f) => fileBlame(f, name)).join('')}</main>
  </div>
  <div class="panel" id="panel-plugins">
    <main>${result.steps.map((s) => pluginDiffs(s, result.changes)).join('')}</main>
  </div>
</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>expo-plugin-blame · ${esc(project)}</title>
<style>${css()}</style>
</head>
<body>${body}
<script>${script()}</script>
</body>
</html>
`;
}

function legendChip(step: Step, changes: FileChange[]): string {
  const own = changes.filter((c) => c.step === step.index);
  const added = own.reduce((n, c) => n + c.added, 0);
  const removed = own.reduce((n, c) => n + c.removed, 0);
  const stats = own.length
    ? `<span class="add">+${added}</span>${removed ? ` <span class="del">-${removed}</span>` : ''}`
    : '<span class="muted">no changes</span>';
  return `<button class="chip" data-step="${step.index}" style="--c:${color(step.index)}" title="Highlight ${esc(step.name)}">${dot(step.index)}${esc(step.name)}${step.auto ? ' <span class="muted">(auto)</span>' : ''} <small>${stats}</small></button>`;
}

function overlaps(result: RunResult, name: (i: number) => string): string {
  if (!result.overlaps.length) return '';
  const items = result.overlaps.map((o) => {
    const link = `<a href="#${fileId(o.file)}">${esc(o.file)}</a>`;
    if (o.kind === 'file') return `<li class="note">${link} is touched by ${o.steps.map((s) => dot(s) + esc(name(s))).join(', ')}</li>`;
    return result.changes
      .filter((c) => c.file === o.file && c.overwrote.length)
      .map((c) => `<li class="warn">⚠ ${link}: ${dot(c.step)}<b>${esc(name(c.step))}</b> changed lines written by ${c.overwrote.map((s) => dot(s) + esc(name(s))).join(', ')}</li>`)
      .join('');
  });
  return `<ul class="overlaps">${items.join('')}</ul>`;
}

function fileLink(file: FileBlame): string {
  const owners = [...new Set(file.lines.map((l) => l.owner).filter((o) => o !== BASELINE))];
  return `<a class="file-link" href="#${fileId(file.file)}">${owners.map(dot).join('')}<span>${esc(file.file)}</span></a>`;
}

function fileBlame(file: FileBlame, name: (i: number) => string): string {
  if (file.binary) {
    const owner = file.lines[0]!.owner;
    return `<section id="${fileId(file.file)}"><h2>${esc(file.file)}</h2><p class="muted">Binary file, last written by ${dot(owner)}${esc(name(owner))}.</p></section>`;
  }

  // Lines near a plugin's line stay visible; long baseline stretches collapse.
  const keep = file.lines.map(() => false);
  file.lines.forEach((line, i) => {
    if (line.owner === BASELINE) return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(file.lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  });

  const rows: string[] = [];
  let hidden: string[] = [];
  const flush = () => {
    if (hidden.length > COLLAPSE_AFTER) rows.push(`<details><summary>${hidden.length} lines from Expo's template</summary>${hidden.join('')}</details>`);
    else rows.push(...hidden);
    hidden = [];
  };
  file.lines.forEach((line, i) => {
    const runStart = i === 0 || file.lines[i - 1]!.owner !== line.owner;
    const label = line.owner !== BASELINE && runStart ? esc(name(line.owner)) : '';
    const row =
      `<div class="l${line.owner === BASELINE ? ' base' : ''}" data-o="${line.owner}"${line.owner === BASELINE ? '' : ` style="--c:${color(line.owner)}"`}>` +
      `<span class="who">${label}</span><span class="n">${i + 1}</span><code>${esc(line.text) || ' '}</code></div>`;
    if (keep[i]) {
      flush();
      rows.push(row);
    } else {
      hidden.push(row);
    }
  });
  flush();

  return `<section id="${fileId(file.file)}"><h2>${esc(file.file)}</h2><div class="code">${rows.join('')}</div></section>`;
}

function pluginDiffs(step: Step, changes: FileChange[]): string {
  const own = changes.filter((c) => c.step === step.index);
  const parts = own.map((c) => {
    const stats = c.binary ? '<span class="muted">binary</span>' : `<span class="add">+${c.added}</span> <span class="del">-${c.removed}</span>`;
    const lines = c.patch
      .split('\n')
      .filter((l) => !/^(Index: |=+$|--- |\+\+\+ |\\ No newline)/.test(l))
      .map((l) => {
        const kind = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx';
        return `<div class="d ${kind}"><code>${esc(l) || ' '}</code></div>`;
      });
    return `<h3><a href="#${fileId(c.file)}">${esc(c.file)}</a> ${c.status !== 'modified' ? `<span class="muted">(${c.status === 'added' ? 'new' : 'deleted'})</span> ` : ''}${stats}</h3>${lines.length ? `<div class="code diff">${lines.join('')}</div>` : ''}`;
  });
  return `<section class="plugin" data-step="${step.index}" style="--c:${color(step.index)}"><h2>${dot(step.index)}${esc(step.name)}${step.auto ? ' <span class="muted">(auto-applied by Expo)</span>' : ''}</h2>${parts.join('') || '<p class="muted">No native changes.</p>'}</section>`;
}

function css(): string {
  const vars = PALETTE.map((c, i) => `--p${i}:${c};`).join('');
  return `
:root{${vars}--bg:#fbfbfa;--fg:#1d1d1f;--muted:#6b6b70;--line:#e6e6e3;--panel:#fff;--add:#15803d;--del:#b91c1c;--warn:#b45309;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--fg:#e8e8ea;--muted:#9a9aa1;--line:#2a2a2e;--panel:#18181b;--add:#4ade80;--del:#f87171;--warn:#fbbf24}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:24px 24px 8px;max-width:1400px;margin:0 auto}
h1{font-size:20px;margin:0}
h2{font-size:14px;margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600}
h3{font-size:13px;font-weight:500;margin:16px 0 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
a{color:inherit}
.muted{color:var(--muted);font-weight:400}
.add{color:var(--add)}.del{color:var(--del)}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:inherit;font:inherit;font-size:13px;cursor:pointer}
.chip:hover,.chip[aria-pressed=true]{border-color:var(--c);box-shadow:0 0 0 1px var(--c) inset}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--c);margin-right:4px;vertical-align:baseline}
.overlaps{list-style:none;padding:0;margin:0 0 8px;font-size:13px}
.overlaps li{padding:2px 0}.overlaps .warn{color:var(--warn)}.overlaps .note{color:var(--muted)}
.tabs{max-width:1400px;margin:0 auto;padding:0 24px 48px}
.tabs>input{position:absolute;opacity:0}
.tabs>label{display:inline-block;padding:8px 14px;margin-right:4px;border-bottom:2px solid transparent;cursor:pointer;color:var(--muted)}
.tabs>input:checked+label{color:var(--fg);border-color:var(--fg)}
.tabs>input:focus-visible+label{outline:2px solid var(--p0)}
.panel{display:none;border-top:1px solid var(--line);padding-top:16px}
#tab-files:checked~#panel-files{display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px}
#tab-plugins:checked~#panel-plugins{display:block}
aside{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:12.5px}
.file-link{display:flex;align-items:center;gap:2px;padding:4px 6px;border-radius:6px;text-decoration:none;word-break:break-all}
.file-link:hover{background:var(--panel)}.file-link span{margin-left:4px}
section{margin-bottom:28px;scroll-margin-top:16px}
.code{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow-x:auto;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.l{display:grid;grid-template-columns:150px 40px max-content;white-space:pre;border-left:3px solid var(--c,transparent);background:color-mix(in srgb,var(--c,transparent) 13%,transparent);transition:opacity .15s}
.l.base{color:var(--muted)}
.who{padding:0 8px;color:var(--c);font-family:ui-sans-serif,system-ui,sans-serif;font-size:11.5px;overflow:hidden;text-overflow:ellipsis}
.n{text-align:right;padding-right:12px;color:var(--muted);opacity:.6;user-select:none}
code{font:inherit;padding-right:16px}
details>summary{cursor:pointer;padding:2px 12px 2px 193px;color:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px;background:color-mix(in srgb,var(--line) 40%,transparent);list-style:none}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"⋯ "}
.plugin{border-left:3px solid var(--c);padding-left:16px}
.d{white-space:pre;padding:0 12px}
.d.add{background:color-mix(in srgb,var(--add) 13%,transparent);color:inherit}
.d.del{background:color-mix(in srgb,var(--del) 13%,transparent);color:inherit}
.d.hunk{color:var(--muted);background:color-mix(in srgb,var(--line) 40%,transparent)}
body[data-focus] .l:not(.base):not(.on),body[data-focus] .plugin:not(.on){opacity:.25}
@media (max-width:800px){#tab-files:checked~#panel-files{display:block}aside{position:static;max-height:none;margin-bottom:16px}.l{grid-template-columns:110px 36px max-content}details>summary{padding-left:12px}header,.tabs{padding-left:16px;padding-right:16px}}
`;
}

// Clicking a plugin chip highlights its lines and diffs; clicking again clears it.
function script(): string {
  return `
document.querySelectorAll('.chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    var step = chip.dataset.step;
    var off = document.body.dataset.focus === step;
    document.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(!off && c === chip)); });
    document.querySelectorAll('.on').forEach(function (el) { el.classList.remove('on'); });
    if (off) { delete document.body.dataset.focus; return; }
    document.body.dataset.focus = step;
    document.querySelectorAll('.l[data-o="' + step + '"], .plugin[data-step="' + step + '"]').forEach(function (el) { el.classList.add('on'); });
  });
});`;
}
