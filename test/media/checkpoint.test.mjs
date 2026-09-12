import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaRenderer, resolveMediaRuntimePaths } from '../../src-electron/media-runtime.ts';

test('the real checkpoint writer rejects skipped approval and missing predecessors', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-checkpoint-test-'));
  const renderer = new MediaRenderer(resolveMediaRuntimePaths({ appRoot: process.cwd(), scratchRoot: scratch, packaged: true, resourcesPath: path.join(process.cwd(), 'dist-electron-package/openmontage-nimi-app-shell-win32-x64/resources') }));
  const input = { pipelineId: 'nimi-image-explainer', projectId: 'checkpoint-contract-test', title: 'Checkpoint validation fixture', stage: 'scene_plan', status: 'completed', artifacts: {}, humanApproved: false, checkpoints: {} };
  try {
    await assert.rejects(renderer.checkpoint(input), /GATE VIOLATION/);
    await assert.rejects(renderer.checkpoint({ ...input, stage: 'compose' }), /PREREQUISITE VIOLATION/);
    const scenePlan = { version: '1.0', scenes: [0, 1, 2].map(index => ({ id: String(index), type: 'generated', description: 'Schema fixture only', start_seconds: index * 10, end_seconds: (index + 1) * 10 })) };
    const waiting = await renderer.checkpoint({ ...input, status: 'awaiting_human', artifacts: { scene_plan: scenePlan } });
    assert.equal(waiting.human_approved, false);
    const approved = await renderer.checkpoint({ ...input, artifacts: { scene_plan: scenePlan }, humanApproved: true, checkpoints: { scene_plan: waiting } });
    assert.equal(approved.status, 'completed');
    assert.equal(approved.human_approved, true);
  } finally {
    await renderer.dispose();
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    await rm(scratch, { recursive: true, force: true });
  }
});
