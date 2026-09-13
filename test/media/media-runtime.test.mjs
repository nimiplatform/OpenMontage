import { packagedResources } from './packaged-paths.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MediaRenderer, mediaWorkerEnvironment, resolveMediaRuntimePaths } from '../../src-electron/media-runtime.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resourcesPath = packagedResources(appRoot);

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
    const fixture = spawnSync(paths.python, ['-B', '-c', fixtureScript, scratch], { encoding: 'utf8', windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr);
    const image = new Uint8Array(await readFile(path.join(scratch, 'image.png')));
    const narration = new Uint8Array(await readFile(path.join(scratch, 'audio.wav')));
    const result = await renderer.render({ renderId: 'local-media-test', scenes: [{ visual: image, visualMimeType: 'image/png', narration, narrationMimeType: 'audio/wav' }], music: { bytes: narration, mimeType: 'audio/wav' }, subtitles: { cues: [{ start: 0, end: 0.25, text: 'TEST' }], fontSize: 80, position: 'top-center' } });
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.ok(result.durationSeconds >= 0.5);
    assert.ok(result.bytes.byteLength > 1024);
    assert.equal(Buffer.from(result.bytes).subarray(4, 8).toString(), 'ftyp');
    const captioned = path.join(scratch, 'captioned.mp4'); await writeFile(captioned, result.bytes);
    const whiteRows = (time) => {
      const frame = spawnSync(paths.ffmpeg, ['-v', 'error', '-ss', String(time), '-i', captioned, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(frame.status, 0, frame.stderr.toString());
      const rows = new Set();
      for (let i = 0; i < frame.stdout.length; i += 3) if (frame.stdout[i] > 220 && frame.stdout[i + 1] > 220 && frame.stdout[i + 2] > 220) rows.add(Math.floor(i / 3 / 1280));
      return [...rows];
    };
    const visible = whiteRows(0.1);
    assert.ok(visible.length > 45 && Math.max(...visible) < 180, 'the requested large caption must appear at the top without requiring an original-workflow EDL');
    assert.equal(whiteRows(0.4).length, 0, 'the caption must disappear after its cue ends');
    const silence = spawnSync(paths.python, ['-B', '-c', 'import sys,wave\nwith wave.open(sys.argv[1], "wb") as audio:\n audio.setparams((1,2,24000,0,"NONE","not compressed"))\n audio.writeframes(bytes(24000))', path.join(scratch, 'silent.wav')], { encoding: 'utf8', windowsHide: true });
    assert.equal(silence.status, 0, silence.stderr);
    await assert.rejects(renderer.render({ renderId: 'silent-narration-test', scenes: [{ visual: image, visualMimeType: 'image/png', narration: new Uint8Array(await readFile(path.join(scratch, 'silent.wav'))), narrationMimeType: 'audio/wav' }] }), /effectively silent/);
    const canceled = assert.rejects(renderer.render({ renderId: 'dispose-active-render', scenes: [{ visual: image, visualMimeType: 'image/png', narration, narrationMimeType: 'audio/wav' }] }), /canceled/);
    let mediaWorkStarted = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const directories = await readdir(paths.scratchRoot);
      for (const directory of directories) {
        if (await access(path.join(paths.scratchRoot, directory, 'narration.wav')).then(() => true, () => false)) mediaWorkStarted = true;
      }
      if (mediaWorkStarted) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(mediaWorkStarted, 'the actual media worker must be running before disposal');
    await renderer.dispose();
    assert.deepEqual(await readdir(paths.scratchRoot), [], 'Host disposal waits for owned-directory cleanup');
    await canceled;
  } finally {
    await renderer.dispose();
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    await rm(scratch, { recursive: true, force: true });
  }
});

test('canonical edit trims and reorders real video with a still insert', { timeout: 240000 }, async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-video-test-'));
  const paths = resolveMediaRuntimePaths({ appRoot, scratchRoot: path.join(scratch, 'renders'), packaged: true, resourcesPath });
  const renderer = new MediaRenderer(paths);
  try {
    // A two-color source makes the requested source trim observable in output pixels.
    const fixture = spawnSync(paths.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1:r=30', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(scratch, 'source.mp4')], { encoding: 'utf8', windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr);
    const still = spawnSync(paths.python, ['-B', '-c', 'from PIL import Image; import sys; Image.new("RGB",(320,180),(0,255,0)).save(sys.argv[1])', path.join(scratch, 'still.png')], { encoding: 'utf8', windowsHide: true });
    assert.equal(still.status, 0, still.stderr);
    const result = await renderer.render({ renderId: 'video-source-trim', scenes: [
      { visual: new Uint8Array(await readFile(path.join(scratch, 'still.png'))), visualMimeType: 'image/png', visualAssetId: 'still', durationSeconds: 0.5 },
      { visual: new Uint8Array(await readFile(path.join(scratch, 'source.mp4'))), visualMimeType: 'video/mp4', visualAssetId: 'video', durationSeconds: 2 },
    ], editDecisions: { version: '1.0', render_runtime: 'remotion', cuts: [
      { id: 'blue-only', source: 'video', in_seconds: 1, out_seconds: 1.5 },
      { id: 'green-insert', source: 'still', in_seconds: 0, out_seconds: 0.5, transform: { animation: 'static' } },
    ] } });
    assert.ok(Math.abs(result.durationSeconds - 1) < 0.1);
    const output = path.join(scratch, 'edited.mp4');
    await writeFile(output, result.bytes);
    const pixel = (time) => {
      const frame = spawnSync(paths.ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
      assert.equal(frame.status, 0, frame.stderr.toString()); return frame.stdout;
    };
    const opening = pixel(0.2), ending = pixel(0.8);
    assert.ok(opening[2] > opening[0] + 100, 'opening must be the trimmed blue source, not its red beginning');
    assert.ok(ending[1] > ending[0] + 100 && ending[1] > ending[2] + 100, 'the second cut must be the still insert');
    assert.deepEqual(await readdir(paths.scratchRoot), []);
  } finally {
    await renderer.dispose();
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    await rm(scratch, { recursive: true, force: true });
  }
});

test('invalid inputs fail before starting a render and do not become success', async () => {
  const paths = resolveMediaRuntimePaths({ appRoot, scratchRoot: os.tmpdir(), packaged: true, resourcesPath });
  await assert.rejects(new MediaRenderer(paths).render({ renderId: 'test-render', scenes: [] }), /at least one/);
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
