import type { LocalMcpVaultApi } from '../preload/index.js';

export function getLocalMcpVaultApi(): LocalMcpVaultApi | null {
  const candidate = window.localMcpVault;
  if (!candidate) return null;
  return candidate;
}

export function missingBridgeMessage(): string {
  return 'Electron preload bridge is unavailable. Restart the app with yarn start or electron . from the project root.';
}
