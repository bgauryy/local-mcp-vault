import type { LocalMcpVaultApi } from '../preload/index.js';

declare global {
  interface Window {
    localMcpVault: LocalMcpVaultApi;
  }
}
