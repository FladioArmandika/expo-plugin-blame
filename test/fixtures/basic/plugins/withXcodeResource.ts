import { type ConfigPlugin, IOSConfig, withXcodeProject } from 'expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';

// Adds a resource file to the Xcode project, which creates objects with random UUIDs.
const withXcodeResource: ConfigPlugin = (config) =>
  withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName!;
    const dir = path.join(c.modRequest.platformProjectRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'extra.json'), '{}');
    c.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: `${name}/extra.json`,
      groupName: name,
      project: c.modResults,
      isBuildFile: true,
    });
    return c;
  });

export default withXcodeResource;
