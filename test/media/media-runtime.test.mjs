import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MediaRenderer, mediaWorkerEnvironment, resolveMediaRuntimePaths } from '../../src-electron/media-runtime.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resourcesPath = path.join(appRoot, 'dist-electron-package/openmontage-nimi-app-shell-win32-x64/resources');

test('the local media runtime renders actual image/audio inputs to a 720p MP4', { timeout: 240000 }, async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-media-test-'));
  const paths = resolveMediaRuntimePaths({ appRoot, scratchRoot: path.join(scratch, 'renders'), packaged: true, resourcesPath });
  const renderer = new MediaRenderer(paths);
  try {
    assert.deepEqual(renderer.inspect(), { available: true, missing: [] });
    // These are explicitly synthetic media fixtures, not AI success fixtures.
    // The test proves local composition only; it does not prove Nimi generation.
    const fixtureScript = [
      'from PIL import Image',
      'import math, struct, sys, wave',
      'from pathlib import Path',
      'root = Path(sys.argv[1])',
      'Image.new("RGB", (640, 360), (40, 80, 130)).save(root / "image.png")',
      'with wave.open(str(root / "audio.wav"), "wb") as audio:',
      '    audio.setparams((1, 2, 24000, 0, "NONE", "not compressed"))',
      '    audio.writeframes(b"".join(struct.pack("<h", round(4000 * math.sin(2 * math.pi * 440 * frame / 24000))) for frame in range(12000)))',
    ].join('\n');
    const fixture = spawnSync(paths.python, ['-c', fixtureScript, scratch], { encoding: 'utf8', windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr);
    const image = new Uint8Array(await readFile(path.join(scratch, 'image.png')));
    const narration = new Uint8Array(await readFile(path.join(scratch, 'audio.wav')));
    const result = await renderer.render({ renderId: 'local-media-test', scenes: [{ image, imageMimeType: 'image/png', narration, narrationMimeType: 'audio/wav' }] });
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.ok(result.durationSeconds >= 0.5);
    assert.ok(result.bytes.byteLength > 1024);
    assert.equal(Buffer.from(result.bytes).subarray(4, 8).toString(), 'ftyp');
    const silence = spawnSync(paths.python, ['-c', 'import sys,wave\nwith wave.open(sys.argv[1], "wb") as audio:\n audio.setparams((1,2,24000,0,"NONE","not compressed"))\n audio.writeframes(bytes(24000))', path.join(scratch, 'silent.wav')], { encoding: 'utf8', windowsHide: true });
    assert.equal(silence.status, 0, silence.stderr);
    await assert.rejects(renderer.render({ renderId: 'silent-narration-test', scenes: [{ image, imageMimeType: 'image/png', narration: new Uint8Array(await readFile(path.join(scratch, 'silent.wav'))), narrationMimeType: 'audio/wav' }] }), /effectively silent/);
  } finally {
    await renderer.dispose();
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    await rm(scratch, { recursive: true, force: true });
  }
});

test('invalid inputs fail before starting a render and do not become success', async () => {
  const paths = resolveMediaRuntimePaths({ appRoot, scratchRoot: os.tmpdir(), packaged: true, resourcesPath });
  await assert.rejects(new MediaRenderer(paths).render({ renderId: 'test-render', scenes: [] }), /one and twelve/);
});

test('media subprocesses inherit only the selected operating-system environment', () => {
  const name = 'OPENMONTAGE_TEST_PARENT_SECRET';
  const previous = process.env[name];
  process.env[name] = 'must-not-reach-worker';
  try {
    const paths = resolveMediaRuntimePaths({ appRoot, scratchRoot: os.tmpdir(), packaged: true, resourcesPath });
    const environment = mediaWorkerEnvironment(paths, os.tmpdir());
    assert.equal(environment[name], undefined);
    assert.ok(environment.PATH.includes(path.dirname(paths.ffmpeg)));
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});
