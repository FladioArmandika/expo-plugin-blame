const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs'); const path = require('path');
module.exports = (config) => withDangerousMod(config, ['ios', async (c) => {
  const p = path.join(c.modRequest.platformProjectRoot, 'Podfile');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + "\n# added by withDangerousPodfile\n");
  return c;
}]);
