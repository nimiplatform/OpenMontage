import type { NimiLocalAppClient, NimiLocalAppScenarioJob, NimiLocalAppScenarioJobSpec } from '@nimiplatform/sdk';
import type { StoryScene } from './storyboard.js';

export type GeneratedMedia = { readonly artifactId: string; readonly relativePath: string; bytes: Uint8Array; readonly mimeType: string; durationSeconds?: number };
export type SourceTranscription = { jobId?: string; pendingSubmission?: boolean; startSeconds: number; endSeconds: number; language: string; timestamps: boolean; text?: string; originalText?: string; edited?: boolean; error?: string };
export type SourceMedia = { id: string; name: string; relativePath: string; mimeType: string; bytes: Uint8Array; durationSeconds?: number; width?: number; height?: number; referenceArtifactId?: string; transcription?: SourceTranscription; transcriptionRequest?: SourceTranscription };
export type MediaKind = 'image' | 'video' | 'narration' | 'music';
export type SceneGeneration = { imageJobId?: string; videoJobId?: string; narrationJobId?: string; musicJobId?: string; image?: GeneratedMedia; video?: GeneratedMedia; narration?: GeneratedMedia; music?: GeneratedMedia; source?: SourceMedia; pendingSubmission?: MediaKind };

export class ConfigurationChangedError extends Error {}

export async function measureMediaDuration(media: { bytes: Uint8Array; mimeType: string }): Promise<number> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(media.bytes).buffer], { type: media.mimeType }));
  const player = document.createElement(media.mimeType.startsWith('video/') ? 'video' : 'audio');
  try {
    return await new Promise<number>((resolve, reject) => {
      player.onloadedmetadata = () => Number.isFinite(player.duration) && player.duration > 0 ? resolve(player.duration) : reject(new Error('媒体时长无效，请重新读取。'));
      player.onerror = () => reject(new Error('媒体无法解码，请重新读取。'));
      player.preload = 'metadata'; player.src = url;
    });
  } finally { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
}

export async function assertConfiguration(client: NimiLocalAppClient, approvedRevision: string, capability?: string | readonly string[]): Promise<void> {
  const snapshot = await client.aiConfig.get();
  if (snapshot.revision !== approvedRevision) throw new ConfigurationChangedError('AI 配置已更改。请重新确认方案后继续；已完成素材会保留。');
  for (const required of typeof capability === 'string' ? [capability] : capability || []) {
    if (!snapshot.effectiveSelections.some((selection) => selection.capabilityContract === required && selection.state === 'ready')) throw new Error('所需能力 ' + required + ' 尚未就绪，请在 AI 设置中完成配置。');
  }
}

function terminal(job: NimiLocalAppScenarioJob): boolean {
  return ['completed', 'failed', 'canceled', 'timeout'].includes(job.status);
}

export async function completedJob(client: NimiLocalAppClient, job: NimiLocalAppScenarioJob, onStatus: (status: string) => void): Promise<NimiLocalAppScenarioJob> {
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
  kind: MediaKind;
  referenceArtifactId?: string;
  musicLyrics?: string;
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
  const jobKey = ({ image: 'imageJobId', video: 'videoJobId', narration: 'narrationJobId', music: 'musicJobId' } as const)[kind];
  let job = existing[jobKey] ? (await client.ai.scenarioJobs.get(existing[jobKey]!)).job : null;
  if (!job || ['failed', 'canceled', 'timeout'].includes(job.status)) {
    if (input.stopped()) throw new Error('已停止继续生成。');
    const spec: NimiLocalAppScenarioJobSpec = kind === 'image'
      ? { type: 'image-generate', prompt: scene.imagePrompt, negativePrompt: '', n: 1, size: '1280x720', aspectRatio: '16:9', quality: '', style: '', referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '' }
      : kind === 'video'
        ? { type: 'video-generate', prompt: scene.imagePrompt, negativePrompt: '', mode: input.referenceArtifactId ? 'i2v-first-frame' : 't2v', content: [{ type: 'text', role: 'prompt', text: scene.imagePrompt }, ...(input.referenceArtifactId ? [{ type: 'artifact-ref' as const, role: 'first-frame' as const, artifactId: input.referenceArtifactId }] : [])], options: { resolution: '720p', ratio: input.referenceArtifactId ? '' : '16:9', durationSec: Math.round(scene.durationSeconds || 5) } }
        : kind === 'music'
          ? { type: 'music-generate', prompt: scene.imagePrompt, lyrics: input.musicLyrics?.trim() || '', durationSeconds: Math.ceil(scene.durationSeconds || 30) }
          : { type: 'speech-synthesize', text: scene.narration, language: '', audioFormat: 'mp3', emotion: '', voiceRef: input.voiceId ? { type: 'preset', id: input.voiceId } : null, timingMode: 'none', voiceRenderHints: null };
    // Persist uncertainty before submitting: a lost response must not silently cause a second paid job.
    await onChange({ pendingSubmission: kind });
    try {
      await assertConfiguration(client, input.approvedRevision, ({ image: 'image.generate', video: 'video.generate', narration: 'audio.synthesize', music: 'music.generate' })[kind]);
      if (input.stopped()) throw new Error('已停止继续生成。');
    } catch (error) {
      await onChange({ pendingSubmission: undefined });
      throw error;
    }
    try {
      job = (await client.ai.scenarioJobs.submit(spec, { timeoutMs: 240000 })).job;
    } catch (cause) {
      // These exact input rejections happen before the owner creates a Job.
      // Transport loss and output/projection failures remain uncertain.
      const reason = cause && typeof cause === 'object' && 'reasonCode' in cause ? String(cause.reasonCode).toLowerCase() : '';
      if (['sdk_local_app_input_invalid', 'ai-input-invalid', 'ai-media-spec-invalid', 'ai-media-option-unsupported'].includes(reason)) await onChange({ pendingSubmission: undefined });
      throw cause;
    }
    await onChange({ [jobKey]: job.jobId, pendingSubmission: undefined });
  }
  input.onJob(job.jobId);
  try {
    if (input.stopped() && !terminal(job)) job = (await client.ai.scenarioJobs.cancel(job.jobId, 'User requested stop in OpenMontage')).job;
    const completed = await completedJob(client, job, input.onStatus);
    const artifact = completed.artifacts.find((entry) => entry.mimeType.startsWith(kind === 'image' ? 'image/' : kind === 'video' ? 'video/' : 'audio/'));
    if (!artifact) throw new Error('任务已结束，但没有返回需要的' + (kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频') + '产物。');
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' } as Record<string, string>)[artifact.mimeType];
    if (!extension) throw new Error('生成服务返回了当前合成器不支持的素材格式：' + artifact.mimeType);
    const relativePath = 'projects/' + input.projectId + '/assets/' + job.jobId + '.' + extension;
    await client.storage.assets.adoptArtifact({ artifactId: artifact.artifactId, relativePath, overwrite: true });
    const data = await client.storage.assets.read({ relativePath });
    const bytes = new Uint8Array(data.range.length);
    let offset = 0;
    for await (const chunk of data.body) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (offset !== bytes.byteLength) throw new Error('生成素材读取不完整，请继续原任务。');
    const media = { artifactId: artifact.artifactId, relativePath, bytes, mimeType: artifact.mimeType === 'audio/x-wav' ? 'audio/wav' : artifact.mimeType, ...(artifact.durationMs > 0 ? { durationSeconds: artifact.durationMs / 1000 } : {}) };
    if (kind !== 'image' && !media.durationSeconds) {
      media.durationSeconds = await measureMediaDuration(media);
    }
    await onChange({ [kind]: media });
    return media;
  } finally { input.onJob(null); }
}
