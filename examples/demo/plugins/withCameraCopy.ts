import { type ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

// Rewrites the camera permission text expo-camera added.
const withCameraCopy: ConfigPlugin = (config) =>
  withInfoPlist(config, (c) => {
    c.modResults.NSCameraUsageDescription = 'Scan QR codes to join a room';
    return c;
  });

export default withCameraCopy;
