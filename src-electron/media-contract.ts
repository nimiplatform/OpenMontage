export type MediaSceneInput = {
  readonly image: Uint8Array;
  readonly imageMimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly narration: Uint8Array;
  readonly narrationMimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac';
};

export type MediaRenderInput = {
  readonly renderId: string;
  readonly scenes: readonly MediaSceneInput[];
};

export type MediaRenderResult = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly mimeType: 'video/mp4';
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
};

export type ProductionStage = 'scene_plan' | 'assets' | 'compose';
export type PipelineCheckpoint = {
  version: '1.0'; project_id: string; pipeline_type: 'nimi-image-explainer';
  stage: ProductionStage; status: 'in_progress' | 'awaiting_human' | 'completed' | 'failed';
  timestamp: string; human_approved: boolean; artifacts: Record<string, unknown>;
  metadata?: Record<string, unknown>; error?: string;
};
export type CheckpointInput = {
  projectId: string; title: string; stage: ProductionStage; status: PipelineCheckpoint['status'];
  artifacts: Record<string, unknown>; humanApproved: boolean;
  checkpoints: Partial<Record<ProductionStage, PipelineCheckpoint>>;
  metadata?: Record<string, unknown>; error?: string;
};
