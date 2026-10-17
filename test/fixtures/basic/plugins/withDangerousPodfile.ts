import { type ConfigPlugin, withDangerousMod } from 'expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';

// Appends a comment to the Podfile from a dangerous mod.
const withDangerousPodfile: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (c) => {
      const podfile = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      fs.appendFileSync(podfile, '\n# added by withDangerousPodfile\n');
      return c;
    },
  ]);

export default withDangerousPodfile;
