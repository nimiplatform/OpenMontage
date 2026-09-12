import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { build } from 'esbuild';
import { prepareMediaRuntime } from './prepare-media-runtime.mjs';

const APP_EXECUTABLE_NAME = "openmontage-nimi-app-shell";
const APP_PRODUCT_NAME = "OpenMontage";
function resolveWindowsResourceVersion(appVersion) {
  const semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
  if (typeof appVersion !== 'string' || !semverPattern.test(appVersion)) {
    throw new Error(`Windows production packaging requires an exact semantic App version: ${String(appVersion)}`);
  }
  const coreComponents = appVersion.split(/[+-]/u, 1)[0].split('.');
  if (coreComponents.some((component) => BigInt(component) > 65535n)) {
    throw new Error(`Windows production packaging requires App version core components in the 0..65535 range: ${appVersion}`);
  }
  return `${coreComponents.join('.')}.0`;
}
const MACOS_BUILD = process.platform === 'darwin' && process.arch === 'arm64';
const NATIVE_PLATFORM = MACOS_BUILD ? 'darwin' : 'win32';
const NATIVE_ARCH = MACOS_BUILD ? 'arm64' : 'x64';
const NATIVE_BINDING_PACKAGE = MACOS_BUILD ? '@nimiplatform/kit-protected-local-darwin-arm64' : '@nimiplatform/kit-protected-local-win32-x64';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(appRoot, 'dist-electron-package');
const requireFromApp = createRequire(path.join(appRoot, 'package.json'));

if (!MACOS_BUILD && (process.platform !== 'win32' || process.arch !== 'x64')) {
  throw new Error('Electron production packaging requires a windows-x86_64 or macos-aarch64 build host.');
}

const appPackage = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const APP_VERSION = appPackage.version;
const RESOURCE_VERSION = MACOS_BUILD ? APP_VERSION : resolveWindowsResourceVersion(APP_VERSION);
for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(appPackage[sectionName] || {}, NATIVE_BINDING_PACKAGE)) {
    throw new Error('The protected native binding must arrive through the Kit optional dependency.');
  }
}
const electronPackage = JSON.parse(await readFile(requireFromApp.resolve('electron/package.json'), 'utf8'));
const kitEntry = requireFromApp.resolve('@nimiplatform/kit/shell/electron/main');
const kitRoot = await findPackageRoot(kitEntry, '@nimiplatform/kit');
const kitPackage = JSON.parse(await readFile(path.join(kitRoot, 'package.json'), 'utf8'));
if (!Object.hasOwn(kitPackage.optionalDependencies || {}, NATIVE_BINDING_PACKAGE)) {
  throw new Error('Kit does not declare the current-platform protected native binding as optional.');
}
const requireFromKit = createRequire(path.join(kitRoot, 'package.json'));
const nativeEntry = requireFromKit.resolve(NATIVE_BINDING_PACKAGE);
const nativePackageRoot = await findPackageRoot(nativeEntry, NATIVE_BINDING_PACKAGE);

await rm(outputRoot, { recursive: true, force: true });
const stagingRoot = await mkdtemp(path.join(tmpdir(), 'nimi-electron-packager-'));
const productionSourceRoot = path.join(stagingRoot, 'app');
const packagerTempRoot = path.join(stagingRoot, 'packager');
let packageCompleted = false;

try {
  await build({
    entryPoints: [path.join(appRoot, 'src-electron/main.ts')],
    outfile: path.join(appRoot, 'dist-electron/main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
    external: ['electron'],
    define: { __NIMI_ELECTRON_PRODUCTION__: 'true' },
    logLevel: 'silent',
  });

  await realpath(path.join(appRoot, 'dist', 'index.html'));
  await realpath(path.join(appRoot, 'dist-electron', 'preload.cjs'));

  await mkdir(path.join(productionSourceRoot, 'dist-electron'), { recursive: true });
  await copyFile(path.join(appRoot, 'package.json'), path.join(productionSourceRoot, 'package.json'));
  await copyFile(path.join(appRoot, 'pnpm-lock.yaml'), path.join(productionSourceRoot, 'pnpm-lock.yaml'));
  await cp(path.join(appRoot, 'dist'), path.join(productionSourceRoot, 'dist'), { recursive: true, force: false });
  await mkdir(path.join(productionSourceRoot, 'assets'), { recursive: true });
  await copyFile(path.join(appRoot, 'assets', 'app-icon.png'), path.join(productionSourceRoot, 'assets', 'app-icon.png'));
  await copyFile(path.join(appRoot, 'dist-electron', 'main.js'), path.join(productionSourceRoot, 'dist-electron', 'main.js'));
  await copyFile(path.join(appRoot, 'dist-electron', 'preload.cjs'), path.join(productionSourceRoot, 'dist-electron', 'preload.cjs'));
  await installProductionDependencies(productionSourceRoot);

  const productionManifestPath = path.join(productionSourceRoot, 'package.json');
  const productionManifest = JSON.parse(await readFile(productionManifestPath, 'utf8'));
  delete productionManifest.devDependencies;
  await writeFile(productionManifestPath, `${JSON.stringify(productionManifest, null, 2)}\n`);
  await rm(path.join(productionSourceRoot, 'pnpm-lock.yaml'));

  const nativeDestination = path.join(productionSourceRoot, 'node_modules', ...NATIVE_BINDING_PACKAGE.split('/'));
  await rm(nativeDestination, { recursive: true, force: true });
  await mkdir(path.dirname(nativeDestination), { recursive: true });
  await cp(nativePackageRoot, nativeDestination, { recursive: true, dereference: true, force: false });
  await mkdir(packagerTempRoot, { recursive: true });

  const packagePaths = await packager({
    dir: productionSourceRoot,
    platform: NATIVE_PLATFORM,
    arch: NATIVE_ARCH,
    appBundleId: "ai.nimi.apps.openmontage.studio",
    name: APP_EXECUTABLE_NAME,
    executableName: APP_EXECUTABLE_NAME,
    appVersion: RESOURCE_VERSION,
    buildVersion: RESOURCE_VERSION,
    electronVersion: electronPackage.version,
    out: outputRoot,
    tmpdir: packagerTempRoot,
    overwrite: false,
    asar: false,
    prune: false,
    quiet: true,
    derefSymlinks: true,
    // Publisher-side ad-hoc sealing supplies no Developer ID or notarization.
    // Runtime preserves these bytes; Nimi never signs installed third-party code.
    ...(MACOS_BUILD ? { osxSign: {
      identity: '-', identityValidation: false, preAutoEntitlements: false,
      preEmbedProvisioningProfile: false, strictVerify: true,
      optionsForFile: () => ({ entitlements: [], hardenedRuntime: false, timestamp: 'none' }),
    } } : {}),
    afterInitialize: [async ({ buildPath }) => {
      const packagedManifestPath = path.join(buildPath, 'package.json');
      const packagedManifest = JSON.parse(await readFile(packagedManifestPath, 'utf8'));
      packagedManifest.version = APP_VERSION;
      await writeFile(packagedManifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);
    }],
    win32metadata: {
      ProductName: APP_PRODUCT_NAME,
      FileDescription: APP_PRODUCT_NAME,
      InternalName: APP_EXECUTABLE_NAME,
      OriginalFilename: `${APP_EXECUTABLE_NAME}.exe`,
      'requested-execution-level': 'asInvoker',
    },
  });
  if (!Array.isArray(packagePaths) || packagePaths.length !== 1) throw new Error('Electron packager returned an ambiguous production package.');
  const expectedPackageRoot = path.join(outputRoot, `${APP_EXECUTABLE_NAME}-${NATIVE_PLATFORM}-${NATIVE_ARCH}`);
  if (path.resolve(packagePaths[0]).toLowerCase() !== path.resolve(expectedPackageRoot).toLowerCase()) {
    throw new Error('Electron packager returned an unexpected production package path.');
  }
  await realpath(MACOS_BUILD
    ? path.join(expectedPackageRoot, `${APP_EXECUTABLE_NAME}.app`, 'Contents', 'MacOS', APP_EXECUTABLE_NAME)
    : path.join(expectedPackageRoot, `${APP_EXECUTABLE_NAME}.exe`));
  await prepareMediaRuntime(appRoot, path.join(expectedPackageRoot, 'resources'));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', 'test/media/checkpoint.test.mjs', 'test/media/media-runtime.test.mjs', 'test/media/subtitles.test.mjs'], { cwd: appRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Packaged media tests failed (${code}).`)));
  });
  packageCompleted = true;
  process.stdout.write(`[nimi-app] Electron production package: ${expectedPackageRoot}\n`);
} finally {
  const cleanupTasks = [rm(stagingRoot, { recursive: true, force: true })];
  if (!packageCompleted) cleanupTasks.push(rm(outputRoot, { recursive: true, force: true }));
  await Promise.all(cleanupTasks);
}

async function installProductionDependencies(projectRoot) {
  const command = 'pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted';
  const commandShell = MACOS_BUILD ? 'pnpm' : process.env.ComSpec || 'cmd.exe';
  const commandArguments = MACOS_BUILD ? ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--node-linker=hoisted'] : ['/d', '/s', '/c', command];
  await new Promise((resolve, reject) => {
    const child = spawn(commandShell, commandArguments, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm production dependency staging failed (${signal || `exit ${String(code)}`}).`));
    });
  });
}

async function findPackageRoot(entry, expectedName) {
  let current = path.dirname(await realpath(entry));
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.name === expectedName) return current;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to locate installed package ${expectedName}.`);
    current = parent;
  }
}
