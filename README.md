# prebuild-blame

**`git blame` for `expo prebuild`. See which config plugin wrote which lines in your `android/` and `ios/` folders.**

> 🚧 **Work in progress.** The core approach works and is tested against real prebuilds. The CLI itself is being built now, and nothing is on npm yet.

## Why

Something weird shows up in your `AndroidManifest.xml` or `project.pbxproj` after prebuild, and you have no idea which plugin put it there. Expo's debugging tools show you the config, not the native files. `git diff` tells you *what* changed, but not *who* did it.

## How it works

1. Copies your project to a temp folder, with `node_modules` symlinked instead of copied. Your real project is never touched.
2. Runs prebuild with none of your plugins, then again with one more plugin each time, in the order you declared them.
3. Diffs each run against the one before, so every change lands on the plugin that introduced it.
4. Normalizes `project.pbxproj` first, so random Xcode UUIDs don't show up as fake changes.
5. Flags files touched by more than one plugin, which is where plugins tend to step on each other.

**The sneaky part:** Expo quietly auto-applies some plugins, like `expo-camera` and `expo-location`, whenever the package is installed. That means a naive "no plugins" baseline still contains them. prebuild-blame keeps them out of the baseline so their changes are blamed on the right name. The details are in [docs/risk-checks.md](docs/risk-checks.md).

## What it'll look like

```
$ npx prebuild-blame

prebuild-blame · SDK 58 · 5 plugins · 6 prebuilds
  expo-camera              Info.plist +4, AndroidManifest.xml +2
  expo-location            Info.plist +13, AndroidManifest.xml +2
  expo-build-properties    Podfile.properties.json +5 -1, gradle.properties +2 -1
  ./withDangerousPodfile   Podfile +1
  ./withXcodeResource      project.pbxproj +4, extra.json +1
  ⚠ Info.plist touched by expo-camera, expo-location
Report: prebuild-blame.html
```

These numbers are real attribution from the test fixture on a fresh SDK 58 app, shown in the planned output format. The HTML report will show the full diff, colour-coded per plugin.

## Usage

Once it's published:

```sh
npx prebuild-blame            # run in your Expo project
npx prebuild-blame --html     # also write the HTML report
```

Planned flags: `--platform ios|android`, `--only <plugin>`, `--json`, `--concurrency <n>`, `--no-cache`, `--keep-temp`.

Requires Node 20+ and an Expo project that uses prebuild. It's tested on SDK 58 so far.

## Status

- [x] Stable `project.pbxproj` normalization
- [x] Per-plugin steps that keep Expo's auto-applied plugins out of the baseline
- [ ] CLI: temp workspace, parallel prebuilds, diffing, terminal summary
- [ ] Colour-coded HTML report
- [ ] `--base <git-ref>` to compare native output between two commits
- [ ] GitHub Action that posts the summary on PRs

## Not in scope

It doesn't fix anything, run native builds, or support bare React Native without Expo prebuild. It just tells you who did what.

## Development

Written in TypeScript, built with tsup, and tested with Vitest.

```sh
npm install
npm run build && npm test
npm run typecheck
```

```
src/
  normalize/pbxproj.ts   stable Xcode object ids
  steps.ts               which plugins run at each step
  runtime/app-config.ts  loaded by Expo inside the temp copy
test/
  fixtures/basic/        small Expo app with real and local plugins
```

The end-to-end tests run real `expo prebuild`s on `test/fixtures/basic`. Run `npm install` in that folder first, or they're skipped.
