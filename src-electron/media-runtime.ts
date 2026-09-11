import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CheckpointInput, PipelineCheckpoint, MediaAvailability, MediaRenderInput, MediaRenderResult } from './media-contract.js';

export type MediaRuntimePaths = {
  readonly appRoot: string;
  readonly scratchRoot: string;
  readonly python: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly nodeDirectory?: string;
  readonly browser?: string;
};

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const AUDIO_EXTENSIONS: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;

export function resolveMediaRuntimePaths(input: {
  appRoot: string;
  scratchRoot: string;
  packaged: boolean;
  resourcesPath: string;
}): MediaRuntimePaths {
  if (input.packaged) {
    const runtimeRoot = path.join(input.resourcesPath, 'openmontage-media');
    const mediaBinaries = path.join(runtimeRoot, 'app/remotion-composer/node_modules/@remotion/compositor-win32-x64-msvc');
    return {
      appRoot: path.join(runtimeRoot, 'app'), scratchRoot: input.scratchRoot,
      python: path.join(runtimeRoot, 'python', 'python.exe'),
      ffmpeg: path.join(mediaBinaries, 'ffmpeg.exe'),
      ffprobe: path.join(mediaBinaries, 'ffprobe.exe'),
      nodeDirectory: path.join(runtimeRoot, 'node'),
      browser: path.join(runtimeRoot, 'browser', 'chrome-headless-shell.exe'),
    };
  }
  const requireFromComposer = createRequire(path.join(input.appRoot, 'remotion-composer/package.json'));
  const mediaBinaries = (requireFromComposer('@remotion/compositor-win32-x64-msvc') as { dir: string }).dir;
  return {
    appRoot: input.appRoot, scratchRoot: input.scratchRoot,
    python: path.join(input.appRoot, '.venv', 'Scripts', 'python.exe'),
    ffmpeg: path.join(mediaBinaries, 'ffmpeg.exe'),
    ffprobe: path.join(mediaBinaries, 'ffprobe.exe'),
  };
}

export function inspectMediaRuntime(paths: MediaRuntimePaths): MediaAvailability {
  const files = {
    Python: paths.python, FFmpeg: paths.ffmpeg, FFprobe: paths.ffprobe,
    'OpenMontage worker': path.join(paths.appRoot, 'app_runtime', 'media_worker.py'),
    Remotion: path.join(paths.appRoot, 'remotion-composer', 'node_modules', '@remotion', 'cli', 'package.json'),
    ...(paths.nodeDirectory ? { Node: path.join(paths.nodeDirectory, 'node.exe'), composition: path.join(paths.appRoot, 'remotion-composer', 'build', 'index.html') } : {}),
    ...(paths.browser ? { Browser: paths.browser } : {}),
  };
  const missing = Object.entries(files).filter(([, file]) => !file || !existsSync(file)).map(([label]) => label);
  return { available: missing.length === 0, missing };
}

export function mediaWorkerEnvironment(paths: MediaRuntimePaths, productionRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  // Pass OS/toolchain context, not the parent App's complete environment.
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PATHEXT']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  environment.PATH = [path.dirname(paths.ffmpeg), path.dirname(paths.ffprobe), ...(paths.nodeDirectory ? [paths.nodeDirectory, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : [process.env.PATH || ''])].join(path.delimiter);
  environment.PYTHONUTF8 = '1';
  environment.PYTHONUNBUFFERED = '1';
  environment.PYTHONDONTWRITEBYTECODE = '1';
  environment.OPENMONTAGE_PROJECTS_DIR = productionRoot;
  if (paths.browser) environment.OPENMONTAGE_REMOTION_BROWSER = paths.browser;
  if (paths.nodeDirectory) environment.OPENMONTAGE_REMOTION_ENTRY = 'build';
  return environment;
}

function validateRenderInput(input: MediaRenderInput): void {
  if (!input || typeof input.renderId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.renderId)) {
    throw new Error('A valid media render identifier is required.');
  }
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) {
    throw new Error('A render requires between one and twelve scenes.');
  }
  let totalBytes = 0;
  for (const scene of input.scenes) {
    if (!scene || !IMAGE_EXTENSIONS[scene.imageMimeType] || !AUDIO_EXTENSIONS[scene.narrationMimeType]
      || !(scene.image instanceof Uint8Array) || !(scene.narration instanceof Uint8Array)
      || !scene.image.byteLength || !scene.narration.byteLength) {
      throw new Error('Each scene needs a supported image and narration file.');
    }
    totalBytes += scene.image.byteLength + scene.narration.byteLength;
  }
  if (totalBytes > MAX_INPUT_BYTES) throw new Error('The current render input exceeds 64 MiB.');
}

type ActiveRender = { child: ChildProcess | null; canceled: boolean; stopping?: Promise<void> };

export class MediaRenderer {
  private readonly paths: MediaRuntimePaths;
  private readonly active = new Map<string, ActiveRender>();

  constructor(paths: MediaRuntimePaths) {
    this.paths = { ...paths, appRoot: path.resolve(paths.appRoot), scratchRoot: path.resolve(paths.scratchRoot) };
  }

  inspect(): MediaAvailability { return inspectMediaRuntime(this.paths); }

  async cancel(renderId: string): Promise<void> {
    const render = this.active.get(renderId);
    if (!render) return;
    render.canceled = true;
    const child = render.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (!render.stopping) {
      render.stopping = new Promise<void>((resolve, reject) => {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          if (error && child.exitCode === null && child.signalCode === null) reject(error);
          else resolve();
        });
      });
    }
    await render.stopping;
  }

  async dispose(): Promise<void> { await Promise.all([...this.active.keys()].map((id) => this.cancel(id))); }

  async checkpoint(input: CheckpointInput): Promise<PipelineCheckpoint> {
    if (this.active.size > 0) throw new Error('Wait for the current media operation before saving a checkpoint.');
    await mkdir(this.paths.scratchRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'checkpoint-'));
    const active: ActiveRender = { child: null, canceled: false };
    this.active.set(workspace, active);
    try {
      const result = await this.runWorker(active, workspace, { ...input, operation: 'checkpoint', project_dir: workspace });
      const checkpoint = result.checkpoint as PipelineCheckpoint;
      if (!checkpoint || checkpoint.project_id !== input.projectId || checkpoint.stage !== input.stage || checkpoint.status !== input.status) throw new Error('The checkpoint result does not match the requested transition.');
      return checkpoint;
    } finally {
      this.active.delete(workspace);
      if (path.dirname(workspace) !== this.paths.scratchRoot) throw new Error('Unexpected checkpoint cleanup directory.');
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async render(input: MediaRenderInput): Promise<MediaRenderResult> {
    validateRenderInput(input);
    if (this.active.size > 0) throw new Error('A video is already rendering. Wait for it or cancel it first.');
    const readiness = this.inspect();
    if (!readiness.available) throw new Error('Media runtime is not ready: ' + readiness.missing.join(', '));
    const active: ActiveRender = { child: null, canceled: false };
    this.active.set(input.renderId, active);
    let workspace: string | undefined;
    try {
      await mkdir(this.paths.scratchRoot, { recursive: true });
      workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'render-'));
      const scenes: { image: string; audio: string }[] = [];
      for (const [index, scene] of input.scenes.entries()) {
        if (active.canceled) throw new Error('Video rendering was canceled.');
        const image = 'scene-' + index + '.' + IMAGE_EXTENSIONS[scene.imageMimeType];
        const audio = 'scene-' + index + '.' + AUDIO_EXTENSIONS[scene.narrationMimeType];
        await writeFile(path.join(workspace, image), scene.image);
        await writeFile(path.join(workspace, audio), scene.narration);
        scenes.push({ image, audio });
      }
      if (active.canceled) throw new Error('Video rendering was canceled.');
      const response = await this.runWorker(active, workspace, { operation: 'render', project_dir: workspace, scenes });
      if (active.canceled) throw new Error('Video rendering was canceled.');
      if (response.output !== 'renders/final.mp4' || response.width !== 1280 || response.height !== 720
        || typeof response.durationSeconds !== 'number' || !Number.isFinite(response.durationSeconds) || response.durationSeconds <= 0) {
        throw new Error('The media worker returned invalid video metadata.');
      }
      const outputPath = path.join(workspace, 'renders', 'final.mp4');
      const output = await stat(outputPath);
      if (!output.isFile() || !output.size || output.size > MAX_PREVIEW_BYTES) throw new Error('The rendered preview exceeds the supported size or is missing.');
      const bytes = new Uint8Array(await readFile(outputPath));
      if (active.canceled) throw new Error('Video rendering was canceled.');
      return { bytes, width: 1280, height: 720, durationSeconds: response.durationSeconds, mimeType: 'video/mp4' };
    } finally {
      this.active.delete(input.renderId);
      if (workspace) {
        if (path.dirname(workspace) !== this.paths.scratchRoot) throw new Error('Unexpected media cleanup directory.');
        await rm(workspace, { recursive: true, force: true });
      }
    }
  }

  private runWorker(active: ActiveRender, workspace: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.paths.python, ['-m', 'app_runtime.media_worker'], {
        cwd: this.paths.appRoot, env: mediaWorkerEnvironment(this.paths, workspace), windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      active.child = child;
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-262144); });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', (code) => {
        if (active.canceled) { reject(new Error('Video rendering was canceled.')); return; }
        try {
          const result = JSON.parse(stdout) as Record<string, unknown>;
          if (code !== 0 || result.ok !== true) throw new Error(typeof result.message === 'string' ? result.message : 'The media worker failed.');
          resolve(result);
        } catch (error) {
          reject(new Error((error instanceof Error ? error.message : String(error)) + (stderr ? '\n' + stderr : '')));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
