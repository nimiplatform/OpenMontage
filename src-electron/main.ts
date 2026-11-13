import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';
import { RemoteMediaProvider } from './remote-media.js';
import { MediaRenderer } from './media-runtime.js';
import { registerOpenMontageMediaBridge } from './media-bridge.js';
import { resolveMediaRuntimePaths } from './media-runtime.js';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} from '@nimiplatform/kit/shell/electron/main';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

try { configureNimiElectronAppHostProfile(app); }
catch (cause) { process.stderr.write(`[nimi-app-host-profile] ${String(cause)}\n`); app.exit(78); throw cause; }

const APP_ID = 'openmontage.studio';
const NATIVE_BUNDLE_IDENTIFIER = "ai.nimi.apps.openmontage.studio";
const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
// Native presentation is separate from metadata.icon artwork shown in Nimi Home.
const nativeAppIconPath = path.join(appRoot, 'assets', 'native', process.platform === 'win32' ? 'windows.ico' : process.platform === 'darwin' ? 'macos.png' : 'app.png');
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];
let remoteMedia: RemoteMediaProvider | undefined;

app.setName("OpenMontage");
app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);
Menu.setApplicationMenu(null);
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(nativeAppIconPath);
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
    void Promise.all([media.dispose(),remoteMedia?.close()]).then(() => {
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
    onSessionReady: (services) => {
      void remoteMedia?.close();
      const root = path.join(app.getPath('temp'), 'openmontage-remote-'+randomUUID());
      remoteMedia = new RemoteMediaProvider(services,new MediaRenderer(resolveMediaRuntimePaths({appRoot,scratchRoot:path.join(root,'worker'),packaged:app.isPackaged,resourcesPath:process.resourcesPath})),root);
    },
    onSessionInvalidated: () => { void remoteMedia?.close(); remoteMedia=undefined; },
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
    icon: nativeAppIconPath,
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
