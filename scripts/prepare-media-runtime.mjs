import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PYTHON_VERSION = '3.14.4';
const NODE_VERSION = '24.15.0';
const PIP_VERSION = '26.2.1';

async function run(command, args, cwd, environment = process.env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, windowsHide: true, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Media build command failed (${code}): ${command}`)));
  });
}

async function download(url, target) {
  try { await access(target); return target; } catch { /* Download this pinned build input once. */ }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download media build input: ${url} (${response.status})`);
  const pending = target + '.download';
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(pending));
    await copyFile(pending, target);
  } finally { await rm(pending, { force: true }); }
  return target;
}

async function extract(archive, destination, cwd) {
  await mkdir(destination, { recursive: true });
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:OPENMONTAGE_BUILD_ARCHIVE, $env:OPENMONTAGE_BUILD_DESTINATION)'], cwd, {
    ...process.env, OPENMONTAGE_BUILD_ARCHIVE: archive, OPENMONTAGE_BUILD_DESTINATION: destination,
  });
}

export async function prepareMediaRuntime(appRoot, resourcesDirectory) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('OpenMontage media packaging currently supports Windows x86_64.');
  const buildRoot = path.resolve(appRoot, '.nimi/local/media-build');
  const downloads = path.join(buildRoot, 'downloads');
  await mkdir(downloads, { recursive: true });
  const temporary = await mkdtemp(path.join(buildRoot, 'stage-'));
  const runtimeRoot = path.join(temporary, 'openmontage-media');
  const pythonRoot = path.join(runtimeRoot, 'python');
  const sourceRoot = path.join(runtimeRoot, 'app');
  try {
    process.stdout.write('[OpenMontage] Preparing the packaged Python and Node runtimes\n');
    const pythonArchive = await download(`https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`, path.join(downloads, `python-${PYTHON_VERSION}.zip`));
    const nodeArchive = await download(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, path.join(downloads, `node-${NODE_VERSION}.zip`));
    await extract(pythonArchive, pythonRoot, appRoot);
    const nodeExtract = path.join(temporary, 'node-extracted');
    await extract(nodeArchive, nodeExtract, appRoot);
    const nodeRoot = path.join(runtimeRoot, 'node');
    await cp(path.join(nodeExtract, `node-v${NODE_VERSION}-win-x64`), nodeRoot, { recursive: true });
    const python = path.join(pythonRoot, 'python.exe');
    const node = path.join(nodeRoot, 'node.exe');
    const sitePackages = path.join(pythonRoot, 'Lib/site-packages');
    const pipMetadataResponse = await fetch(`https://pypi.org/pypi/pip/${PIP_VERSION}/json`);
    if (!pipMetadataResponse.ok) throw new Error('Unable to resolve the pinned pip build dependency.');
    const pipMetadata = await pipMetadataResponse.json();
    const pipWheel = pipMetadata.urls.find((entry) => entry.filename === `pip-${PIP_VERSION}-py3-none-any.whl`);
    if (!pipWheel) throw new Error('The pinned pip wheel is unavailable.');
    const pipArchive = await download(pipWheel.url, path.join(downloads, `pip-${PIP_VERSION}.zip`));
    await extract(pipArchive, sitePackages, appRoot);
    await writeFile(path.join(pythonRoot, 'python314._pth'), 'python314.zip\n.\nLib/site-packages\n../app\nimport site\n');
    const environment = { ...process.env, PATH: nodeRoot + path.delimiter + process.env.PATH, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--no-warn-script-location', '--only-binary=:all:', '--target', sitePackages, '-r', path.join(appRoot, 'app_runtime/requirements-media.txt')], appRoot, environment);

    const files = [
      'app_runtime/__init__.py', 'app_runtime/media_worker.py', 'app_runtime/checkpoint_worker.py', 'app_runtime/requirements-media.txt',
      'tools/__init__.py', 'tools/base_tool.py', 'tools/audio/__init__.py', 'tools/audio/audio_mixer.py', 'tools/video/__init__.py', 'tools/video/video_compose.py',
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
    const composer = path.join(sourceRoot, 'remotion-composer');
    process.stdout.write('[OpenMontage] Building the bundled image composition\n');
    await run(node, [path.join(nodeRoot, 'node_modules/npm/bin/npm-cli.js'), 'ci', '--omit=dev', '--no-audit', '--no-fund'], composer, environment);
    const cli = path.join(composer, 'node_modules/@remotion/cli/remotion-cli.js');
    await run(node, [cli, 'bundle', 'src/nimi-image-explainer.tsx'], composer, environment);
    const browserResult = await run(node, ['-e', 'require(' + JSON.stringify(path.join(composer, 'node_modules/@remotion/renderer')) + ').ensureBrowser().then(result=>console.log(JSON.stringify(result)))'], appRoot, environment, true);
    const browser = JSON.parse(browserResult.split(/\r?\n/).at(-1));
    if (!browser.path || path.basename(browser.path) !== 'chrome-headless-shell.exe') throw new Error('Remotion did not resolve its expected Windows browser.');
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
    await cp(runtimeRoot, output, { recursive: true, force: false, errorOnExist: true });
    process.stdout.write('[OpenMontage] Packaged media runtime: ' + output + '\n');
    return output;
  } finally {
    if (path.dirname(temporary) !== buildRoot) throw new Error('Unexpected media build cleanup directory.');
    await rm(temporary, { recursive: true, force: true });
  }
}
