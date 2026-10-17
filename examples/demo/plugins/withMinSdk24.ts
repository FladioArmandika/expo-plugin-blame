import { type ConfigPlugin, withGradleProperties } from 'expo/config-plugins';

// Pins minSdkVersion to 24, clashing with expo-build-properties.
const withMinSdk24: ConfigPlugin = (config) =>
  withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((item) => !(item.type === 'property' && item.key === 'android.minSdkVersion'));
    c.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '24' });
    return c;
  });

export default withMinSdk24;
