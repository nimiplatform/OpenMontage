import type { MediaRenderResult } from '../../src-electron/media-contract.js';
import type { ProductionProject } from './project-store.js';
import { parseStoryboard } from './storyboard.js';

export function scenePlanArtifact(project: ProductionProject) {
  const storyboard = parseStoryboard(JSON.stringify(project.storyboard));
  return {
    version: '1.0',
    scenes: storyboard.scenes.map((scene, index) => ({
      id: 'scene-' + (index + 1), type: 'generated', description: scene.imagePrompt,
      start_seconds: project.duration * index / storyboard.scenes.length, end_seconds: project.duration * (index + 1) / storyboard.scenes.length,
      required_assets: [{ type: 'image', description: scene.imagePrompt, source: 'generate' }, { type: 'narration', description: scene.narration, source: 'generate' }],
    })),
    metadata: { title: storyboard.title, source_material: project.material, narration: storyboard.scenes.map((scene) => scene.narration), voice_id: project.voiceId, timing_basis: 'planning-estimate' },
  };
}

export function assetManifest(project: ProductionProject) {
  const assets: Record<string, unknown>[] = [];
  for (const [index, scene] of project.assets.entries()) {
    const visual = scene.source || scene.video || scene.image;
    if (!visual) throw new Error('场景 ' + (index + 1) + ' 的画面尚未齐备。');
    const sceneId = project.storyboard?.scenes[index]?.id || 'scene-' + (index + 1);
    const add = (media: { relativePath: string; mimeType: string; durationSeconds?: number; artifactId?: string; id?: string }, type: string, tool: string, jobId?: string) => assets.push({
      id: sceneId + '-' + (['image', 'video'].includes(type) ? 'visual' : type), type, path: media.relativePath.slice(('projects/' + project.id + '/').length), scene_id: sceneId,
      source_tool: tool, format: media.mimeType, ...(media.durationSeconds ? { duration_seconds: media.durationSeconds } : {}), ...(jobId ? { generation_summary: 'Nimi Job ' + jobId } : {}),
    });
    add(visual, visual.mimeType.startsWith('video/') ? 'video' : 'image', scene.source ? 'user-provided' : 'nimi.ai.scenarioJobs', scene.videoJobId || scene.imageJobId);
    if (scene.narration) add(scene.narration, 'narration', 'nimi.ai.scenarioJobs', scene.narrationJobId);
    else if (project.narrationEnabled !== false && project.storyboard?.scenes[index]?.narration.trim()) throw new Error('场景旁白尚未齐备。');
  }
  const music = project.musicState?.source || project.musicState?.music;
  if (music) assets.push({ id: 'global-music', type: 'music', path: music.relativePath.slice(('projects/' + project.id + '/').length), scene_id: 'global', source_tool: project.musicState?.source ? 'user-provided' : 'nimi.ai.scenarioJobs', format: music.mimeType, ...(music.durationSeconds ? { duration_seconds: music.durationSeconds } : {}) });
  if (project.subtitleTrack) assets.push({ id: 'project-subtitles', type: 'subtitle', path: project.subtitleTrack.srtPath.slice(('projects/' + project.id + '/').length), scene_id: 'global', source_tool: 'subtitle_gen', format: 'application/x-subrip' });
  return { version: '1.0', assets };
}

export function renderReport(video: MediaRenderResult, output: NonNullable<ProductionProject['output']>) {
  return { version: '1.0', outputs: [{ path: output.relativePath, format: 'mp4', resolution: video.width + 'x' + video.height, duration_seconds: video.durationSeconds, file_size_bytes: video.bytes.byteLength }], verification_notes: ['Local worker verified video and audio streams with FFprobe. Subjective sound quality requires listening.'] };
}
