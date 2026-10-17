const { withXcodeProject, withDangerousMod, IOSConfig } = require('expo/config-plugins');
const fs = require('fs'); const path = require('path');
module.exports = (config) => {
  config = withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName;
    fs.mkdirSync(path.join(c.modRequest.platformProjectRoot, name), { recursive: true });
    fs.writeFileSync(path.join(c.modRequest.platformProjectRoot, name, 'extra.json'), '{}');
    c.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: `${name}/extra.json`, groupName: name, project: c.modResults, isBuildFile: true,
    });
    return c;
  });
  return config;
};
