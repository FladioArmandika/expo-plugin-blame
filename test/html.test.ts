import { describe, expect, it } from 'vitest';
import { blame, type Step } from '../src/blame.js';
import { renderHtml } from '../src/report/html.js';
import type { RunResult } from '../src/run.js';
import type { Snapshot } from '../src/snapshot.js';

const snap = (files: Record<string, string>): Snapshot =>
  new Map(Object.entries(files).map(([file, text]) => [file, { kind: 'text', text }]));

const steps: Step[] = [
  { index: 0, name: 'with-<script>', auto: false },
  { index: 1, name: 'expo-camera', auto: true },
];
const base = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
const result: RunResult = {
  ...blame(steps, [
    snap({ 'ios/Info.plist': base }),
    snap({ 'ios/Info.plist': base + 'key=a\n' }),
    snap({ 'ios/Info.plist': base + 'key=b\n' }),
  ]),
  projectRoot: '/x/my-app',
  sdkVersion: '58.0.0',
  platform: 'all',
  prebuilds: 3,
  durationMs: 1234,
};

describe('renderHtml', () => {
  const html = renderHtml(result);

  it('escapes names and file contents', () => {
    expect(html).toContain('with-&lt;script&gt;');
    expect(html).not.toContain('with-<script>');
  });

  it('shows the conflict and marks auto-applied plugins', () => {
    expect(html).toContain('⚠');
    expect(html).toMatch(/expo-camera<\/b> changed lines written by .*with-&lt;script&gt;/);
    expect(html).toContain('(auto)');
  });

  it('collapses long stretches of template lines', () => {
    expect(html).toMatch(/<summary>\d+ lines from Expo's template<\/summary>/);
  });
});
