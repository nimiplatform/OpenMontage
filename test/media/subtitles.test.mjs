import { packagedResources } from './packaged-paths.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaRenderer, resolveMediaRuntimePaths } from '../../src-electron/media-runtime.ts';

test('packaged source-audio preparation trims and converts real media, then releases scratch files', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-source-audio-'));
  const paths = resolveMediaRuntimePaths({ appRoot: process.cwd(), scratchRoot: path.join(scratch, 'work'), packaged: true, resourcesPath: packagedResources(process.cwd()) });
  const renderer = new MediaRenderer(paths);
  try {
    const source = path.join(scratch, 'source.wav');
    // Explicit media fixture: tests conversion, never substitutes for an ASR result.
    const generated = spawnSync(paths.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2', '-ar', '48000', source], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr.toString());
    const prepared = await renderer.prepareAudio({ operationId: 'prepare-audio-test', bytes: new Uint8Array(await readFile(source)), mimeType: 'audio/wav', startSeconds: 0.5, endSeconds: 1.5 });
    assert.equal(prepared.mimeType, 'audio/wav');
    assert.equal(prepared.sourceOffsetSeconds, 0.5);
    assert.ok(Math.abs(prepared.durationSeconds - 1) < 0.01);
    const header = Buffer.from(prepared.bytes);
    assert.equal(header.toString('ascii', 0, 4), 'RIFF');
    const format = header.indexOf(Buffer.from('fmt '));
    assert.equal(header.readUInt16LE(format + 10), 1);
    assert.equal(header.readUInt32LE(format + 12), 16000);
    assert.deepEqual(await readdir(paths.scratchRoot), []);
  } finally { await renderer.dispose(); assert.equal(path.dirname(scratch), path.resolve(os.tmpdir())); await rm(scratch, { recursive: true, force: true }); }
});

test('the original subtitle tool keeps actual segment gaps and Chinese text in SRT and VTT', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-subtitle-test-'));
  const renderer = new MediaRenderer(resolveMediaRuntimePaths({ appRoot: process.cwd(), scratchRoot: scratch, packaged: true, resourcesPath: packagedResources(process.cwd()) }));
  try {
    const result = await renderer.exportSubtitles({ cues: [{ start: 0, end: 1.28, text: '水在流动。' }, { start: 5, end: 6.52, text: '第二段旁白。' }] });
    assert.match(result.srt, /00:00:00,000 --> 00:00:01,280/);
    assert.match(result.srt, /00:00:05,000 --> 00:00:06,520/);
    assert.match(result.srt, /第二段旁白。/);
    assert.equal(result.srt.trim().split(/\r?\n\r?\n/).length, 2);
    assert.ok(result.vtt.startsWith('WEBVTT'));
    await assert.rejects(renderer.exportSubtitles({ cues: [{ start: 2, end: 1, text: 'invalid timing' }] }), /valid start and end/);
    assert.deepEqual(await readdir(scratch), []);
  } finally { await renderer.dispose(); assert.equal(path.dirname(scratch), path.resolve(os.tmpdir())); await rm(scratch, { recursive: true, force: true }); }
});
