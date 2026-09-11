import type { NimiLocalAppClient, NimiLocalAppScenarioJob, NimiLocalAppScenarioJobSpec } from '@nimiplatform/sdk';
import type { StoryScene } from './storyboard.js';

export type GeneratedMedia = { readonly artifactId: string; readonly relativePath: string; bytes: Uint8Array; readonly mimeType: string };
export type SceneGeneration = { imageJobId?: string; narrationJobId?: string; image?: GeneratedMedia; narration?: GeneratedMedia; pendingSubmission?: 'image' | 'narration' };

export class ConfigurationChangedError extends Error {}

export async function assertConfiguration(client: NimiLocalAppClient, approvedRevision: string, capability?: string): Promise<void> {
  const snapshot = await client.aiConfig.get();
  if (snapshot.revision !== approvedRevision) throw new ConfigurationChangedError('AI 配置已更改。请重新确认方案后继续；已完成素材会保留。');
  if (capability && !snapshot.effectiveSelections.some((selection) => selection.capabilityContract === capability && selection.state === 'ready')) {
    throw new Error('所需生成能力尚未就绪，请在 AI 设置中完成配置。');
  }
}

function terminal(job: NimiLocalAppScenarioJob): boolean {
  return ['completed', 'failed', 'canceled', 'timeout'].includes(job.status);
}

async function completedJob(client: NimiLocalAppClient, job: NimiLocalAppScenarioJob, onStatus: (status: string) => void): Promise<NimiLocalAppScenarioJob> {
  let current = job;
  if (!terminal(current)) {
    const stream = await client.ai.scenarioJobs.subscribe(current.jobId);
    try {
      for await (const event of stream) {
        current = event.job;
        onStatus(current.status);
        if (terminal(current)) break;
      }
    } finally { await stream.cancel(); }
  }
  if (!terminal(current)) current = (await client.ai.scenarioJobs.get(current.jobId)).job;
  if (current.status !== 'completed') throw new Error(current.reasonDetail || current.reasonCode || '任务尚未确认完成：' + current.status);
  return current;
}

export async function generateSceneMedia(input: {
  client: NimiLocalAppClient;
  scene: StoryScene;
  kind: 'image' | 'narration';
  voiceId: string;
  projectId: string;
  existing: SceneGeneration;
  approvedRevision: string;
  stopped: () => boolean;
  onChange: (change: Partial<SceneGeneration>) => Promise<void>;
  onJob: (jobId: string | null) => void;
  onStatus: (status: string) => void;
}): Promise<GeneratedMedia> {
  const { client, scene, kind, existing, onChange } = input;
  const retained = existing[kind];
  if (retained) return retained;
  if (existing.pendingSubmission) throw new Error('上次提交结果不确定，已暂停这一步，避免重复生成和计费。请先在 Nimi 中核对任务；修改该项会开始一次新生成。');
  if (input.stopped()) throw new Error('已停止继续生成。');
  const jobKey = kind === 'image' ? 'imageJobId' : 'narrationJobId';
  let job = existing[jobKey] ? (await client.ai.scenarioJobs.get(existing[jobKey]!)).job : null;
  if (!job || ['failed', 'canceled', 'timeout'].includes(job.status)) {
    if (input.stopped()) throw new Error('已停止继续生成。');
    const spec: NimiLocalAppScenarioJobSpec = kind === 'image'
      ? { type: 'image-generate', prompt: scene.imagePrompt, negativePrompt: '', n: 1, size: '1280x720', aspectRatio: '16:9', quality: '', style: '', referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '' }
      : { type: 'speech-synthesize', text: scene.narration, language: '', audioFormat: 'mp3', emotion: '', voiceRef: input.voiceId ? { type: 'preset', id: input.voiceId } : null, timingMode: 'none', voiceRenderHints: null };
    // Persist uncertainty before submitting: a lost response must not silently cause a second paid job.
    await onChange({ pendingSubmission: kind });
    try {
      await assertConfiguration(client, input.approvedRevision, kind === 'image' ? 'image.generate' : 'audio.synthesize');
      if (input.stopped()) throw new Error('已停止继续生成。');
    } catch (error) {
      await onChange({ pendingSubmission: undefined });
      throw error;
    }
    job = (await client.ai.scenarioJobs.submit(spec, { timeoutMs: 240000 })).job;
    await onChange({ [jobKey]: job.jobId, pendingSubmission: undefined });
  }
  input.onJob(job.jobId);
  try {
    if (input.stopped() && !terminal(job)) job = (await client.ai.scenarioJobs.cancel(job.jobId, 'User requested stop in OpenMontage')).job;
    const completed = await completedJob(client, job, input.onStatus);
    const artifact = completed.artifacts.find((entry) => entry.mimeType.startsWith(kind === 'image' ? 'image/' : 'audio/'));
    if (!artifact) throw new Error('任务已结束，但没有返回需要的' + (kind === 'image' ? '图片' : '音频') + '产物。');
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' } as Record<string, string>)[artifact.mimeType];
    if (!extension) throw new Error('生成服务返回了当前合成器不支持的素材格式：' + artifact.mimeType);
    const relativePath = 'projects/' + input.projectId + '/assets/' + job.jobId + '.' + extension;
    await client.storage.assets.adoptArtifact({ artifactId: artifact.artifactId, relativePath, overwrite: true });
    const data = await client.ai.artifacts.read(artifact.artifactId);
    const media = { artifactId: artifact.artifactId, relativePath, bytes: data.bytes, mimeType: data.mimeType === 'audio/x-wav' ? 'audio/wav' : data.mimeType };
    await onChange({ [kind]: media });
    return media;
  } finally { input.onJob(null); }
}
