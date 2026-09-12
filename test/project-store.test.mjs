import assert from 'node:assert/strict';
import test from 'node:test';
import { newProductionProject, ProductionProjectStore, recordProductionDecision, serializeProject, summarizeProject } from '../src/production/project-store.ts';

test('confirmed decision changes append history while reconfirming identical choices preserves it', () => {
  const choice = { at: '2026-09-12T00:00:00Z', models: 'Selected by the user', voice: 'voice-a', renderer: 'Remotion', frame: '1280 × 720', scene_count: 4 };
  const project = { ...newProductionProject(), decisions: [choice] };
  assert.equal(recordProductionDecision(project, { ...choice, at: '2026-09-12T01:00:00Z' }), project.decisions);
  const revised = recordProductionDecision(project, { ...choice, at: '2026-09-12T02:00:00Z', scene_count: 5 });
  assert.equal(revised.length, 2);
  assert.deepEqual(revised[0], choice);
  assert.equal(project.decisions.length, 1);
});

test('an empty project library entry contains only JSON values accepted by storage', () => {
  const summary = summarizeProject(newProductionProject());
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  assert.equal(summary.sceneCount, 0);
  assert.equal(summary.hasOutput, false);
});

test('project persistence keeps job references and submission uncertainty, excluding binary previews', () => {
  const project = newProductionProject();
  project.assets[0] = {
    imageJobId: 'image-job', pendingSubmission: 'narration',
    image: { artifactId: 'artifact', relativePath: 'projects/project/assets/image.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
  };
  const saved = serializeProject(project);
  assert.equal(saved.assets[0].imageJobId, 'image-job');
  assert.equal(saved.assets[0].pendingSubmission, 'narration');
  assert.equal(saved.assets[0].image.relativePath, 'projects/project/assets/image.png');
  assert.equal('bytes' in saved.assets[0].image, false);
});

test('queued saves preserve accepted stage order and stop the caller on a failed write', async () => {
  const writes = [];
  let rejectNext = true;
  const repository = new ProductionProjectStore({ storage: { writeJson: async (path, value) => {
    if (rejectNext) { rejectNext = false; throw new Error('storage unavailable'); }
    writes.push({ path, value });
  } } });
  const initial = newProductionProject();
  await assert.rejects(repository.save(initial), /storage unavailable/);
  await Promise.all([repository.save({ ...initial, voiceId: 'first' }), repository.save({ ...initial, voiceId: 'second' })]);
  assert.deepEqual(writes.filter((entry) => entry.path.includes('/projects/')).map((entry) => entry.value.voiceId), ['first', 'second']);
});
