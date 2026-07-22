import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('Electron main window loads the CommonJS preload bridge', () => {
  const mainSource = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
  assert.match(mainSource, /preload\.cjs/);
});

test('preload exposes the localMcpVault API methods used by the renderer', () => {
  const preloadSource = readFileSync(join(root, 'preload.cjs'), 'utf8');
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('localMcpVault', api\)/);
  for (const method of ['vaultStatus', 'listVaultSecrets', 'saveVaultSecret', 'deleteVaultSecret', 'gatewayConfig', 'listServers', 'saveServer', 'setServerEnabled', 'deleteServer', 'serverHealth']) {
    assert.match(preloadSource, new RegExp(`${method}:`));
  }
});
