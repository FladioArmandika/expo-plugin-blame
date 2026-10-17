// Runs inside Expo's config loader in the temp copy of the project, via a
// generated app.config.js that re-exports this module. Built as CommonJS.
import { STEP_ENV, suppressedNames } from '../steps.js';

type ExpoConfig = {
  plugins?: unknown[];
  _internal?: { pluginHistory?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
};

function appConfig({ config }: { config: ExpoConfig }): ExpoConfig {
  const plugins = config.plugins ?? [];
  const raw = process.env[STEP_ENV];
  const keep = raw === undefined ? plugins.length : Number(raw);
  const suppressed = suppressedNames(plugins, keep);

  const seedHistory = (c: ExpoConfig): ExpoConfig => {
    c._internal ??= {};
    c._internal.pluginHistory ??= {};
    for (const name of suppressed) {
      c._internal.pluginHistory[name] ??= { name, version: 'suppressed-by-prebuild-blame' };
    }
    return c;
  };

  return { ...config, plugins: [seedHistory, ...plugins.slice(0, keep)] };
}

module.exports = appConfig;
