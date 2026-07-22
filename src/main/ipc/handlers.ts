import { ipcMain } from 'electron';
import type { AppServices } from '../app-services.js';
import type { McpServerInput, VaultSecretInput } from '../../shared/types.js';

export function registerIpcHandlers(services: AppServices): void {
  ipcMain.handle('vault:status', async () => services.vault.status());
  ipcMain.handle('vault:list-secrets', async () => services.configService.listVaultSecrets());
  ipcMain.handle('vault:save-secret', async (_event, input: VaultSecretInput) => services.configService.saveVaultSecret(input));
  ipcMain.handle('vault:delete-secret', async (_event, key: string) => {
    await services.configService.deleteVaultSecret(key);
    return true;
  });
  ipcMain.handle('gateway:config', async () => services.gateway.config);
  ipcMain.handle('servers:list', async () => services.configService.listServers());
  ipcMain.handle('servers:save', async (_event, input: McpServerInput) => services.configService.saveServer(input));
  ipcMain.handle('servers:set-enabled', async (_event, id: string, enabled: boolean) => {
    const updated = await services.configService.setServerEnabled(id, enabled);
    if (!enabled) services.runtime.stop(id);
    return updated;
  });
  ipcMain.handle('servers:delete', async (_event, id: string) => {
    await services.configService.deleteServer(id);
    services.runtime.stop(id);
    return true;
  });
  ipcMain.handle('servers:health', async (_event, id: string) => services.runtime.health(id));
}
