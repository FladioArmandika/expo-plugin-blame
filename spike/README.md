# Spike

Throwaway prototypes behind [docs/risk-checks.md](../docs/risk-checks.md), tested on Expo SDK 58.

- `normalize-pbxproj.js`: renames non-baseline UUIDs in `project.pbxproj` to content-derived ids. Usage: `node normalize-pbxproj.js <project.pbxproj> [baseline project.pbxproj]`.
- `app.config.js`: wrapper used in the temp copy. `PB_STEP=k` keeps the first k plugins and marks the rest as already run in `pluginHistory`, so Expo's auto-applied plugins stay out of the baseline.
- `fixture-app.json`, `withDangerousPodfile.js`, `withXcodeResource.js`: the fixture app config and its two local test plugins.
