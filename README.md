# prebuild-blame

**`git blame` for `expo prebuild`: see which config plugin wrote which lines in your `android/` and `ios/` folders.**

> 🚧 Work in progress. The core idea is proven (see [the spike notes](docs/risk-checks.md)) and the CLI is being built now. Nothing is on npm yet.

## Why

Something weird shows up in your `AndroidManifest.xml` or `project.pbxproj` after prebuild, and you have no idea which plugin put it there. Expo's debugging tools show you the config, not the native files, and `git diff` tells you *what* changed but not *who* did it.

## How it works

1. Copies your project to a temp folder (`node_modules` is symlinked, not copied).
2. Runs prebuild with none of your plugins, then again with one more plugin each time, in the order you declared them.
3. Diffs each run against the previous one, so every change is pinned on the plugin that introduced it.
4. Normalizes `project.pbxproj` first, so random Xcode UUIDs don't show up as fake changes.
5. Flags files touched by more than one plugin, which is where plugins tend to step on each other.

Your actual project is never modified.

One gotcha it handles: Expo quietly auto-applies some plugins (like `expo-camera` and `expo-location`) whenever the package is installed. A naive "no plugins" baseline would still include them. prebuild-blame keeps them out so their changes land on the right name.

## What it'll look like

```
$ npx prebuild-blame

prebuild-blame · SDK 58 · 5 plugins · 6 prebuilds in 4.1s
  expo-camera            +4 Info.plist   +2 AndroidManifest.xml
  expo-location          +13 Info.plist  +2 AndroidManifest.xml
  expo-build-properties  Podfile.properties.json +5 -1, gradle.properties +2 -1
  ./plugins/withPodfile  +1 Podfile
  ./plugins/withXcode    +4 project.pbxproj, +1 extra.json
  ⚠ Info.plist touched by expo-camera, expo-location
Report: prebuild-blame.html
```

That output is real attribution from the prototype on a fresh SDK 58 app, dressed up in the planned format. The HTML report shows the full diff, colour-coded per plugin.

## Install

Once it's published:

```sh
npx prebuild-blame            # in your Expo project
npx prebuild-blame --html     # also write the HTML report
```

Planned flags: `--platform ios|android`, `--only <plugin>`, `--json`, `--concurrency <n>`, `--no-cache`, `--keep-temp`. Later: `--base <git-ref>` to compare two commits, plus a GitHub Action that posts the summary on PRs.

## Not in scope

It doesn't fix anything, run native builds, or support bare React Native without Expo prebuild. It just tells you who did what.

## Development

```sh
npm install
npm run build && npm test     # unit tests, plus real prebuilds if the fixture is installed
npm run typecheck
```

The end-to-end test runs `expo prebuild` on [test/fixtures/basic](test/fixtures/basic). Run `npm install` in that folder first, or it's skipped.
