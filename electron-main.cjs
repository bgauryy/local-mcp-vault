const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const compiledMain = join(__dirname, 'dist/main/main/index.js');

if (!existsSync(compiledMain)) {
  if (__dirname.includes('app.asar')) {
    console.error('Compiled Electron assets are missing from the packaged app. Run yarn build before bundling.');
    process.exit(1);
  }

  const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const result = spawnSync(yarnCommand, ['build'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`Failed to build Electron assets before launch (exit ${code}).`);
    process.exit(code);
  }
}

import(compiledMain).catch((error) => {
  console.error('Failed to load compiled Electron main process:', error);
  process.exit(1);
});
