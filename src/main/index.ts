import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { AppServices } from './app-services.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { createTray, type TrayController } from './tray.js';

let services: AppServices | null = null;
let windowRef: BrowserWindow | null = null;
let tray: TrayController | null = null;
let quitting = false;

// Ensure the product name is right even when launched unpackaged in dev
// (`electron .`), where it would otherwise read "Electron".
app.setName('OctoVault');

function showWindow(): void {
  if (windowRef) {
    if (windowRef.isMinimized()) windowRef.restore();
    windowRef.show();
    windowRef.focus();
  } else {
    void createWindow();
  }
}

function notifyRenderer(): void {
  windowRef?.webContents.send('octovault:servers-changed');
}

const PACKAGED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function applyContentSecurityPolicy(): void {
  // Dev uses the Vite server (needs eval/HMR/websocket); only lock down the
  // packaged renderer, which loads local assets exclusively.
  if (process.env.VITE_DEV_SERVER_URL) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PACKAGED_CSP],
      },
    });
  });
}

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

  // Open external links (e.g. the credit link) in the system browser, and
  // never let the app window itself navigate away from the renderer.
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  windowRef.webContents.on('will-navigate', (event, url) => {
    const isDev = process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    if (!isDev) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await windowRef.loadFile(join(app.getAppPath(), 'dist-renderer/index.html'));
  }
}

// Only one instance may run: the gateway binds a fixed local port, so a second
// copy would fail to start. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!windowRef) return;
    if (windowRef.isMinimized()) windowRef.restore();
    windowRef.focus();
  });

  app.whenReady().then(bootstrap);

  app.on('activate', () => {
    // macOS: recreate the window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    // With a tray present, keep running in the background (Quit from the tray).
    // Without one, fall back to the standard non-macOS "quit on last window".
    if (tray) return;
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (event) => {
    if (!services || quitting) return;
    quitting = true;
    event.preventDefault();
    const current = services;
    services = null;
    try {
      await current.stop();
    } catch (error) {
      console.error('[octovault] error during shutdown', error);
    } finally {
      app.exit(0);
    }
  });
}

async function bootstrap(): Promise<void> {
  applyContentSecurityPolicy();

  // Opening the store (and OS keychain) is fatal if it fails — without it the
  // app cannot function, so surface a clear message and exit.
  let app_services: AppServices;
  try {
    app_services = new AppServices({ safeStorage });
    services = app_services;
    // Rebuilding the tray also fires when the renderer mutates servers.
    registerIpcHandlers(app_services, () => { tray?.rebuild(); notifyRenderer(); });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('OctoVault could not start', `Failed to open the local vault store.\n\n${message}`);
    app.exit(1);
    return;
  }

  // Dock icon for macOS (helps the unpackaged dev run; packaged uses the bundle icon).
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(join(app.getAppPath(), 'assets', 'icon.png')); } catch { /* non-fatal */ }
  }

  await createWindow();

  // Menu-bar / system-tray control surface (best-effort; never fatal).
  try {
    tray = createTray(app_services, { showWindow, onServersChanged: notifyRenderer });
  } catch (error) {
    console.error('[octovault] tray unavailable', error);
  }

  // The gateway is not fatal: the vault UI still works if the port is taken.
  try {
    await app_services.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.includes('EADDRINUSE')
      ? `Port ${app_services.gateway.config.port} is already in use. Close whatever is using it (or set OCTOVAULT_PORT) and restart. The vault works, but MCP clients cannot connect until the proxy is running.`
      : message;
    dialog.showMessageBox({ type: 'warning', title: 'Local proxy not started', message: 'OctoVault could not start the MCP proxy.', detail });
  }
}
