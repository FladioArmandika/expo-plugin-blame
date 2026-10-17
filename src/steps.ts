/** Env var the generated app.config.js reads: how many user plugins to keep. */
export const STEP_ENV = 'EXPO_PLUGIN_BLAME_STEP';

/** Written into the temp copy for the runtime to read. */
export const WORKSPACE_FILE = 'expo-plugin-blame.json';

export interface WorkspaceInfo {
  /** The user's app.config.* after it was renamed, relative to the project root. */
  userConfig: string | null;
  /** Unlisted packages Expo would auto-apply, added as their own steps. */
  autoPlugins: string[];
}

/** A plugin entry's name: the package or path, or a function plugin's name. */
export function pluginName(entry: unknown): string | undefined {
  const plugin = Array.isArray(entry) ? entry[0] : entry;
  if (typeof plugin === 'string') return plugin;
  if (typeof plugin === 'function' && plugin.name) return plugin.name;
  return undefined;
}

/**
 * Names to mark as already run when only the first `keep` plugins are active.
 *
 * Expo auto-applies some plugins (expo-camera, expo-location, ...) whenever the
 * package is installed, unless a plugin with that name already ran. Marking the
 * excluded package plugins as run keeps them out of earlier steps, so their
 * changes are blamed on them and not baked into the baseline. Local paths are
 * never auto-applied, so they don't need suppressing.
 */
export function suppressedNames(plugins: readonly unknown[], keep: number): string[] {
  return plugins
    .slice(keep)
    .map(pluginName)
    .filter((name): name is string => !!name && !name.startsWith('.') && !name.startsWith('/'));
}
