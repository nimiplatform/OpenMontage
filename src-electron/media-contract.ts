export type MediaSceneInput = {
  readonly visual: Uint8Array;
  readonly visualMimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/webm';
  readonly narration?: Uint8Array;
  readonly narrationMimeType?: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac';
  readonly durationSeconds?: number;
  readonly sourceInSeconds?: number;
  readonly visualAssetId?: string;
  readonly narrationAssetId?: string;
};

export type MediaRenderInput = {
  readonly renderId: string;
  readonly scenes: readonly MediaSceneInput[];
  readonly music?: { bytes: Uint8Array; mimeType: string };
  readonly editDecisions?: Record<string, unknown>;
  readonly subtitles?: { cues: readonly SubtitleCue[]; fontSize: number; position: 'top-center' | 'bottom-center' | 'center' };
};

export type SubtitleCue = { start: number; end: number; text: string };
export type AudioPreparationInput = { operationId: string; bytes: Uint8Array; mimeType: string; startSeconds?: number; endSeconds?: number };
export type PreparedAudio = { bytes: Uint8Array; mimeType: 'audio/wav'; durationSeconds: number; sourceOffsetSeconds: number };

export type MediaRenderResult = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly mimeType: 'video/mp4';
  readonly hasAudio?: boolean;
};

export type MediaAvailability = {
  readonly available: boolean;
  readonly missing: readonly string[];
};

export type OpenMontageMedia = {
  readonly inspect: () => Promise<MediaAvailability>;
  readonly render: (input: MediaRenderInput) => Promise<MediaRenderResult>;
  readonly cancel: (renderId: string) => Promise<void>;
  readonly checkpoint: (input: CheckpointInput) => Promise<PipelineCheckpoint>;
  readonly pipelineContext: (input: { pipelineId?: string; stage?: string }) => Promise<PipelineContext>;
  readonly prepareAudio: (input: AudioPreparationInput) => Promise<PreparedAudio>;
  readonly exportSubtitles: (input: { cues: readonly SubtitleCue[] }) => Promise<{ srt: string; vtt: string }>;
};

export type PipelineStageDefinition = { name: string; gated: boolean; produces: string[]; requires: string[]; tools: string[]; requiredTools: string[] };
export type PipelineDefinition = { id: string; description: string; stability: string; stages: PipelineStageDefinition[] };
export type PipelineContext = { type: 'catalog'; pipelines: PipelineDefinition[] } | { type: 'stage'; pipeline: PipelineDefinition; stage: PipelineStageDefinition; instructions: string; schemas: Record<string, unknown> };

export type ProductionStage = string;
export type PipelineCheckpoint = {
  version: '1.0'; project_id: string; pipeline_type: string;
  stage: ProductionStage; status: 'in_progress' | 'awaiting_human' | 'completed' | 'failed';
  timestamp: string; human_approved: boolean; artifacts: Record<string, unknown>;
  metadata?: Record<string, unknown>; error?: string;
};
export type CheckpointInput = {
  pipelineId: string;
  projectId: string; title: string; stage: ProductionStage; status: PipelineCheckpoint['status'];
  artifacts: Record<string, unknown>; humanApproved: boolean;
  checkpoints: Record<ProductionStage, PipelineCheckpoint>;
  metadata?: Record<string, unknown>; error?: string;
};
