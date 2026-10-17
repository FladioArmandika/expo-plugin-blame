import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, type RunResult } from '../src/run.js';

// Runs real prebuilds of test/fixtures/basic. Needs `npm install` in that folder
// and a build of this package (`npm run build`), so it is skipped otherwise.
const fixture = path.resolve(import.meta.dirname, 'fixtures/basic');
const ready =
  existsSync(path.join(fixture, 'node_modules/expo')) &&
  existsSync(path.resolve(import.meta.dirname, '../dist/runtime/app-config.cjs'));

// CI sets this so a broken fixture install fails the build instead of skipping silently.
if (!ready && process.env.PREBUILD_BLAME_REQUIRE_E2E) {
  throw new Error('End-to-end tests required but the fixture or build is missing');
}

const scratch = mkdtempSync(path.join(tmpdir(), 'prebuild-blame-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the fixture with its app.json edited and extra files added. */
function variant(name: string, edit: (expo: any) => void, files: Record<string, string> = {}): string {
  const dir = path.join(scratch, name);
  cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes('node_modules') });
  symlinkSync(path.join(fixture, 'node_modules'), path.join(dir, 'node_modules'));
  const appJson = JSON.parse(readFileSync(path.join(dir, 'app.json'), 'utf8'));
  edit(appJson.expo);
  writeFileSync(path.join(dir, 'app.json'), JSON.stringify(appJson, null, 2));
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return dir;
}

const summary = (result: RunResult) =>
  Object.fromEntries(
    result.steps.map((s) => [
      s.name + (s.auto ? ' (auto)' : ''),
      result.changes.filter((c) => c.step === s.index).map((c) => `${path.posix.basename(c.file)} +${c.added} -${c.removed}`),
    ]),
  );

describe.skipIf(!ready)('prebuild-blame on real prebuilds', { timeout: 180_000 }, () => {
  it('attributes every change in the basic fixture to the right plugin', async () => {
    const result = await run(fixture);
    expect(result.sdkVersion).toMatch(/^58\./);
    expect(summary(result)).toEqual({
      'expo-camera': ['AndroidManifest.xml +2 -0', 'Info.plist +4 -0'],
      'expo-location': ['AndroidManifest.xml +2 -0', 'Info.plist +13 -0'],
      'expo-build-properties': ['gradle.properties +1 -0', 'Podfile.properties.json +5 -1'],
      './plugins/withDangerousPodfile.ts': ['Podfile +2 -0'],
      './plugins/withXcodeResource.ts': ['project.pbxproj +4 -0', 'extra.json +1 -0'],
    });
    expect(result.overlaps.map((o) => [o.file, o.kind])).toEqual([
      ['android/app/src/main/AndroidManifest.xml', 'file'],
      ['ios/fixture/Info.plist', 'file'],
    ]);
  });

  it('gives installed but unlisted auto-applied plugins their own step', async () => {
    const dir = variant('auto', (expo) => {
      expo.plugins = expo.plugins.filter((p: unknown) => (Array.isArray(p) ? p[0] : p) !== 'expo-location');
    });
    const result = await run(dir, { platform: 'android' });
    expect(result.steps.at(-1)).toMatchObject({ name: 'expo-location', auto: true });
    expect(summary(result)['expo-location (auto)']).toEqual(['AndroidManifest.xml +2 -0']);
  });

  it('works with a TypeScript app.config and flags plugins that overwrite each other', async () => {
    const dir = variant('dynamic', (expo) => (expo.plugins = ['expo-camera']), {
      'app.config.ts': [
        "import type { ConfigContext, ExpoConfig } from 'expo/config';",
        "import { withInfoPlist } from 'expo/config-plugins';",
        '',
        'export default ({ config }: ConfigContext): ExpoConfig => ({',
        '  ...(config as ExpoConfig),',
        '  plugins: [',
        '    ...(config.plugins ?? []),',
        "    (c: ExpoConfig) => withInfoPlist(c, (m) => { m.modResults.NSCameraUsageDescription = 'Overwritten'; return m; }),",
        '  ],',
        '});',
      ].join('\n'),
    });
    const result = await run(dir, { platform: 'ios' });
    expect(result.steps.map((s) => s.name)).toEqual(['expo-camera', 'withAnonymous', 'expo-location']);
    expect(result.overlaps.find((o) => o.file === 'ios/fixture/Info.plist')).toMatchObject({ kind: 'lines' });
    expect(result.changes.find((c) => c.step === 1 && c.file === 'ios/fixture/Info.plist')).toMatchObject({ overwrote: [0] });
  });
});
