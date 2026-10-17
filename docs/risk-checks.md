# prebuild-blame: risk checks and proposal

Tested on 2026-10-17 against a fresh `create-expo-app` (blank-typescript): **Expo SDK 58.0.14, React Native 0.88.0**.
Fixture plugins: `expo-camera`, `expo-location`, `expo-build-properties`, a local dangerous mod that edits the Podfile, and a local `withXcodeProject` plugin that adds a resource file to the Xcode project.
The prototypes now live in TypeScript: [src/normalize/pbxproj.ts](../src/normalize/pbxproj.ts), [src/runtime/app-config.ts](../src/runtime/app-config.ts), and the fixture in [test/fixtures/basic](../test/fixtures/basic).

## 1. Competition: nothing does this yet

- **npm:** searches for "expo prebuild diff", "config plugin blame", "prebuild snapshot", "expo config plugin debug" and "expo prebuild report" found only Expo's own packages and unrelated tools.
- **Expo Tools for VS Code:** the latest release is 1.6.3 (2026-05-21, Apple icon asset fix). No 2025–2026 release adds native diffing or plugin attribution.
- **Closest neighbours:**
  - Expo's [patch-project](https://docs.expo.dev/config-plugins/patch-project/) saves your manual native edits as patches. It doesn't attribute anything to plugins.
  - A [Rork article](https://rorklab.net/en/articles/rork-dev/rork-expo-sdk-57-prebuild-clean-native-changes-audit) diffs `ios/` and `android/` before and after prebuild to find hand edits. It explicitly doesn't map lines to plugins.
- **Gap:** GitHub search was blocked from this sandbox, so GitHub was covered only by web search (site:github.com). That found nothing relevant. A quick manual search on github.com before publishing is worth doing.

## 2. Determinism: fine once `project.pbxproj` is normalized

- **Without Xcode-object plugins:** two prebuilds of the same project are byte-identical. That holds for all of `android/`, all of `ios/`, and even the `.pbxproj`.
- **With Xcode-object plugins:** once a plugin adds Xcode objects (`addResourceFileToGroup`), every run gets new random UUIDs on 6 lines. Nothing else differs.
- **Fix:** the [normalizer](../src/normalize/pbxproj.ts) keeps UUIDs that already exist in the baseline (the template's ids are stable). It renames only new ones, to a hash of the object's content (iterated so references resolve, with an ordinal for exact duplicates).
- **Result:** 7 runs were identical after normalization. A plugin's diff reads cleanly, e.g. `+4 lines: extra.json PBXBuildFile, PBXFileReference, group child, Resources entry`.
- **Sorting:** sorting keys turned out to be unnecessary. Section order is deterministic for a given plugin order, so I'd skip it and keep the output close to what Xcode writes.
- **Implementation:** it works on the raw text with a regex over `objects`, so nothing gets re-serialized. The `xcode` parser is only needed if the regex hits edge cases.

## 3. Baseline: cumulative subsets work, with one fix

**Problem confirmed:** with `plugins: []`, the baseline still contained camera and location permissions. `@expo/prebuild-config` auto-applies "legacy" plugins for installed packages (`expo-camera`, `expo-location`, `expo-av`, `expo-image-picker`, … 18 in SDK 58) plus 8 "versioned" ones. A naive baseline would blame those lines on nobody, and the `expo-camera` step would show only the changed permission text.

**Fix:** the legacy auto-plugins are wrapped in `createRunOncePlugin`, which skips a plugin already recorded in `_internal.pluginHistory`. The temp copy gets a wrapper `app.config.js` that keeps the first *k* user plugins. It then seeds `pluginHistory` with the names of the excluded ones so Expo doesn't add them back. Result per step on the fixture:

```
expo-camera            Info.plist +4, AndroidManifest.xml +2
expo-location          Info.plist +13, AndroidManifest.xml +2
expo-build-properties  Podfile.properties.json +5 -1, gradle.properties +2 -1
withDangerousPodfile   Podfile +1
withXcodeResource      project.pbxproj +4, extra.json +1
```

Each line landed on the right plugin, including the dangerous mod and the `.pbxproj` change.

**Recommendation: cumulative subsets.**
- It runs the real `expo prebuild`, so dangerous-mod phase ordering is handled for free.
- It depends on two fairly stable things: `createRunOncePlugin` (public API in `@expo/config-plugins`) and the `pluginHistory` key.
- Mod-wrapping would need to hook `withMod` chains and re-serialize each mod's in-memory results (plist, XML, XcodeProject), plus snapshot the disk around dangerous mods. That is much more SDK-coupled for a precision gain v1 doesn't need. I'd only add it later as an opt-in `--trace-mods` if order bugs become the main use case.

**Known limits to document:**
- Blame is the *net* effect of adding a plugin on top of the earlier ones. If plugin B rewrites A's line, the line is B's, and the overlap flag catches it.
- Auto-applied plugins for installed-but-unlisted packages should become their own implicit steps ("expo-av (auto)") rather than being hidden in the baseline.

## 4. Speed

- **Measured:** one `expo prebuild --no-install --clean` takes about 2 s on the fixture (4 cores).
- **Plan:** each step runs in its own temp copy with symlinked `node_modules`, so steps can run in parallel (`--concurrency`, default = cores). The baseline is cached by a hash of the inputs (package.json, lockfile, app config, plugin files).
- **Note:** prebuild also edits `package.json` scripts in the copy. That's harmless because it happens in every step, but those changes are excluded from the report.

## Proposed repo structure

```
prebuild-blame/
  src/
    cli.ts            # citty entry
    workspace.ts      # temp copy, node_modules symlink, wrapper app.config.js
    steps.ts          # plugin list → steps (incl. implicit auto-plugins), history seeding
    prebuild.ts       # runs `expo prebuild --no-install --clean`, parallel pool, baseline cache
    normalize/
      pbxproj.ts      # UUID stabilization
    diff.ts           # jsdiff per file, step-to-step → attributed hunks
    overlap.ts        # files/hunks touched by >1 step
    report/
      terminal.ts     # summary table
      html.ts         # diff2html, one colour per plugin, single static file
  test/
    fixtures/         # 2–3 tiny Expo apps (no node_modules; installed in CI)
    *.test.ts         # Vitest: normalizer unit tests, end-to-end snapshot of attribution
  action/action.yml   # weekend 2: composite action
  README.md
```

Stack as you suggested, with one change: **citty** instead of commander (smaller, typed args) and **tsup** for the build. The `xcode` dependency is dropped unless needed.

## Proposed CLI

```
npx prebuild-blame [project-dir]          # default: cwd
  --platform ios|android|all              # default all
  --html [file]                           # write report (default prebuild-blame.html)
  --json [file]                           # machine-readable result (used by the Action)
  --only <plugin,...>                     # still runs earlier plugins, reports just these
  --concurrency <n>                       # default: CPU count
  --no-cache                              # ignore cached baseline
  --keep-temp                             # leave temp dirs for inspection
  --base <git-ref>                        # weekend 2
```

Terminal output:

```
prebuild-blame · SDK 58 · 5 plugins · 6 prebuilds in 4.1s
  expo-camera            +4 Info.plist  +2 AndroidManifest.xml
  expo-location          +13 Info.plist +2 AndroidManifest.xml
  ⚠ Info.plist touched by expo-camera, expo-location (different keys)
Report: prebuild-blame.html
```
