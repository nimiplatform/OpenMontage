import assert from 'node:assert/strict';
import test from 'node:test';
import { newProductionProject, ProductionProjectStore, serializeProject } from '../src/production/project-store.ts';

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
