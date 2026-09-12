import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { MediaRenderResult, PipelineCheckpoint, ProductionStage } from '../../src-electron/media-contract.js';
import type { SceneGeneration, SourceMedia } from './generation.js';
import type { Storyboard } from './storyboard.js';
import type { SubtitleDraft, SubtitleTrack } from './subtitles.js';

export type ProductionDecision = { at: string; models: string; voice: string; renderer: string; frame: string; scene_count: number };

export type ProductionProject = {
  id: string;
  pipelineId: string;
  artifacts?: Record<string, Record<string, unknown>>;
  visualMode?: 'image' | 'video' | 'mixed';
  clipDurationSeconds?: number;
  narrationEnabled?: boolean;
  sources?: SourceMedia[];
  referenceImageId?: string;
  musicPrompt?: string;
  musicLyrics?: string;
  musicState?: SceneGeneration;
  subtitleDraft?: SubtitleDraft;
  subtitleTrack?: SubtitleTrack;
  material: string;
  duration: number;
  sceneCount?: number;
  activity?: { id: string; at: string; title: string; detail?: string }[];
  decisions?: ProductionDecision[];
  voiceId: string;
  storyboard: Storyboard | null;
  assets: SceneGeneration[];
  needsConfirmation: boolean;
  checkpoints: Record<ProductionStage, PipelineCheckpoint>;
  textTraceId?: string;
  output?: { relativePath: string; width: number; height: number; durationSeconds: number; subtitlesApplied?: boolean };
};
export function recordProductionDecision(project: ProductionProject, decision: ProductionDecision): ProductionDecision[] {
  const decisions = project.decisions || [];
  const previous = decisions.at(-1);
  const fields = ['models', 'voice', 'renderer', 'frame', 'scene_count'] as const;
  return previous && fields.every((field) => previous[field] === decision[field]) ? decisions : [...decisions, decision];
}
export type ProjectSummary = { id: string; title: string; updatedAt: string; posterPath?: string; sceneCount?: number; hasOutput?: boolean; stages?: { stage: string; status: string }[] };
export function projectTitle(project: ProductionProject): string {
  const title = project.storyboard?.title || project.artifacts?.script?.title || project.artifacts?.brief?.title || project.artifacts?.proposal_packet?.title;
  return typeof title === 'string' && title.trim() ? title : '未命名制作';
}
export function summarizeProject(project: ProductionProject): ProjectSummary {
  const posterPath = project.assets.find((asset) => asset.image)?.image?.relativePath;
  return { id: project.id, title: projectTitle(project), updatedAt: new Date().toISOString(), ...(posterPath ? { posterPath } : {}), sceneCount: project.storyboard?.scenes.length || 0, hasOutput: !!project.output, stages: Object.values(project.checkpoints).map((cp) => ({ stage: cp.stage, status: cp.status })) };
}

export function newProductionProject(pipelineId = 'nimi-image-explainer'): ProductionProject {
  return { id: crypto.randomUUID(), pipelineId, material: '', duration: 45, voiceId: '', storyboard: null, assets: [], needsConfirmation: true, checkpoints: {} };
}

export function serializeProject(project: ProductionProject) {
  return JSON.parse(JSON.stringify(project, (key, value: unknown) => key === 'bytes' ? undefined : value));
}

function notFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'not-found';
}

export async function readAsset(client: NimiLocalAppClient, relativePath: string): Promise<Uint8Array> {
  const result = await client.storage.assets.read({ relativePath });
  if (result.asset.sizeBytes > 128 * 1024 * 1024) throw new Error('该素材超过当前预览支持的大小。');
  const bytes = new Uint8Array(result.range.length);
  let offset = 0;
  for await (const chunk of result.body) { bytes.set(chunk, offset); offset += chunk.length; }
  if (offset !== bytes.length) throw new Error('素材读取不完整，请重试打开项目。');
  return bytes;
}

export class ProductionProjectStore {
  private writes: Promise<void> = Promise.resolve();
  private library: ProjectSummary[] = [];
  private savedCheckpoints = new Map<string, ProductionProject['checkpoints']>();

  private readonly client: NimiLocalAppClient;
  constructor(client: NimiLocalAppClient) { this.client = client; }

  async list(): Promise<ProjectSummary[]> {
    try {
      const document = await this.client.storage.readJson('production/library.json');
      if (!Array.isArray(document.value) || document.value.some((entry) => !entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !('title' in entry) || typeof entry.title !== 'string')) {
        throw new Error('项目列表无法读取，未覆盖原有内容。');
      }
      this.library = document.value as ProjectSummary[];
    } catch (error) { if (!notFound(error)) throw error; }
    return this.library;
  }

  async load(id: string): Promise<ProductionProject> {
    const { value } = await this.client.storage.readJson('production/projects/' + id + '.json');
    const project = value as unknown as ProductionProject;
    if (!project || project.id !== id || typeof project.pipelineId !== 'string' || typeof project.material !== 'string' || !Number.isFinite(project.duration) || project.duration <= 0 || !Array.isArray(project.assets) || (project.storyboard ? project.assets.length !== project.storyboard.scenes.length || project.assets.length < 1 : project.assets.length !== 0) || !project.checkpoints || typeof project.checkpoints !== 'object') throw new Error('项目内容不完整，未覆盖原有内容。');
    this.savedCheckpoints.set(id, structuredClone(project.checkpoints));
    for (const scene of project.assets) {
      for (const kind of ['image', 'video', 'narration', 'music', 'source'] as const) {
        const media = scene[kind];
        if (media) media.bytes = await readAsset(this.client, media.relativePath);
      }
    }
    for (const source of project.sources || []) source.bytes = await readAsset(this.client, source.relativePath);
    if (project.musicState?.music) project.musicState.music.bytes = await readAsset(this.client, project.musicState.music.relativePath);
    if (project.musicState?.source) project.musicState.source.bytes = await readAsset(this.client, project.musicState.source.relativePath);
    return project;
  }

  save(project: ProductionProject): Promise<void> {
    const snapshot = serializeProject(project);
    const save = this.writes.then(async () => {
      for (const previous of Object.values(this.savedCheckpoints.get(project.id) || {})) {
        if (previous.status !== 'in_progress' && previous.timestamp !== snapshot.checkpoints[previous.stage]?.timestamp) {
          const stamp = previous.timestamp.replace(/[^A-Za-z0-9]/g, '');
          await this.client.storage.writeJson('production/history/' + project.id + '/checkpoint_' + previous.stage + '_' + stamp + '.json', JSON.parse(JSON.stringify(previous)));
        }
      }
      await this.client.storage.writeJson('production/projects/' + project.id + '.json', snapshot);
      this.savedCheckpoints.set(project.id, snapshot.checkpoints);
      const summary = summarizeProject(project);
      const library = [summary, ...this.library.filter((entry) => entry.id !== project.id)];
      await this.client.storage.writeJson('production/library.json', library);
      this.library = library;
    });
    this.writes = save.catch(() => undefined);
    return save;
  }

  async saveVideo(project: ProductionProject, video: MediaRenderResult, subtitlesApplied = false): Promise<ProductionProject['output']> {
    const relativePath = 'projects/' + project.id + '/renders/' + crypto.randomUUID() + '.mp4';
    await this.client.storage.assets.write({ relativePath, body: video.bytes, mediaType: 'video/mp4' });
    return { relativePath, width: video.width, height: video.height, durationSeconds: video.durationSeconds, subtitlesApplied };
  }

  async readVideo(output: NonNullable<ProductionProject['output']>): Promise<MediaRenderResult> {
    return { ...output, bytes: await readAsset(this.client, output.relativePath), mimeType: 'video/mp4' };
  }
}
