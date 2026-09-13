import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AudioPreparationInput, PreparedAudio, SubtitleCue, CheckpointInput, PipelineCheckpoint, PipelineContext, MediaAvailability, MediaRenderInput, MediaRenderResult } from './media-contract.js';

export type MediaRuntimePaths = {
  readonly appRoot: string;
  readonly scratchRoot: string;
  readonly python: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly nodeDirectory?: string;
  readonly browser?: string;
};

const VISUAL_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const AUDIO_EXTENSIONS: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;

export function resolveMediaRuntimePaths(input: {
  appRoot: string;
  scratchRoot: string;
  packaged: boolean;
  resourcesPath: string;
}): MediaRuntimePaths {
  const windows = process.platform === 'win32';
  const executableSuffix = windows ? '.exe' : '';
  if (input.packaged) {
    const runtimeRoot = path.join(input.resourcesPath, 'openmontage-media');
    const mediaBinaries = path.join(runtimeRoot, 'ffmpeg/bin');
    return {
      appRoot: path.join(runtimeRoot, 'app'), scratchRoot: input.scratchRoot,
      python: path.join(runtimeRoot, 'python', windows ? 'python.exe' : 'bin/python3'),
      ffmpeg: path.join(mediaBinaries, 'ffmpeg' + executableSuffix),
      ffprobe: path.join(mediaBinaries, 'ffprobe' + executableSuffix),
      nodeDirectory: path.join(runtimeRoot, windows ? 'node' : 'node/bin'),
      browser: path.join(runtimeRoot, 'browser', 'chrome-headless-shell' + executableSuffix),
    };
  }
  const mediaBinaries = path.join(input.appRoot, '.nimi/local/media-build', windows ? 'ffmpeg-9.0.1-essentials_build/bin' : 'ffmpeg-9.0.1-darwin-arm64/bin');
  return {
    appRoot: input.appRoot, scratchRoot: input.scratchRoot,
    python: path.join(input.appRoot, '.venv', windows ? 'Scripts/python.exe' : 'bin/python3'),
    ffmpeg: path.join(mediaBinaries, 'ffmpeg' + executableSuffix),
    ffprobe: path.join(mediaBinaries, 'ffprobe' + executableSuffix),
  };
}

export function inspectMediaRuntime(paths: MediaRuntimePaths): MediaAvailability {
  const files = {
    Python: paths.python, FFmpeg: paths.ffmpeg, FFprobe: paths.ffprobe,
    'OpenMontage worker': path.join(paths.appRoot, 'app_runtime', 'media_worker.py'),
    Remotion: path.join(paths.appRoot, 'remotion-composer', 'node_modules', '@remotion', 'cli', 'package.json'),
    ...(paths.nodeDirectory ? { Node: path.join(paths.nodeDirectory, process.platform === 'win32' ? 'node.exe' : 'node'), composition: path.join(paths.appRoot, 'remotion-composer', 'build', 'index.html') } : {}),
    ...(paths.browser ? { Browser: paths.browser } : {}),
  };
  const missing = Object.entries(files).filter(([, file]) => !file || !existsSync(file)).map(([label]) => label);
  return { available: missing.length === 0, missing };
}

export function mediaWorkerEnvironment(paths: MediaRuntimePaths, productionRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  // Pass OS/toolchain context, not the parent App's complete environment.
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PATHEXT', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  environment.PATH = [path.dirname(paths.ffmpeg), path.dirname(paths.ffprobe), ...(paths.nodeDirectory ? [paths.nodeDirectory, ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'])] : [process.env.PATH || ''])].join(path.delimiter);
  environment.PYTHONNOUSERSITE = '1';
  environment.PYTHONUTF8 = '1';
  environment.PYTHONUNBUFFERED = '1';
  environment.PYTHONDONTWRITEBYTECODE = '1';
  environment.OPENMONTAGE_PROJECTS_DIR = productionRoot;
  if (paths.browser) environment.OPENMONTAGE_REMOTION_BROWSER = paths.browser;
  if (paths.nodeDirectory) environment.OPENMONTAGE_REMOTION_ENTRY = 'build';
  return environment;
}

async function terminateMediaProcessGroups(pid: number): Promise<void> {
  const signal = (group: number, value: NodeJS.Signals) => {
    try { process.kill(-group, value); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  // Freeze the owned worker group before discovery so Node cannot launch a new
  // detached browser between the process snapshot and termination. Remotion's
  // browser is a separate process group and must be terminated explicitly.
  signal(pid, 'SIGSTOP');
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const processes = output.trim().split('\n').map((line) => {
      const [id, parent, group] = line.trim().split(/\s+/).map(Number);
      return { id, parent, group };
    });
    const descendants = new Set([pid]);
    let previousSize: number;
    do {
      previousSize = descendants.size;
      for (const process of processes) if (descendants.has(process.parent)) descendants.add(process.id);
    } while (descendants.size !== previousSize);
    const groups = new Set(processes.filter((process) => descendants.has(process.id) && descendants.has(process.group)).map((process) => process.group));
    for (const group of groups) if (group !== pid) signal(group, 'SIGKILL');
  } finally {
    signal(pid, 'SIGKILL');
  }
}

function validateRenderInput(input: MediaRenderInput): void {
  if (!input || typeof input.renderId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.renderId)) {
    throw new Error('A valid media render identifier is required.');
  }
  if (!Array.isArray(input.scenes) || input.scenes.length < 1) {
    throw new Error('A render requires at least one scene.');
  }
  let totalBytes = 0;
  for (const scene of input.scenes) {
    if (!scene || !VISUAL_EXTENSIONS[scene.visualMimeType] || !(scene.visual instanceof Uint8Array) || !scene.visual.byteLength
      || (scene.narration !== undefined && (!(scene.narration instanceof Uint8Array) || !scene.narration.byteLength || !AUDIO_EXTENSIONS[scene.narrationMimeType || '']))) {
      throw new Error('Each scene needs a supported visual and valid optional narration.');
    }
    totalBytes += scene.visual.byteLength + (scene.narration?.byteLength || 0);
  }
  if (input.music) {
    if (!AUDIO_EXTENSIONS[input.music.mimeType] || !(input.music.bytes instanceof Uint8Array) || !input.music.bytes.byteLength) throw new Error('Music needs a supported audio format and nonempty bytes.');
    totalBytes += input.music.bytes.byteLength;
  }
  if (totalBytes > MAX_INPUT_BYTES) throw new Error('The current render input exceeds 64 MiB.');
}

type ActiveRender = { child: ChildProcess | null; canceled: boolean; stopping?: Promise<void>; completion: Promise<void>; complete: () => void };

function activeOperation(): ActiveRender {
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => { complete = resolve; });
  return { child: null, canceled: false, completion, complete };
}

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
        if (process.platform !== 'win32') {
          void terminateMediaProcessGroups(child.pid!).then(resolve, reject);
          return;
        }
        const terminate = (retry: boolean) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
            if (error && child.exitCode === null && child.signalCode === null) {
              // A descendant can exit while taskkill traverses the tree. Retry
              // once only while our original worker handle is still running.
              if (retry) terminate(false);
              else reject(error);
            } else resolve();
          });
        };
        terminate(true);
      });
    }
    await render.stopping;
  }

  async dispose(): Promise<void> {
    const operations = [...this.active.entries()];
    await Promise.all(operations.map(([id]) => this.cancel(id)));
    // A stopped child still has a pending result and owned-directory cleanup.
    // Keep the Host alive until that operation has fully released its resources.
    await Promise.all(operations.map(([, operation]) => operation.completion));
  }

  async checkpoint(input: CheckpointInput): Promise<PipelineCheckpoint> {
    if (this.active.size > 0) throw new Error('Wait for the current media operation before saving a checkpoint.');
    await mkdir(this.paths.scratchRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'checkpoint-'));
    const active = activeOperation();
    this.active.set(workspace, active);
    try {
      const result = await this.runWorker(active, workspace, { ...input, operation: 'checkpoint', project_dir: workspace });
      const checkpoint = result.checkpoint as PipelineCheckpoint;
      if (!checkpoint || checkpoint.project_id !== input.projectId || checkpoint.stage !== input.stage || checkpoint.status !== input.status) throw new Error('The checkpoint result does not match the requested transition.');
      return checkpoint;
    } finally {
      try {
        if (path.dirname(workspace) !== this.paths.scratchRoot) throw new Error('Unexpected checkpoint cleanup directory.');
        await rm(workspace, { recursive: true, force: true });
      } finally { this.active.delete(workspace); active.complete(); }
    }
  }

  async pipelineContext(input: { pipelineId?: string; stage?: string }): Promise<PipelineContext> {
    if (this.active.size) throw new Error('Wait for the current media operation before reading pipeline instructions.');
    await mkdir(this.paths.scratchRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'pipeline-'));
    const active = activeOperation();
    this.active.set(workspace, active);
    try {
      const response = await this.runWorker(active, workspace, { operation: 'pipeline-context', ...input });
      const context = response.context as PipelineContext;
      if (!context || !['catalog', 'stage'].includes(context.type)) throw new Error('The pipeline context is incomplete.');
      return context;
    } finally {
      try { await rm(workspace, { recursive: true, force: true }); }
      finally { this.active.delete(workspace); active.complete(); }
    }
  }

  async render(input: MediaRenderInput): Promise<MediaRenderResult> {
    validateRenderInput(input);
    if (this.active.size > 0) throw new Error('A video is already rendering. Wait for it or cancel it first.');
    const readiness = this.inspect();
    if (!readiness.available) throw new Error('Media runtime is not ready: ' + readiness.missing.join(', '));
    const active = activeOperation();
    this.active.set(input.renderId, active);
    let workspace: string | undefined;
    try {
      await mkdir(this.paths.scratchRoot, { recursive: true });
      workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'render-'));
        const scenes: Record<string, unknown>[] = [];
      for (const [index, scene] of input.scenes.entries()) {
        if (active.canceled) throw new Error('Video rendering was canceled.');
          const visual = 'scene-' + index + '.' + VISUAL_EXTENSIONS[scene.visualMimeType];
          const audio = scene.narration ? 'scene-' + index + '.' + AUDIO_EXTENSIONS[scene.narrationMimeType!] : undefined;
          await writeFile(path.join(workspace, visual), scene.visual);
          if (audio) await writeFile(path.join(workspace, audio), scene.narration!);
          scenes.push({ visual, visualMimeType: scene.visualMimeType, audio, durationSeconds: scene.durationSeconds, sourceInSeconds: scene.sourceInSeconds, visualAssetId: scene.visualAssetId, narrationAssetId: scene.narrationAssetId });
      }
      if (active.canceled) throw new Error('Video rendering was canceled.');
        let music: string | undefined;
        if (input.music) {
          if (!AUDIO_EXTENSIONS[input.music.mimeType]) throw new Error('Unsupported music format.');
          music = 'music.' + AUDIO_EXTENSIONS[input.music.mimeType];
          await writeFile(path.join(workspace, music), input.music.bytes);
        }
        const response = await this.runWorker(active, workspace, { operation: 'render', project_dir: workspace, scenes, music, editDecisions: input.editDecisions, subtitles: input.subtitles });
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
        return { bytes, width: 1280, height: 720, durationSeconds: response.durationSeconds, mimeType: 'video/mp4', hasAudio: response.hasAudio === true };
    } finally {
      try {
        if (workspace) {
          if (path.dirname(workspace) !== this.paths.scratchRoot) throw new Error('Unexpected media cleanup directory.');
          await rm(workspace, { recursive: true, force: true });
        }
      } finally { this.active.delete(input.renderId); active.complete(); }
    }
  }

  async prepareAudio(input: AudioPreparationInput): Promise<PreparedAudio> {
    const extension = ({ ...VISUAL_EXTENSIONS, ...AUDIO_EXTENSIONS })[input.mimeType];
    if (!extension || !/^(video|audio)\//.test(input.mimeType) || !(input.bytes instanceof Uint8Array) || !input.bytes.byteLength || input.bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error('Audio preparation requires a supported source up to 128 MiB.');
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId) || this.active.size) throw new Error('Wait for the current media operation before preparing audio.');
    await mkdir(this.paths.scratchRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'audio-'));
    const active = activeOperation(); this.active.set(input.operationId, active);
    try {
      const source = 'source.' + extension;
      await writeFile(path.join(workspace, source), input.bytes);
      const result = await this.runWorker(active, workspace, { operation: 'prepare-audio', project_dir: workspace, source, startSeconds: input.startSeconds, endSeconds: input.endSeconds });
      if (active.canceled) throw new Error('Audio preparation was canceled.');
      const bytes = new Uint8Array(await readFile(path.join(workspace, 'transcription.wav')));
      if (!bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024) throw new Error('Prepared audio exceeds the current Nimi transcription input limit. Select a shorter source range.');
      return { bytes, mimeType: 'audio/wav', durationSeconds: Number(result.durationSeconds), sourceOffsetSeconds: Number(result.sourceOffsetSeconds) };
    } finally {
      try { await rm(workspace, { recursive: true, force: true }); }
      finally { this.active.delete(input.operationId); active.complete(); }
    }
  }

  async exportSubtitles(input: { cues: readonly SubtitleCue[] }): Promise<{ srt: string; vtt: string }> {
    if (this.active.size) throw new Error('Wait for the current media operation before exporting subtitles.');
    await mkdir(this.paths.scratchRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(this.paths.scratchRoot, 'subtitles-'));
    const active = activeOperation(); this.active.set(workspace, active);
    try {
      await this.runWorker(active, workspace, { operation: 'export-subtitles', project_dir: workspace, cues: input.cues });
      return { srt: await readFile(path.join(workspace, 'subtitles.srt'), 'utf8'), vtt: await readFile(path.join(workspace, 'subtitles.vtt'), 'utf8') };
    } finally {
      try { await rm(workspace, { recursive: true, force: true }); }
      finally { this.active.delete(workspace); active.complete(); }
    }
  }

  private runWorker(active: ActiveRender, workspace: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.paths.python, ['-m', 'app_runtime.media_worker'], {
        cwd: this.paths.appRoot, env: mediaWorkerEnvironment(this.paths, workspace), windowsHide: true,
        detached: process.platform !== 'win32',
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
