import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openCache, stepKeys } from '../src/cache.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'expo-plugin-blame-cache-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** A tiny project: app.json with the given plugins, and these files. */
function project(plugins: unknown[], files: Record<string, string> = {}) {
  const dir = path.join(scratch, `p${n++}`);
  mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{}');
  writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ expo: { name: 'app', plugins } }));
  writeFileSync(path.join(dir, 'plugins/a.js'), 'module.exports = (c) => c;');
  writeFileSync(path.join(dir, 'plugins/b.js'), 'module.exports = (c) => c;');
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return stepKeys({ projectRoot: dir, templateDir: dir, staticConfig: 'app.json', plugins, platform: 'all' });
}

describe('stepKeys', () => {
  const plugins = ['expo-camera', './plugins/a', './plugins/b'];

  it('gives one key per step and is stable', () => {
    const keys = project(plugins);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(project(plugins)).toEqual(keys);
  });

  it('only changes the steps that include an edited local plugin', () => {
    const keys = project(plugins);
    const edited = project(plugins, { 'plugins/b.js': 'module.exports = (c) => ({ ...c });' });
    expect(edited.slice(0, 3)).toEqual(keys.slice(0, 3));
    expect(edited[3]).not.toBe(keys[3]);
  });

  it('only changes later steps when a plugin option changes', () => {
    const keys = project(plugins);
    const edited = project(['expo-camera', ['./plugins/a', { x: 1 }], './plugins/b']);
    expect(edited.slice(0, 2)).toEqual(keys.slice(0, 2));
    expect(edited[2]).not.toBe(keys[2]);
    expect(edited[3]).not.toBe(keys[3]);
  });

  it('changes every step when other project files or config change', () => {
    const keys = project(plugins);
    expect(project(plugins, { 'icon.png': 'new icon' })[0]).not.toBe(keys[0]);
    expect(project(plugins, { 'plugins/helper.js': '' })[0]).not.toBe(keys[0]);
    expect(project(plugins, { 'package-lock.json': '{}' })[0]).not.toBe(keys[0]);
    expect(project(['expo-location', ...plugins.slice(1)])[0]).not.toBe(keys[0]);
  });
});

describe('openCache', () => {
  it('round-trips snapshots', () => {
    const cache = openCache(path.join(scratch, 'cache'));
    const snapshot = new Map([
      ['ios/Podfile', { kind: 'text' as const, text: 'pod\n' }],
      ['ios/icon.png', { kind: 'binary' as const, hash: 'abc' }],
    ]);
    expect(cache.get('a'.repeat(64))).toBeUndefined();
    cache.set('a'.repeat(64), snapshot);
    expect(cache.get('a'.repeat(64))).toEqual(snapshot);
  });
});
