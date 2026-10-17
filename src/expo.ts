import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pluginName } from './steps.js';

export interface ExpoProject {
  root: string;
  sdkVersion: string | undefined;
  /** Plugins from the app config, in declared order. */
  plugins: string[];
  /** The same plugins as written in the config, with their options. */
  pluginEntries: unknown[];
  /** Installed packages Expo applies on its own even though they aren't listed. */
  autoPlugins: string[];
  /** The project's own app.config.{ts,js,...}, if it has one. */
  dynamicConfigPath: string | undefined;
  expoCli: string;
}

// The slice of `expo/config` used here; it's loaded from the project, not bundled.
type GetConfig = (
  root: string,
  options: { skipSDKVersionRequirement: boolean; isPublicConfig: boolean },
) => { exp: { sdkVersion?: string; plugins?: unknown[] }; dynamicConfigPath: string | null };

/** Reads what prebuild-blame needs using the project's own Expo install. */
export function loadExpoProject(root: string): ExpoProject {
  const projectRequire = createRequire(path.join(root, 'package.json'));
  let expoPkg: string;
  try {
    expoPkg = projectRequire.resolve('expo/package.json');
  } catch {
    throw new Error(`Couldn't find the expo package in ${root}. Run this in an Expo project after installing dependencies.`);
  }
  const expoRequire = createRequire(expoPkg);
  const { getConfig } = projectRequire('expo/config') as { getConfig: GetConfig };
  const { exp, dynamicConfigPath } = getConfig(root, { skipSDKVersionRequirement: true, isPublicConfig: false });

  const plugins = (exp.plugins ?? []).map((entry, i) => pluginName(entry) ?? `plugin #${i + 1}`);
  const { getAutoPlugins } = expoRequire('@expo/prebuild-config') as { getAutoPlugins(): string[] };
  const autoPlugins = getAutoPlugins().filter(
    (name) => !plugins.includes(name) && hasConfigPlugin(projectRequire, name),
  );

  return {
    root,
    sdkVersion: exp.sdkVersion,
    plugins,
    pluginEntries: exp.plugins ?? [],
    autoPlugins,
    dynamicConfigPath: dynamicConfigPath ?? undefined,
    expoCli: path.join(path.dirname(expoPkg), 'bin/cli'),
  };
}

// Auto-applied packages only count if they're installed and ship a plugin;
// otherwise Expo falls back to a built-in default that belongs in the baseline.
function hasConfigPlugin(projectRequire: NodeJS.Require, name: string): boolean {
  try {
    const pkg = projectRequire.resolve(`${name}/package.json`);
    return existsSync(path.join(path.dirname(pkg), 'app.plugin.js'));
  } catch {
    return false;
  }
}
