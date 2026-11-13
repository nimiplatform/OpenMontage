import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiError } from '@nimiplatform/sdk/types';
import { newProductionProject, ProductionProjectStore, recordProductionDecision, serializeProject, summarizeProject } from '../src/production/project-store.ts';
import { renderInputKey } from '../src/production/render-recovery.ts';

test('reading the same completed render cannot duplicate or overwrite its saved media', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const files = new Map();
  const repository = new ProductionProjectStore({storage:{assets:{
    write: async input => { if(files.has(input.relativePath))throw createNimiError({reasonCode:'APP_STORAGE_ENTRY_ALREADY_EXISTS',message:'exists',source:'runtime'}); files.set(input.relativePath,{sha256:digest,sizeBytes:bytes.length,mediaType:'video/mp4'}); },
    stat: async file => files.get(file),
  }}});
  const project = newProductionProject();
  const video = {bytes,mimeType:'video/mp4',width:1280,height:720,durationSeconds:1};
  const first = await repository.saveVideo(project,video,false,'render-identity');
  assert.deepEqual(await repository.saveVideo(project,video,false,'render-identity'),first);
  assert.equal(files.size,1);
  await assert.rejects(repository.saveVideo(project,{...video,bytes:new Uint8Array([4])},false,'render-identity'),/不一致/);
  assert.equal(files.size,1);
});

test('recovery distinguishes changed production inputs from progress-only updates', () => {
  const project = newProductionProject();
  project.storyboard = {title:'Original',scenes:[{title:'Scene',narration:'Hello',imagePrompt:'A library'}]};
  const inputKey = renderInputKey(project);
  project.activity = [{id:'activity',at:'2026-11-14T00:00:00Z',title:'Progress'}];
  assert.equal(renderInputKey(project),inputKey);
  project.storyboard.scenes[0].imagePrompt = 'A different scene';
  assert.notEqual(renderInputKey(project),inputKey);
  project.pendingRender = {id:'render-identity',targetRef:'original-pc',inputKey,subtitlesApplied:false};
  assert.deepEqual(serializeProject(project).pendingRender,project.pendingRender);
});

test('a new registered workspace handles only the canonical missing-index reason as empty', async () => {
  const missing = new ProductionProjectStore({ storage: { readJson: async () => { throw createNimiError({ reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND', message: 'local app storage operation failed', source: 'runtime' }); } } });
  assert.deepEqual(await missing.list(), []);
  const unavailable = new ProductionProjectStore({ storage: { readJson: async () => { throw createNimiError({ reasonCode: 'APP_STORAGE_UNAVAILABLE', message: 'local app storage operation failed', source: 'runtime' }); } } });
  await assert.rejects(unavailable.list(), error => error.reasonCode === 'APP_STORAGE_UNAVAILABLE');
});

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
