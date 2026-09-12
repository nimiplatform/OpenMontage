import type { SubtitleCue } from '../../src-electron/media-contract.js';
import type { ProductionProject } from './project-store.js';

export type SubtitleDraft = { cues: SubtitleCue[]; origin: 'narration' | 'manual'; fontSize: number; position: 'top-center' | 'bottom-center' | 'center' };
export type SubtitleTrack = SubtitleDraft & { srtPath: string; vttPath: string };

export function validateCues(cues: readonly SubtitleCue[], duration?: number): SubtitleCue[] {
  if (!cues.length) throw new Error('请先添加字幕。');
  for (const cue of cues) {
    if (!cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw new Error('字幕需要文字和有效的起止时间。');
    if (duration && cue.end > duration + 0.05) throw new Error('字幕超过成片时长，请调整结束时间。');
  }
  return [...cues].sort((a, b) => a.start - b.start);
}

export function narrationCues(project: ProductionProject): SubtitleCue[] {
  if (!project.storyboard || project.narrationEnabled === false) throw new Error('当前项目没有生成旁白，可添加手动字幕或使用源素材的转写结果。');
  const explicit = project.artifacts?.edit_decisions?.audio as { narration?: { segments: { asset_id: string; start_seconds: number }[] } } | undefined;
  let cursor = 0;
  return project.storyboard.scenes.flatMap((scene, index) => {
    const audio = project.assets[index]?.narration;
    if (!audio || !scene.narration.trim()) return [];
    if (!audio.durationSeconds) throw new Error('这段旁白尚无实际时长，请先加载并试听素材。');
    const sourceId = (scene.id || 'scene-' + (index + 1)) + '-narration';
    const segments = explicit?.narration ? explicit.narration.segments.filter((entry) => entry.asset_id === sourceId) : [{ start_seconds: cursor }];
    cursor += audio.durationSeconds;
    return segments.map((segment) => ({ start: segment.start_seconds, end: segment.start_seconds + audio.durationSeconds!, text: scene.narration }));
  });
}
