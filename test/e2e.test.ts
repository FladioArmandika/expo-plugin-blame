import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_ENV } from '../src/steps.js';
import { wrapperConfigSource } from '../src/workspace.js';

// Runs real prebuilds of test/fixtures/basic. Needs `npm install` in that folder
// and a build of this package (`npm run build`), so it is skipped otherwise.
const fixture = path.resolve(import.meta.dirname, 'fixtures/basic');
const runtime = path.resolve(import.meta.dirname, '../dist/runtime/app-config.cjs');
const ready = existsSync(path.join(fixture, 'node_modules/expo')) && existsSync(runtime);

describe.skipIf(!ready)('prebuild steps on the basic fixture', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'prebuild-blame-'));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const prebuild = (step: number): string => {
    const dir = path.join(work, `step-${step}`);
    cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes('node_modules') });
    symlinkSync(path.join(fixture, 'node_modules'), path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'app.config.js'), wrapperConfigSource(runtime));
    execFileSync('npx', ['expo', 'prebuild', '--no-install', '--clean'], {
      cwd: dir,
      env: { ...process.env, [STEP_ENV]: String(step), CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1' },
      stdio: 'pipe',
    });
    return dir;
  };
  const read = (dir: string, file: string) => readFileSync(path.join(dir, file), 'utf8');

  it('keeps auto-applied plugins out of the baseline and adds them at their own step', { timeout: 120_000 }, () => {
    const base = prebuild(0);
    const camera = prebuild(1);
    const manifest = 'android/app/src/main/AndroidManifest.xml';
    const plist = 'ios/fixture/Info.plist';

    expect(read(base, manifest)).not.toContain('android.permission.CAMERA');
    expect(read(base, plist)).not.toContain('NSCameraUsageDescription');
    expect(read(camera, manifest)).toContain('android.permission.CAMERA');
    expect(read(camera, plist)).toContain('Camera please');
    expect(read(camera, plist)).not.toContain('NSLocation');
  });

  it('runs the TypeScript local plugins, including dangerous and Xcode mods', { timeout: 120_000 }, () => {
    const all = prebuild(5);
    expect(read(all, 'ios/Podfile')).toContain('# added by withDangerousPodfile');
    expect(read(all, 'ios/fixture.xcodeproj/project.pbxproj')).toContain('extra.json in Resources');
  });
});
