import { app, BrowserWindow, safeStorage } from 'electron';
import { join } from 'node:path';
import { AppServices } from './app-services.js';
import { registerIpcHandlers } from './ipc/handlers.js';

let services: AppServices | null = null;
let windowRef: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  windowRef = new BrowserWindow({
    width: 1180,
    height: 760,
    title: 'OctoVault',
    webPreferences: {
      preload: join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await windowRef.loadFile(join(app.getAppPath(), 'dist-renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  services = new AppServices({ safeStorage });
  registerIpcHandlers(services);
  await services.start();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (!services) return;
  event.preventDefault();
  const current = services;
  services = null;
  await current.stop();
  app.exit(0);
});
