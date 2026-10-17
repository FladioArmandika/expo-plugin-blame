import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePbxproj, parseObjects } from '../src/normalize/pbxproj.js';

// Real SDK 58 output: run-a and run-b are two prebuilds of the same project with
// a plugin that adds a resource file; baseline is the same app with no plugins.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/pbxproj/${name}`, import.meta.url), 'utf8');
const baseline = fixture('baseline.pbxproj');
const runA = fixture('run-a.pbxproj');
const runB = fixture('run-b.pbxproj');
const stable = new Set(parseObjects(baseline).keys());

describe('normalizePbxproj', () => {
  it('parses every object in the file', () => {
    expect(parseObjects(runA).size).toBe(runA.match(/isa = /g)!.length);
  });

  it('makes two runs of the same project identical', () => {
    expect(runA).not.toBe(runB);
    expect(normalizePbxproj(runA, stable)).toBe(normalizePbxproj(runB, stable));
  });

  it('keeps baseline ids and only rewrites new ones', () => {
    expect(normalizePbxproj(baseline, stable)).toBe(baseline);
    const normalized = normalizePbxproj(runA, stable);
    const changed = runA.split('\n').filter((line, i) => line !== normalized.split('\n')[i]);
    expect(changed).toHaveLength(4);
    expect(changed.every((line) => line.includes('extra.json'))).toBe(true);
  });

  it('gives identical objects distinct ids', () => {
    const text = [
      '\t\tAAAAAAAAAAAAAAAAAAAAAAAA /* a */ = {isa = PBXBuildFile; fileRef = CCCCCCCCCCCCCCCCCCCCCCCC; };',
      '\t\tBBBBBBBBBBBBBBBBBBBBBBBB /* a */ = {isa = PBXBuildFile; fileRef = CCCCCCCCCCCCCCCCCCCCCCCC; };',
    ].join('\n');
    const ids = [...parseObjects(normalizePbxproj(text)).keys()];
    expect(new Set(ids).size).toBe(2);
  });
});
