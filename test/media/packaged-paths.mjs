import path from 'node:path';

export function packagedResources(appRoot) {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return path.join(appRoot, 'dist-electron-package/openmontage-nimi-app-shell-darwin-arm64/openmontage-nimi-app-shell.app/Contents/Resources');
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return path.join(appRoot, 'dist-electron-package/openmontage-nimi-app-shell-win32-x64/resources');
  }
  throw new Error('Packaged media tests require a supported native build host.');
}
