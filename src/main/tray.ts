import { app, clipboard, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { AppServices } from './app-services.js';

export interface TrayController {
  rebuild(): void;
  destroy(): void;
}

export interface TrayOptions {
  /** Bring the main window forward (or recreate it). */
  showWindow: () => void;
  /** Notify the renderer that servers changed from the tray, so it can refresh. */
  onServersChanged: () => void;
}

/**
 * Menu-bar (macOS) / system-tray (Windows/Linux) control surface: list servers
 * with an enable/disable toggle and a "Copy install JSON" action each.
 */
export function createTray(services: AppServices, opts: TrayOptions): TrayController {
  const iconFile = process.platform === 'win32' ? 'tray.png' : 'trayTemplate.png';
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'assets', iconFile));
  if (process.platform === 'darwin' && !image.isEmpty()) image.setTemplateImage(true);

  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('OctoVault');

  async function toggle(id: string, enabled: boolean): Promise<void> {
    await services.configService.setServerEnabled(id, enabled);
    if (!enabled) services.runtime.stop(id);
    controller.rebuild();
    opts.onServersChanged();
  }

  async function copyConfig(id: string): Promise<void> {
    const snippet = await services.configService.buildClientConfig(id);
    clipboard.writeText(JSON.stringify(snippet, null, 2));
  }

  function buildMenu(): Menu {
    const servers = services.configService.listServers();
    const serverItems: MenuItemConstructorOptions[] = servers.length === 0
      ? [{ label: 'No servers configured', enabled: false }]
      : servers.map((server) => ({
          label: `${server.enabled ? '🟢' : '⚪️'}  ${server.name}`,
          submenu: [
            {
              label: 'Enabled',
              type: 'checkbox',
              checked: server.enabled,
              click: () => { void toggle(server.id, !server.enabled); }
            },
            { type: 'separator' },
            { label: 'Copy install JSON', click: () => { void copyConfig(server.id); } },
            { label: `Transport: ${server.transport}`, enabled: false },
            { label: `Health: ${services.runtime.health(server.id).status}`, enabled: false }
          ]
        }));

    return Menu.buildFromTemplate([
      { label: `OctoVault · ${services.gateway.config.host}:${services.gateway.config.port}`, enabled: false },
      { type: 'separator' },
      ...serverItems,
      { type: 'separator' },
      { label: 'Open OctoVault', click: () => opts.showWindow() },
      { label: 'Quit OctoVault', role: 'quit' }
    ]);
  }

  const controller: TrayController = {
    rebuild() { tray.setContextMenu(buildMenu()); },
    destroy() { tray.destroy(); }
  };
  controller.rebuild();
  return controller;
}
