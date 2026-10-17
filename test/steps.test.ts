import { describe, expect, it } from 'vitest';
import { pluginName, suppressedNames } from '../src/steps.js';

const plugins = [['expo-camera', { cameraPermission: 'x' }], 'expo-location', './plugins/local.ts', function withThing() {}];

describe('steps', () => {
  it('reads plugin names from every entry shape', () => {
    expect(plugins.map(pluginName)).toEqual(['expo-camera', 'expo-location', './plugins/local.ts', 'withThing']);
  });

  it('suppresses package plugins that are not active yet', () => {
    expect(suppressedNames(plugins, 0)).toEqual(['expo-camera', 'expo-location', 'withThing']);
    expect(suppressedNames(plugins, 1)).toEqual(['expo-location', 'withThing']);
    expect(suppressedNames(plugins, plugins.length)).toEqual([]);
  });
});
