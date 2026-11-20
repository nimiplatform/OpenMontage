import type { ProductionProject } from './project-store.js';

export type PendingRender = {
  id: string;
  targetRef: string;
  inputKey: string;
  subtitlesApplied: boolean;
};

export class MediaOperationStateError extends Error {
  readonly mediaState: 'failed' | 'unknown' | 'unconfirmed';
  constructor(mediaState: 'failed' | 'unknown' | 'unconfirmed', message: string) {
    super(message);
    this.mediaState = mediaState;
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonicalJson(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .flatMap(key => {
          const entry = (value as Record<string, unknown>)[key];
          return entry === undefined ? [] : [[key, canonicalJson(entry)]];
        }),
    );
  }
  return value;
}

/** Identity of the reviewed inputs; status, activity, key order and save times are not render inputs. */
export function renderInputKey(project: ProductionProject): string {
  const media = (value: { relativePath: string; mimeType: string } | undefined) => value
    ? [value.relativePath, value.mimeType] : null;
  return JSON.stringify(canonicalJson([
    project.pipelineId, project.storyboard, project.narrationEnabled,
    project.assets.map(scene => [media(scene.source), media(scene.video), media(scene.image), media(scene.narration)]),
    media(project.musicState?.source || project.musicState?.music),
    project.artifacts?.edit_decisions, project.subtitleTrack,
  ]));
}
