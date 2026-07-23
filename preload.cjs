const { contextBridge, ipcRenderer } = require('electron');

const api = {
  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  listVaultSecrets: () => ipcRenderer.invoke('vault:list-secrets'),
  saveVaultSecret: (input) => ipcRenderer.invoke('vault:save-secret', input),
  deleteVaultSecret: (key) => ipcRenderer.invoke('vault:delete-secret', key),
  gatewayConfig: () => ipcRenderer.invoke('gateway:config'),
  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (input) => ipcRenderer.invoke('servers:save', input),
  setServerEnabled: (id, enabled) => ipcRenderer.invoke('servers:set-enabled', id, enabled),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  serverHealth: (id) => ipcRenderer.invoke('servers:health', id),
  clientConfig: (id) => ipcRenderer.invoke('servers:client-config', id),
  rotateServerKey: (id) => ipcRenderer.invoke('servers:rotate-key', id),
  onServersChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('octovault:servers-changed', listener);
    return () => ipcRenderer.removeListener('octovault:servers-changed', listener);
  }
};

contextBridge.exposeInMainWorld('localMcpVault', api);
