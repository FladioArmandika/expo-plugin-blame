// Runs inside Expo's config loader in the temp copy of the project, via a
// generated app.config.js that re-exports this module. Built as CommonJS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { STEP_ENV, WORKSPACE_FILE, suppressedNames, type WorkspaceInfo } from '../steps.js';

type ExpoConfig = {
  plugins?: unknown[];
  _internal?: { pluginHistory?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
};

type ConfigContext = { config: ExpoConfig; projectRoot: string; [key: string]: unknown };

function appConfig(context: ConfigContext): ExpoConfig {
  const info: WorkspaceInfo = JSON.parse(readFileSync(path.join(context.projectRoot, WORKSPACE_FILE), 'utf8'));
  const config = info.userConfig ? evalUserConfig(context, info.userConfig) : context.config;

  // Auto-applied packages go last, which is also where Expo would apply them.
  const plugins = [...(config.plugins ?? []), ...info.autoPlugins];
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

// The user's own app.config.* was renamed out of the way; evaluate it with
// Expo's loader so TypeScript configs work exactly as they do in prebuild.
function evalUserConfig(context: ConfigContext, file: string): ExpoConfig {
  const projectRequire = createRequire(path.join(context.projectRoot, 'package.json'));
  const expoRequire = createRequire(projectRequire.resolve('expo/package.json'));
  // Not in the package's exports map, so load it by file path.
  const configDir = path.dirname(expoRequire.resolve('@expo/config/package.json'));
  const { evalConfig } = expoRequire(path.join(configDir, 'build/evalConfig.js')) as {
    evalConfig(file: string, request: ConfigContext): { config: ExpoConfig };
  };
  return evalConfig(path.join(context.projectRoot, file), context).config;
}

// Expo's config loader unwraps `default`, so the CommonJS build can stay plain.
export default appConfig;
