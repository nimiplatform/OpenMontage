import type { MediaRenderResult } from '../../src-electron/media-contract.js';
import type { ProductionProject } from './project-store.js';
import { parseStoryboard } from './storyboard.js';

export function scenePlanArtifact(project: ProductionProject) {
  const storyboard = parseStoryboard(JSON.stringify(project.storyboard));
  return {
    version: '1.0',
    scenes: storyboard.scenes.map((scene, index) => ({
      id: 'scene-' + (index + 1), type: 'generated', description: scene.imagePrompt,
      start_seconds: project.duration * index / 3, end_seconds: project.duration * (index + 1) / 3,
      required_assets: [{ type: 'image', description: scene.imagePrompt, source: 'generate' }, { type: 'narration', description: scene.narration, source: 'generate' }],
    })),
    metadata: { title: storyboard.title, source_material: project.material, narration: storyboard.scenes.map((scene) => scene.narration), voice_id: project.voiceId, timing_basis: 'planning-estimate' },
  };
}

export function assetManifest(project: ProductionProject) {
  return { version: '1.0', assets: project.assets.flatMap((scene, index) => {
    if (!scene.image || !scene.narration) throw new Error('素材未齐备，不能完成素材阶段。');
    return (['image', 'narration'] as const).map((kind) => ({
      id: scene[kind]!.artifactId, type: kind, path: scene[kind]!.relativePath.slice(('projects/' + project.id + '/').length),
      scene_id: 'scene-' + (index + 1), source_tool: 'nimi.ai.scenarioJobs', format: scene[kind]!.mimeType,
      generation_summary: 'Nimi Job ' + (kind === 'image' ? scene.imageJobId : scene.narrationJobId),
    }));
  }) };
}

export function renderReport(video: MediaRenderResult, output: NonNullable<ProductionProject['output']>) {
  return { version: '1.0', outputs: [{ path: output.relativePath, format: 'mp4', resolution: video.width + 'x' + video.height, duration_seconds: video.durationSeconds, file_size_bytes: video.bytes.byteLength }], verification_notes: ['Local worker verified video and audio streams with FFprobe. Subjective sound quality requires listening.'] };
}
