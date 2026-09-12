import type { SceneGeneration } from './generation.js';
import type { Storyboard } from './storyboard.js';

/** Retain media only when the revised scene still requests the same input. */
export function retainSceneAssets(previous: Storyboard | null, assets: readonly SceneGeneration[], next: Storyboard): SceneGeneration[] {
  return next.scenes.map((scene, index) => {
    const previousIndex = scene.id ? previous?.scenes.findIndex((old) => old.id === scene.id) ?? -1 : index;
    const old = previous?.scenes[previousIndex];
    const retained = assets[previousIndex];
    if (!old || !retained) return {};
    const sameVisual = old.imagePrompt === scene.imagePrompt
      && old.sourceAssetId === scene.sourceAssetId
      && (old.visualKind || 'image') === (scene.visualKind || 'image')
      && (scene.sourceAssetId || scene.visualKind !== 'video' || old.durationSeconds === scene.durationSeconds);
    const sameNarration = old.narration === scene.narration;
    return {
      ...(sameVisual ? { image: retained.image, video: retained.video, imageJobId: retained.imageJobId, videoJobId: retained.videoJobId, source: retained.source } : {}),
      ...(sameNarration ? { narration: retained.narration, narrationJobId: retained.narrationJobId } : {}),
      ...(retained.pendingSubmission && (retained.pendingSubmission === 'narration' ? sameNarration : sameVisual) ? { pendingSubmission: retained.pendingSubmission } : {}),
    };
  });
}
