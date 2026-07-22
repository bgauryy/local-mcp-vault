import { contextBridge, ipcRenderer } from 'electron';
import type { GatewayConfig, McpServerInput, McpServerWithEnv, ServerHealth, VaultSecretInput, VaultSecretRecord, VaultStatus } from '../shared/types.js';

const api = {
  vaultStatus: (): Promise<VaultStatus> => ipcRenderer.invoke('vault:status'),
  listVaultSecrets: (): Promise<VaultSecretRecord[]> => ipcRenderer.invoke('vault:list-secrets'),
  saveVaultSecret: (input: VaultSecretInput): Promise<VaultSecretRecord> => ipcRenderer.invoke('vault:save-secret', input),
  deleteVaultSecret: (key: string): Promise<boolean> => ipcRenderer.invoke('vault:delete-secret', key),
  gatewayConfig: (): Promise<GatewayConfig> => ipcRenderer.invoke('gateway:config'),
  listServers: (): Promise<McpServerWithEnv[]> => ipcRenderer.invoke('servers:list'),
  saveServer: (input: McpServerInput): Promise<McpServerWithEnv> => ipcRenderer.invoke('servers:save', input),
  setServerEnabled: (id: string, enabled: boolean): Promise<McpServerWithEnv> => ipcRenderer.invoke('servers:set-enabled', id, enabled),
  deleteServer: (id: string): Promise<boolean> => ipcRenderer.invoke('servers:delete', id),
  serverHealth: (id: string): Promise<ServerHealth> => ipcRenderer.invoke('servers:health', id)
};

contextBridge.exposeInMainWorld('localMcpVault', api);

export type LocalMcpVaultApi = typeof api;
