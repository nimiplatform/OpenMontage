import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationChangedError, generateSceneMedia } from '../src/production/generation.ts';

test('a configuration change during the durable pre-submit save prevents consumption', async () => {
  let revision = 'approved';
  let submitted = false;
  const changes = [];
  await assert.rejects(generateSceneMedia({
    client: { aiConfig: { get: async () => ({ revision, effectiveSelections: [] }) }, ai: { scenarioJobs: { submit: async () => { submitted = true; throw new Error('Must not submit'); } } } },
    scene: { title: 'scene', narration: 'source text', imagePrompt: 'source picture' }, kind: 'image', voiceId: '', projectId: 'project', existing: {}, approvedRevision: 'approved',
    stopped: () => false, onJob: () => {}, onStatus: () => {},
    onChange: async (change) => { changes.push(change); if (change.pendingSubmission) revision = 'changed'; },
  }), ConfigurationChangedError);
  assert.equal(submitted, false);
  assert.deepEqual(changes, [{ pendingSubmission: 'image' }, { pendingSubmission: undefined }]);
});

test('an uncertain persisted submission cannot automatically be submitted again', async () => {
  let called = false;
  await assert.rejects(generateSceneMedia({
    client: { ai: { scenarioJobs: { submit: async () => { called = true; } } } },
    scene: { title: 'scene', narration: 'text', imagePrompt: 'image' }, kind: 'narration', voiceId: '', projectId: 'project', existing: { pendingSubmission: 'narration' }, approvedRevision: 'approved',
    stopped: () => false, onChange: async () => {}, onJob: () => {}, onStatus: () => {},
  }), /结果不确定/);
  assert.equal(called, false);
});
