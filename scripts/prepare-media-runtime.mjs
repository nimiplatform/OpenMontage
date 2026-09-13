import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PYTHON_VERSION = '3.14.4';
const NODE_VERSION = '24.15.0';
const PIP_VERSION = '26.2.1';
const FFMPEG_VERSION = '9.0.1';
const MACOS = process.platform === 'darwin' && process.arch === 'arm64';
const PYTHON_MAC = 'cpython-3.14.4+20260414-aarch64-apple-darwin-install_only_stripped.tar.gz';
const FFMPEG_MAC_URL = 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1';

function requireSupportedHost() {
  if (!MACOS && !(process.platform === 'win32' && process.arch === 'x64')) {
    throw new Error('OpenMontage media supports Windows x86_64 and macOS Apple Silicon.');
  }
}

async function verifyDownload(target, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error(`Media download checksum mismatch: ${target}`);
}

async function run(command, args, cwd, environment = process.env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, windowsHide: true, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Media build command failed (${code}): ${command}`)));
  });
}

async function download(url, target, sha256) {
  const cached = await access(target).then(() => true, () => false);
  if (cached) { await verifyDownload(target, sha256); return target; }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download media build input: ${url} (${response.status})`);
  const pending = target + '.download';
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(pending));
    await verifyDownload(pending, sha256);
    await copyFile(pending, target);
  } finally { await rm(pending, { force: true }); }
  return target;
}

async function extract(archive, destination, cwd) {
  await mkdir(destination, { recursive: true });
  if (MACOS) {
    await run('/usr/bin/tar', ['-xf', archive, '-C', destination], cwd);
    return;
  }
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:OPENMONTAGE_BUILD_ARCHIVE, $env:OPENMONTAGE_BUILD_DESTINATION)'], cwd, {
    ...process.env, OPENMONTAGE_BUILD_ARCHIVE: archive, OPENMONTAGE_BUILD_DESTINATION: destination,
  });
}

export async function prepareFFmpeg(appRoot) {
  requireSupportedHost();
  const buildRoot = path.resolve(appRoot, '.nimi/local/media-build');
  if (MACOS) {
    const downloads = path.join(buildRoot, 'downloads');
    const target = path.join(buildRoot, `ffmpeg-${FFMPEG_VERSION}-darwin-arm64`);
    await mkdir(downloads, { recursive: true });
    await mkdir(path.join(target, 'bin'), { recursive: true });
    const hashes = {
      ffmpeg: '8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe',
      ffprobe: '102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a',
    };
    for (const [name, sha256] of Object.entries(hashes)) {
      const archive = await download(`${FFMPEG_MAC_URL}/${name}.zip`, path.join(downloads, `${name}-${FFMPEG_VERSION}-darwin-arm64.zip`), sha256);
      await extract(archive, path.join(target, 'bin'), appRoot);
      await chmod(path.join(target, 'bin', name), 0o755);
    }
    await copyFile(path.join(appRoot, 'licenses/FFMPEG-GPL-3.0.txt'), path.join(target, 'LICENSE'));
    return target;
  }
  const target = path.join(buildRoot, `ffmpeg-${FFMPEG_VERSION}-essentials_build`);
  try { await access(path.join(target, 'bin/ffmpeg.exe')); await access(path.join(target, 'bin/ffprobe.exe')); return target; } catch { /* First development or production build. */ }
  const downloads = path.join(buildRoot, 'downloads');
  await mkdir(downloads, { recursive: true });
  const filename = `ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
  const archive = await download(`https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/${filename}`, path.join(downloads, filename), 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9');
  await extract(archive, buildRoot, appRoot);
  await access(path.join(target, 'bin/ffmpeg.exe'));
  return target;
}

export async function prepareMediaRuntime(appRoot, resourcesDirectory) {
  requireSupportedHost();
  const buildRoot = path.resolve(appRoot, '.nimi/local/media-build');
  const downloads = path.join(buildRoot, 'downloads');
  await mkdir(downloads, { recursive: true });
  const temporary = await mkdtemp(path.join(buildRoot, 'stage-'));
  const runtimeRoot = path.join(temporary, 'openmontage-media');
  const pythonRoot = path.join(runtimeRoot, 'python');
  const sourceRoot = path.join(runtimeRoot, 'app');
  try {
    process.stdout.write('[OpenMontage] Preparing the packaged Python and Node runtimes\n');
    if (MACOS) {
      const archive = await download(`https://github.com/astral-sh/python-build-standalone/releases/download/20260414/${PYTHON_MAC}`, path.join(downloads, PYTHON_MAC), '6f304f4ec30854611f23316578302235fb517cd970519ecdd11a8c4db87fd843');
      await extract(archive, runtimeRoot, appRoot); // Archive contains python/.
    } else {
      const archive = await download(`https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`, path.join(downloads, `python-${PYTHON_VERSION}.zip`), 'cda80a9b1e75c0f1b4f9872ca1b417f0d19bce32facc811aea9180e70fad5fb9');
      await extract(archive, pythonRoot, appRoot);
    }
    const nodeDistribution = `node-v${NODE_VERSION}-${MACOS ? 'darwin-arm64' : 'win-x64'}`;
    const nodeFilename = nodeDistribution + (MACOS ? '.tar.xz' : '.zip');
    const nodeArchive = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeFilename}`, path.join(downloads, nodeFilename), MACOS ? 'af5cfaeafe603aaf7599f287fd9d100bb41f16794f49788fa59dd3f25546930f' : 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62');
    const nodeExtract = path.join(temporary, 'node-extracted');
    await extract(nodeArchive, nodeExtract, appRoot);
    const nodeRoot = path.join(runtimeRoot, 'node');
    await cp(path.join(nodeExtract, nodeDistribution), nodeRoot, { recursive: true, verbatimSymlinks: true });
    const ffmpeg = await prepareFFmpeg(appRoot);
    await cp(ffmpeg, path.join(runtimeRoot, 'ffmpeg'), { recursive: true, filter: (source) => path.basename(source) !== 'ffplay.exe' });
    const python = path.join(pythonRoot, MACOS ? 'bin/python3' : 'python.exe');
    const node = path.join(nodeRoot, MACOS ? 'bin/node' : 'node.exe');
    const sitePackages = path.join(pythonRoot, MACOS ? 'lib/python3.14/site-packages' : 'Lib/site-packages');
    const pipArchive = path.join(downloads, `pip-${PIP_VERSION}.zip`);
    await download('https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl', pipArchive, '71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e');
    if (MACOS) {
      for (const name of await readdir(sitePackages)) {
        if (name === 'pip' || /^pip-[\d.]+\.dist-info$/.test(name)) await rm(path.join(sitePackages, name), { recursive: true, force: true });
      }
    }
    await extract(pipArchive, sitePackages, appRoot);
    if (!MACOS) await writeFile(path.join(pythonRoot, 'python314._pth'), 'python314.zip\n.\nLib/site-packages\n../app\nimport site\n');
    const environment = { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--no-warn-script-location', '--only-binary=:all:', '--target', sitePackages, '-r', path.join(appRoot, 'app_runtime/requirements-media.txt')], appRoot, environment);

    const files = [
      'app_runtime/__init__.py', 'app_runtime/media_worker.py', 'app_runtime/checkpoint_worker.py', 'app_runtime/pipeline_context.py', 'app_runtime/requirements-media.txt',
      'tools/__init__.py', 'tools/base_tool.py', 'tools/audio/__init__.py', 'tools/audio/audio_mixer.py', 'tools/video/__init__.py', 'tools/video/video_compose.py',
      'tools/subtitle/__init__.py', 'tools/subtitle/subtitle_gen.py',
      'lib/__init__.py', 'lib/paths.py', 'lib/events.py', 'lib/media_profiles.py', 'lib/checkpoint.py', 'lib/pipeline_loader.py',
      'schemas/__init__.py', 'schemas/artifacts/__init__.py', 'schemas/artifacts/edit_decisions.schema.json',
      'schemas/artifacts/scene_plan.schema.json', 'schemas/artifacts/asset_manifest.schema.json', 'schemas/artifacts/render_report.schema.json',
      'schemas/checkpoints/checkpoint.schema.json', 'schemas/pipelines/pipeline_manifest.schema.json',
      'pipeline_defs/nimi-image-explainer.yaml',
      'skills/pipelines/nimi-image-explainer/scene-director.md', 'skills/pipelines/nimi-image-explainer/asset-director.md', 'skills/pipelines/nimi-image-explainer/compose-director.md',
      'remotion-composer/package.json', 'remotion-composer/package-lock.json',
      'remotion-composer/src/nimi-image-explainer.tsx', 'remotion-composer/src/components/ImageScene.tsx', 'remotion-composer/src/lib/resolveAsset.ts',
    ];
    for (const relative of files) {
      const destination = path.join(sourceRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(appRoot, relative), destination);
    }
    for (const relative of ['pipeline_defs', 'skills/pipelines', 'schemas/artifacts']) {
      await cp(path.join(appRoot, relative), path.join(sourceRoot, relative), { recursive: true });
    }
    const composer = path.join(sourceRoot, 'remotion-composer');
    process.stdout.write('[OpenMontage] Building the bundled image composition\n');
    await run(node, [path.join(nodeRoot, MACOS ? 'lib/node_modules/npm/bin/npm-cli.js' : 'node_modules/npm/bin/npm-cli.js'), 'ci', '--omit=dev', '--no-audit', '--no-fund'], composer, environment);
    const cli = path.join(composer, 'node_modules/@remotion/cli/remotion-cli.js');
    await run(node, [cli, 'bundle', 'src/nimi-image-explainer.tsx'], composer, environment);
    const browserResult = await run(node, ['-e', 'require(' + JSON.stringify(path.join(composer, 'node_modules/@remotion/renderer')) + ').ensureBrowser().then(result=>console.log(JSON.stringify(result)))'], appRoot, environment, true);
    const browser = JSON.parse(browserResult.split(/\r?\n/).at(-1));
    if (!browser.path || path.basename(browser.path) !== (MACOS ? 'chrome-headless-shell' : 'chrome-headless-shell.exe')) throw new Error('Remotion did not resolve its expected platform browser.');
    await cp(path.dirname(browser.path), path.join(runtimeRoot, 'browser'), { recursive: true });
    for (const disposable of [path.join(composer, 'node_modules/.remotion'), path.join(composer, 'node_modules/.cache'), path.join(sitePackages, 'pip'), path.join(sitePackages, `pip-${PIP_VERSION}.dist-info`)]) {
      const target = path.resolve(disposable);
      if (!target.startsWith(path.resolve(runtimeRoot) + path.sep)) throw new Error('Unexpected media build cache directory.');
      await rm(target, { recursive: true, force: true });
    }
    await copyFile(path.join(appRoot, 'LICENSE'), path.join(runtimeRoot, 'OPENMONTAGE-LICENSE'));
    await copyFile(path.join(appRoot, 'THIRD_PARTY_NOTICES.md'), path.join(runtimeRoot, 'THIRD_PARTY_NOTICES.md'));
    await cp(path.join(appRoot, 'licenses'), path.join(runtimeRoot, 'licenses'), { recursive: true });
    const output = path.resolve(resourcesDirectory, 'openmontage-media');
    if (path.dirname(output) !== path.resolve(resourcesDirectory)) throw new Error('Unexpected media package destination.');
    await cp(runtimeRoot, output, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    process.stdout.write('[OpenMontage] Packaged media runtime: ' + output + '\n');
    return output;
  } finally {
    if (path.dirname(temporary) !== buildRoot) throw new Error('Unexpected media build cleanup directory.');
    await rm(temporary, { recursive: true, force: true });
  }
}
