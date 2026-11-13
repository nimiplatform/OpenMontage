import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdir, mkdtemp, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
await mkdir('.nimi/local/test', { recursive: true });
await build({ entryPoints: ['src-electron/remote-media.ts'], outfile: '.nimi/local/test/remote-media.mjs', bundle: true, platform: 'node', format: 'esm' });
const { RemoteMediaProvider } = await import(pathToFileURL(path.resolve('.nimi/local/test/remote-media.mjs')));

// A protocol/ownership regression. No fixture worker output is product evidence.
test('staged media and operation IDs stay with their real caller; uncertain work is never repeated', async () => {
  const root = await mkdtemp(path.resolve('.nimi/local/test/openmontage-remote-'));
  const calls = [], completions = new Map(); let deliver, sequence = 0, renderCount = 0;
  const drain = () => { if (deliver && calls.length) { const resolve = deliver; deliver = undefined; resolve({ calls: [calls.shift()] }); } };
  const services = { integration: {
    registerProvider: async input => { assert.equal(input.integrationId, 'openmontage.media.v1'); },
    pollProvider: () => new Promise(resolve => { deliver = resolve; drain(); }),
    completeProvider: async output => { completions.get(output.callId)(output); completions.delete(output.callId); },
  } };
  const provider = new RemoteMediaProvider(services, {
    render: async () => { renderCount++; throw new Error('fixture: media worker failed'); },
    dispose: async () => {},
  }, root);
  const invoke = (consumerRef, operation, input) => new Promise(resolve => {
    const callId = String(++sequence); completions.set(callId, resolve);
    calls.push({ callId, consumerRef, operation, inputJson: JSON.stringify(input) }); drain();
  });
  const success = async (operation, input) => { const output = await invoke('owner-a', operation, input); assert.equal(output.errorCode, ''); return JSON.parse(output.resultJson); };
  try {
    const { id } = await success('upload', { action: 'begin', size: 4, mimeType: 'image/png' });
    assert.equal((await invoke('owner-b', 'upload', { action: 'append', id, offset: 0, data: 'dGVzdA==' })).errorCode, 'OPENMONTAGE_MEDIA_FAILED');
    assert.equal((await invoke('owner-a', 'upload', { action: 'finish', id })).errorCode, 'OPENMONTAGE_MEDIA_FAILED');
    assert.equal((await invoke('owner-a', 'upload', { action: 'append', id, offset: 1, data: 'dGVzdA==' })).errorCode, 'OPENMONTAGE_MEDIA_FAILED');
    await success('upload', { action: 'append', id, offset: 0, data: 'dGVzdA==' });
    await success('upload', { action: 'finish', id });
    const chunk = await success('result.read', { id, offset: 0 });
    assert.equal(Buffer.from(chunk.data, 'base64').toString(), 'test');
    assert.equal(chunk.nextOffset, 4);
    assert.match(chunk.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal((await invoke('owner-b', 'result.read', { id, offset: 0 })).errorCode, 'OPENMONTAGE_MEDIA_FAILED');
    const request = { renderId: 'render-original', scenes: [{ visual: id }] };
    await success('render.start', request);
    const state = await success('operation.read', { id: request.renderId });
    assert.equal(state.state, 'failed');
    assert.match(state.error, /media worker failed/);
    const other = await invoke('owner-b', 'operation.read', { id: request.renderId });
    const missing = await invoke('owner-a', 'operation.read', { id: 'missing-operation' });
    assert.deepEqual(JSON.parse(other.resultJson), { state: 'unknown' });
    assert.equal(other.resultJson, missing.resultJson);
    assert.equal((await invoke('owner-a', 'render.start', request)).errorCode, 'OPENMONTAGE_MEDIA_FAILED');
    assert.equal(renderCount, 1);
  } finally { await provider.close(); }
  await assert.rejects(access(root));
});
