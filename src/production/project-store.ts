import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { MediaRenderResult, PipelineCheckpoint, ProductionStage } from '../../src-electron/media-contract.js';
import type { SceneGeneration } from './generation.js';
import type { Storyboard } from './storyboard.js';

export type ProductionProject = {
  id: string;
  material: string;
  duration: number;
  voiceId: string;
  storyboard: Storyboard | null;
  assets: SceneGeneration[];
  needsConfirmation: boolean;
  checkpoints: Partial<Record<ProductionStage, PipelineCheckpoint>>;
  textTraceId?: string;
  output?: { relativePath: string; width: number; height: number; durationSeconds: number };
};
export type ProjectSummary = { id: string; title: string; updatedAt: string };

export function newProductionProject(): ProductionProject {
  return { id: crypto.randomUUID(), material: '', duration: 45, voiceId: '', storyboard: null, assets: [{}, {}, {}], needsConfirmation: true, checkpoints: {} };
}

export function serializeProject(project: ProductionProject) {
  return JSON.parse(JSON.stringify(project, (key, value: unknown) => key === 'bytes' ? undefined : value));
}

function notFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'not-found';
}

async function readAsset(client: NimiLocalAppClient, relativePath: string): Promise<Uint8Array> {
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
    if (!project || project.id !== id || typeof project.material !== 'string' || ![30, 45, 60].includes(project.duration) || !Array.isArray(project.assets) || project.assets.length !== 3 || !project.checkpoints || typeof project.checkpoints !== 'object') throw new Error('项目内容不完整，未覆盖原有内容。');
    this.savedCheckpoints.set(id, structuredClone(project.checkpoints));
    for (const scene of project.assets) {
      for (const kind of ['image', 'narration'] as const) {
        const media = scene[kind];
        if (media) media.bytes = await readAsset(this.client, media.relativePath);
      }
    }
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
      const summary = { id: project.id, title: project.storyboard?.title || '未命名短片', updatedAt: new Date().toISOString() };
      const library = [summary, ...this.library.filter((entry) => entry.id !== project.id)];
      await this.client.storage.writeJson('production/library.json', library);
      this.library = library;
    });
    this.writes = save.catch(() => undefined);
    return save;
  }

  async saveVideo(project: ProductionProject, video: MediaRenderResult): Promise<ProductionProject['output']> {
    const relativePath = 'projects/' + project.id + '/renders/' + crypto.randomUUID() + '.mp4';
    await this.client.storage.assets.write({ relativePath, body: video.bytes, mediaType: 'video/mp4' });
    return { relativePath, width: video.width, height: video.height, durationSeconds: video.durationSeconds };
  }

  async readVideo(output: NonNullable<ProductionProject['output']>): Promise<MediaRenderResult> {
    return { ...output, bytes: await readAsset(this.client, output.relativePath), mimeType: 'video/mp4' };
  }
}
