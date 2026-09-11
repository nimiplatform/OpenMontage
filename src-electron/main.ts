import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents } from 'electron';
import { registerOpenMontageMediaBridge } from './media-bridge.js';
import { resolveMediaRuntimePaths } from './media-runtime.js';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} from '@nimiplatform/kit/shell/electron/main';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

const APP_ID = 'openmontage.studio';
const NATIVE_BUNDLE_IDENTIFIER = "ai.nimi.apps.openmontage.studio";
const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];

app.setName("OpenMontage");
app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);
Menu.setApplicationMenu(null);
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  const media = registerOpenMontageMediaBridge({
    ipcMain,
    allowedRendererUrls,
    paths: resolveMediaRuntimePaths({
      appRoot,
      scratchRoot: path.join(app.getPath('userData'), 'media-scratch'),
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
  });
  let finishingQuit = false;
  app.on('before-quit', (event) => {
    if (finishingQuit) return;
    event.preventDefault();
    void media.dispose().then(() => {
      finishingQuit = true;
      app.quit();
    }).catch((error: unknown) => {
      process.stderr.write('OpenMontage media cleanup failed: ' + String(error) + '\n');
    });
  });
  registerNimiElectronAppBridge({
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
  });
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    title: "OpenMontage",
    icon: path.join(appRoot, 'assets', 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  await window.loadURL(rendererUrl);
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some((value) => value === flag || value.startsWith(prefix));
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}
