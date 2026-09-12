import assert from 'node:assert/strict';
import test from 'node:test';
import { stageMessages, storyboardFromArtifacts } from '../src/production/pipeline-workflow.ts';

const documents = {
  script: { title: 'Source-led clip', sections: [{ id: 'intro', text: 'The approved spoken words.' }] },
  scene_plan: { scenes: [{ id: 'opening', script_section_id: 'intro', start_seconds: 0, end_seconds: 5, required_assets: [
    { type: 'video', source: 'provided', source_asset_id: 'source-1', description: 'A real source clip' },
    { type: 'narration', source: 'generate', description: 'Calm warm voice; do not read this direction' },
  ] }] },
};
test('original scene plans preserve the actual script and selected source rather than speaking production directions', () => {
  const plan = storyboardFromArtifacts(documents, 'fallback');
  assert.equal(plan.scenes[0].narration, 'The approved spoken words.');
  assert.equal(plan.scenes[0].sourceAssetId, 'source-1');
  assert.equal(plan.scenes[0].visualKind, 'video');
});
test('unported layers cannot silently disappear from the original scene plan', () => {
  const layered = structuredClone(documents);
  layered.scene_plan.scenes[0].required_assets.push({ type: 'diagram', source: 'generate', description: 'Explanatory overlay' });
  assert.throws(() => storyboardFromArtifacts(layered, ''), /未被自动降级/);
});

test('all stage prompts fit the published text-turn message shape', () => {
  const project = { material: 'A short source-led video', duration: 15, voiceId: '', checkpoints: {} };
  for (const name of ['idea', 'script', 'scene_plan', 'edit']) {
    const messages = stageMessages(project, { type: 'stage', stage: { name }, instructions: 'Director contract', schemas: {} }, 'User-selected models');
    assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
    for (const message of messages) assert.equal(message.text, message.text.trim());
  }
});
