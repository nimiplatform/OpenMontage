import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import { assertConfiguration, completedJob, type SourceMedia, type SourceTranscription } from './generation.js';

export async function transcribeSource(input: {
  client: NimiLocalAppClient; source: SourceMedia; approvedRevision: string;
  options: Pick<SourceTranscription, 'startSeconds' | 'endSeconds' | 'language' | 'timestamps'>;
  restart?: boolean;
  stopped: () => boolean; onJob: (id: string | null) => void; onPreparation: (id: string | null) => void;
  onChange: (state: SourceTranscription) => Promise<void>; onStatus: (status: string) => void;
}): Promise<void> {
  const { client, options, source } = input;
  const previous = source.transcriptionRequest || source.transcription;
  if (previous?.pendingSubmission) throw new Error('上次转写提交结果不确定，请先在 Nimi 核对任务，不能盲目重复提交。');
  const same = !input.restart && previous && (['startSeconds', 'endSeconds', 'language', 'timestamps'] as const).every((key) => previous[key] === options[key]);
  let state: SourceTranscription = same ? { ...previous } : { ...options };
  let job = previous?.jobId ? (await client.ai.scenarioJobs.get(previous.jobId)).job : null;
  if (!same && job && !['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) throw new Error('原转写任务仍在运行，请先继续或取消原任务，再更改范围。');
  if (!same) job = null;
  if (!job || ['failed', 'canceled', 'timeout'].includes(job.status)) {
    await assertConfiguration(client, input.approvedRevision, 'audio.transcribe');
    if (input.stopped()) throw new Error('已停止转写。');
    const operationId = crypto.randomUUID(); input.onPreparation(operationId);
    let audio;
    try { audio = await window.openMontageMedia!.prepareAudio({ operationId, bytes: source.bytes, mimeType: source.mimeType, startSeconds: options.startSeconds, endSeconds: options.endSeconds }); }
    finally { input.onPreparation(null); }
    if (input.stopped()) throw new Error('已停止转写。');
    state = { ...options, pendingSubmission: true }; await input.onChange(state);
    try {
      await assertConfiguration(client, input.approvedRevision, 'audio.transcribe');
      if (input.stopped()) throw new Error('已停止转写。');
    } catch (cause) { await input.onChange({ ...state, pendingSubmission: false }); throw cause; }
    try {
      job = (await client.ai.scenarioJobs.submit({ type: 'speech-transcribe', mimeType: audio.mimeType, language: options.language.trim(), timestamps: options.timestamps, prompt: '', responseFormat: options.timestamps ? 'json' : 'text', audioSource: { type: 'bytes', bytes: [...audio.bytes] } }, { timeoutMs: 240000 })).job;
    } catch (cause) {
      const reason = cause && typeof cause === 'object' && 'reasonCode' in cause ? String(cause.reasonCode).toLowerCase() : '';
      if (['sdk_local_app_input_invalid', 'ai-input-invalid', 'ai-media-spec-invalid', 'ai-media-option-unsupported'].includes(reason)) await input.onChange({ ...state, pendingSubmission: false });
      throw cause;
    }
    state = { ...options, jobId: job.jobId }; await input.onChange(state);
  }
  input.onJob(job.jobId);
  try {
    if (input.stopped() && !['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) job = (await client.ai.scenarioJobs.cancel(job.jobId, 'User stopped OpenMontage transcription')).job;
    const result = await completedJob(client, job, input.onStatus);
    if (!result.transcriptionText.trim()) throw new Error('转写任务已结束，但服务没有返回转写文本。请检查原任务结果。');
    await input.onChange({ ...state, text: same && previous?.edited ? previous.text : result.transcriptionText, originalText: result.transcriptionText, edited: same ? previous?.edited : false, error: undefined });
  } finally { input.onJob(null); }
}
