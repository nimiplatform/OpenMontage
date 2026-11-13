import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationChangedError, generateSceneMedia } from '../src/production/generation.ts';

test('image generation keeps the prompt and count while leaving source geometry to Nimi configuration', async () => {
  let submitted;
  await assert.rejects(generateSceneMedia({
    client: {
      aiConfig: { get: async () => ({ revision: 'approved', effectiveSelections: [{ capabilityContract: 'image.generate', state: 'ready' }] }) },
      ai: { scenarioJobs: { submit: async spec => { submitted = spec; throw new Error('Captured submission'); } } },
    },
    scene: { title: 'scene', narration: 'text', imagePrompt: 'Wide project diagram' }, kind: 'image',
    voiceId: '', projectId: 'project', existing: {}, approvedRevision: 'approved',
    stopped: () => false, onChange: async () => {}, onJob: () => {}, onStatus: () => {},
  }), /Captured submission/);
  assert.equal(submitted.type, 'image-generate');
  assert.equal(submitted.prompt, 'Wide project diagram');
  assert.equal(submitted.n, 1);
  assert.equal(submitted.size, '');
  assert.equal(submitted.aspectRatio, '');
});

test('narration accepts the selected model native audio format and stores the returned WAV', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const changes = [];
  const adopted = [];
  const media = await generateSceneMedia({
    client: {
      aiConfig: { get: async () => ({ revision: 'approved', effectiveSelections: [{ capabilityContract: 'audio.synthesize', state: 'ready' }] }) },
      ai: { scenarioJobs: { submit: async spec => {
        assert.equal(spec.type, 'speech-synthesize');
        assert.equal(spec.text, 'A quiet rainy town.');
        assert.deepEqual(spec.voiceRef, { type: 'preset', id: 'narrator' });
        assert.equal(spec.audioFormat, '', 'Do not force a format the selected model may not support');
        return { job: { jobId: 'speech-job', status: 'completed', artifacts: [{ artifactId: 'speech-artifact', mimeType: 'audio/wav', durationMs: 2000 }] } };
      } } },
      storage: { assets: {
        adoptArtifact: async input => { adopted.push(input); },
        read: async ({ relativePath }) => {
          assert.equal(relativePath, 'projects/project/assets/speech-job.wav');
          return { range: { length: bytes.length }, body: (async function* () { yield bytes; })() };
        },
      } },
    },
    scene: { title: 'scene', narration: 'A quiet rainy town.', imagePrompt: 'Rainy town' }, kind: 'narration',
    voiceId: 'narrator', projectId: 'project', existing: {}, approvedRevision: 'approved',
    stopped: () => false, onChange: async change => { changes.push(change); }, onJob: () => {}, onStatus: () => {},
  });
  assert.deepEqual(adopted, [{ artifactId: 'speech-artifact', relativePath: 'projects/project/assets/speech-job.wav', overwrite: true }]);
  assert.equal(media.mimeType, 'audio/wav');
  assert.equal(media.durationSeconds, 2);
  assert.deepEqual(media.bytes, bytes);
  assert.deepEqual(changes.at(-1), { narration: media });
});

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

test('video prompts use the typed content carrier and explicit input rejection permits correction', async () => {
  const changes = [];
  const rejection = Object.assign(new Error('ai-media-spec-invalid'), { reasonCode: 'ai-media-spec-invalid' });
  await assert.rejects(generateSceneMedia({
    client: { aiConfig: { get: async () => ({ revision: 'approved', effectiveSelections: [{ capabilityContract: 'video.generate', state: 'ready' }] }) }, ai: { scenarioJobs: { submit: async (spec) => {
      assert.deepEqual(spec.content, [{ type: 'text', role: 'prompt', text: 'Natural moving water' }]);
      throw rejection;
    } } } },
    scene: { title: 'scene', narration: '', imagePrompt: 'Natural moving water', durationSeconds: 5 }, kind: 'video', voiceId: '', projectId: 'project', existing: {}, approvedRevision: 'approved',
    stopped: () => false, onChange: async (change) => { changes.push(change); }, onJob: () => {}, onStatus: () => {},
  }), rejection);
  assert.deepEqual(changes, [{ pendingSubmission: 'video' }, { pendingSubmission: undefined }]);
});
