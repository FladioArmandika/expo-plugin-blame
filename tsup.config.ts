import { defineConfig } from 'tsup';

export default defineConfig([
  { entry: { cli: 'src/cli.ts' }, format: 'esm', target: 'node20', clean: true, banner: { js: '#!/usr/bin/env node' } },
  // Loaded by Expo from the generated app.config.js in the temp copy, so it has to be CommonJS.
  { entry: { 'runtime/app-config': 'src/runtime/app-config.ts' }, format: 'cjs', target: 'node20' },
]);
