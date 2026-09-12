import assert from 'node:assert/strict';
import test from 'node:test';
import { retainSceneAssets } from '../src/production/scene-revision.ts';

const scene = { id: 'opening', title: 'Opening', narration: 'Approved narration', imagePrompt: 'A shoreline', visualKind: 'video', sourceAssetId: 'source-a', durationSeconds: 5 };
const media = { source: { id: 'source-a' }, narration: { artifactId: 'voice-a' }, narrationJobId: 'voice-job' };
const board = (scenes) => ({ title: 'Film', scenes });

test('changing source or switching to generation cannot reuse the previous source video', () => {
  for (const change of [{ sourceAssetId: 'source-b' }, { sourceAssetId: undefined }, { sourceAssetId: undefined, visualKind: 'image' }]) {
    const [retained] = retainSceneAssets(board([scene]), [media], board([{ ...scene, ...change }]));
    assert.equal(retained.source, undefined);
    assert.equal(retained.narration, media.narration);
  }
});

test('reordered scenes retain matching identities and unresolved submissions', () => {
  const other = { ...scene, id: 'closing' };
  const pending = { pendingSubmission: 'narration', source: { id: 'source-a' } };
  const retained = retainSceneAssets(board([scene, other]), [media, pending], board([other, scene]));
  assert.equal(retained[0].pendingSubmission, 'narration');
  assert.equal(retained[1].narration, media.narration);
});

test('changing generated video duration invalidates the old clip but preserves speech', () => {
  const generated = { ...scene, sourceAssetId: undefined };
  const [retained] = retainSceneAssets(board([generated]), [{ ...media, source: undefined, video: { artifactId: 'clip' }, videoJobId: 'clip-job' }], board([{ ...generated, durationSeconds: 10 }]));
  assert.equal(retained.video, undefined);
  assert.equal(retained.videoJobId, undefined);
  assert.equal(retained.narration, media.narration);
});
