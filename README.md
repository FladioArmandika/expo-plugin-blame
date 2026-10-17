# expo-plugin-blame

[![npm](https://img.shields.io/npm/v/expo-plugin-blame)](https://www.npmjs.com/package/expo-plugin-blame) [![CI](https://github.com/FladioArmandika/expo-plugin-blame/actions/workflows/ci.yml/badge.svg)](https://github.com/FladioArmandika/expo-plugin-blame/actions/workflows/ci.yml)

**`git blame` for `expo prebuild`. See which config plugin wrote which lines in your `android/` and `ios/` folders.**

![The HTML report: every line of the generated native files, coloured by the plugin that wrote it](https://raw.githubusercontent.com/FladioArmandika/expo-plugin-blame/main/docs/report.gif)

## Why

Something weird shows up in your `AndroidManifest.xml` or `project.pbxproj` after prebuild, and you have no idea which plugin put it there. Expo's debugging tools show you the config, not the native files. `git diff` tells you *what* changed, but not *who* did it.

## How it works

1. Copies your project to a temp folder, with `node_modules` symlinked instead of copied. Your real project is never touched.
2. Runs prebuild with none of your plugins, then again with one more plugin each time, in the order you declared them.
3. Diffs each run against the one before, so every change lands on the plugin that introduced it.
4. Normalizes `project.pbxproj` first, so random Xcode UUIDs don't show up as fake changes.
5. Flags files touched by more than one plugin, which is where plugins tend to step on each other.

**The sneaky part:** Expo quietly auto-applies some plugins, like `expo-camera` and `expo-location`, whenever the package is installed. That means a naive "no plugins" baseline still contains them. expo-plugin-blame keeps them out of the baseline so their changes are blamed on the right name. The details are in [docs/risk-checks.md](docs/risk-checks.md).

## What it looks like

This is the real output on [examples/demo](examples/demo), a fresh SDK 58 app with a few plugins:

```
$ npx expo-plugin-blame --html

expo-plugin-blame · SDK 58 · 7 plugins · 8 prebuilds in 4.2s
  expo-camera                        AndroidManifest.xml +2, Info.plist +4
  expo-location                      AndroidManifest.xml +2, Info.plist +13
  expo-build-properties              gradle.properties +1, Podfile.properties.json +5 -1
  ./plugins/withCameraCopy.ts        Info.plist +1 -1
  ./plugins/withMinSdk24.ts          no native changes
  ./plugins/withDangerousPodfile.ts  Podfile +2
  ./plugins/withXcodeResource.ts     project.pbxproj +4, extra.json +1 (new)
  ⚠ Info.plist: ./plugins/withCameraCopy.ts changed lines written by expo-camera
  · AndroidManifest.xml touched by expo-camera, expo-location
Report: expo-plugin-blame.html
```

The HTML report (the GIF above) is a single file you can open anywhere. **By file** shows every generated file with each line coloured by the plugin that wrote it. **By plugin** shows each plugin's diff. Click a plugin to highlight its lines.

### Reading the output

- **⚠ changed lines written by…** means a plugin rewrote lines another plugin wrote. Here, `withCameraCopy` replaced expo-camera's permission text. That's on purpose here, but it's exactly how plugins break each other by accident.
- **· touched by…** means several plugins edit the same file, on different lines. Usually fine, and worth knowing about.
- **no native changes** on a plugin that should change something means its edit got lost. `withMinSdk24` sets `minSdkVersion` to 24, but when two plugins edit the same file through the same kind of mod, Expo runs the later plugin's edit *first*. So expo-build-properties, declared earlier, wins and writes 26. Plain `git diff` would never show you that.
- **(auto)** marks packages Expo applies on its own because they're installed, even though they aren't in your `plugins` list.

## Usage

Run it in your Expo project, with dependencies installed:

```sh
npx expo-plugin-blame          # summary in the terminal
npx expo-plugin-blame --html   # plus the colour-coded report
```

Nothing to set up, and your `android/` and `ios/` folders are never touched. (It was called `prebuild-blame` up to 0.1.0.)

| Flag | What it does |
| --- | --- |
| `--base <git-ref>` | Compare the native output with a branch, tag or commit. See below. |
| `--html [file]` | Write the HTML report (default `expo-plugin-blame.html`) |
| `--platform ios\|android\|all` | Only prebuild one platform (default `all`) |
| `--only a,b` | Only report these plugins. Earlier plugins still run. |
| `--json <file>` | Write the full result, including per-line blame and patches. Use `-` for stdout. |
| `--markdown <file>` | Write a Markdown summary, sized for a PR comment. Use `-` for stdout. |
| `--concurrency <n>` | Prebuilds to run at once (default: CPU count) |
| `--no-cache` | Run every prebuild, even ones cached from an earlier run |
| `--keep-temp` | Keep the temp copies so you can poke around |

Works with `app.json` and with `app.config.ts`/`.js`, including inline function plugins. Requires Node 22.13+ (the same as Expo SDK 58) and your project's dependencies installed. It's tested on SDK 58 so far.

### Caching

Each prebuild's output is cached in `node_modules/.cache/expo-plugin-blame`, so a second run with nothing changed takes about half a second. Editing one plugin only re-runs the steps from that plugin onwards: tweak your last local plugin and it's one prebuild instead of eight. With `--base`, the base side is usually all cached too.

The key covers your project files, the installed dependencies, the plugin options and this tool's own version. Anything else that changes the output gets missed, like a plugin reading an environment variable, or a local plugin importing another plugin file. Use `--no-cache` when you suspect it. Entries unused for two weeks are cleaned up.

### Comparing with a branch: `--base`

`--base main` answers "what does this branch do to the native folders, and which plugin is responsible?" It checks `main` out into a temporary git worktree, blames both versions, and diffs the final output:

```
$ npx expo-plugin-blame --base main

expo-plugin-blame · main (e3c1fda) → working tree · SDK 58 · 15 prebuilds in 6.8s
  expo-camera                                  AndroidManifest.xml -1
  expo-build-properties                        Podfile.properties.json +1 -1, project.pbxproj +2 -2
  expo-location (auto)                         Info.plist +1 -1
  ./plugins/withDangerousPodfile.ts (removed)  Podfile -2
  · project.pbxproj is now touched by expo-build-properties, ./plugins/withXcodeResource.ts
  5 generated files changed
```

Here the branch turned off `recordAudioAndroid`, bumped the iOS deployment target, dropped a plugin, and removed `expo-location` from `plugins`. That last one is a nice catch: Expo still applies it because the package is installed, but your custom permission text is gone.

- Changed plugin options and changed plugin versions both show up under the plugin's name. **(new)** and **(removed)** mark plugins only one side has. **Expo defaults** is the template itself, which mostly changes on SDK upgrades.
- Only overlaps that are new on your branch are flagged.
- If `package.json` and the lockfile are unchanged, the base reuses your `node_modules`. Otherwise it installs the base's dependencies with your package manager (lifecycle scripts skipped), which takes longer.
- In CI, the base ref has to be fetched. With `actions/checkout`, set `fetch-depth: 0`.
- `--markdown pr.md` writes the same summary with collapsible diffs, ready to post as a PR comment.

### On pull requests: the GitHub Action

Add this workflow and every PR gets a comment showing what it does to `android/` and `ios/`, and which plugin did it. The comment is updated on each push, and nothing is posted while a PR has no native changes.

```yaml
# .github/workflows/expo-plugin-blame.yml
name: expo-plugin-blame
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  expo-plugin-blame:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: FladioArmandika/expo-plugin-blame@main
```

It runs on Linux, since prebuild only generates files and nothing gets compiled. The report also lands in the job summary, which is where you'll find it for PRs from forks, because GitHub doesn't let those post comments.

| Input | Default | What it does |
| --- | --- | --- |
| `working-directory` | `.` | The Expo project folder, for monorepos |
| `base` | the PR's base branch | Any branch, tag or commit to compare with |
| `platform` | `all` | `ios`, `android` or `all` |
| `comment` | `true` | Set to `false` to only write the job summary |

Outputs: `changed` (`true` or `false`), `markdown-file` and `json-file`. Use them to fail the job or post somewhere else.

## Status

- [x] Stable `project.pbxproj` normalization
- [x] Per-plugin steps that keep Expo's auto-applied plugins out of the baseline
- [x] CLI: temp workspace, parallel prebuilds, line-level blame, terminal summary, JSON output
- [x] Overlap and conflict flags
- [x] Colour-coded HTML report
- [x] Cache each step's prebuild between runs
- [x] `--base <git-ref>` to compare native output with another commit, plus `--markdown`
- [x] GitHub Action that posts the summary on PRs

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
  cli.ts                 flags and output
  run.ts                 ties it together
  expo.ts                reads the project with its own Expo install
  workspace.ts           temp copies of the project
  prebuild.ts            runs expo prebuild, in parallel
  snapshot.ts            reads android/ and ios/, normalizes pbxproj
  blame.ts               line-level attribution and overlaps
  base.ts                checks out --base into a git worktree
  cache.ts               per-step cache keys and storage
  compare.ts             what changed since --base, and whose it is
  report/terminal.ts     the terminal summary
  report/html.ts         the HTML report
  report/markdown.ts     Markdown summaries for PR comments
  normalize/pbxproj.ts   stable Xcode object ids
  steps.ts               which plugins run at each step
  runtime/app-config.ts  loaded by Expo inside each temp copy
test/
  fixtures/basic/        small Expo app with real and local plugins
examples/demo/           the app behind the output and GIF above
scripts/record-gif.cjs   re-records docs/report.gif
action.yml               the GitHub Action
```

To try your local build on a project, run `node dist/cli.js path/to/expo-app`. The end-to-end tests run real `expo prebuild`s on `test/fixtures/basic`. Run `npm install` in that folder first, or they're skipped. To try the demo, run `npm install` in `examples/demo`, then `node dist/cli.js examples/demo --html`.

## License

[MIT](LICENSE)
