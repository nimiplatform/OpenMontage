import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { runRuntimeAIConsumeCapability } from '@nimiplatform/kit/features/generation/runtime';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.nimi/local'), { recursive: true });
const temporary = mkdtempSync(path.join(root, '.nimi/local/studio-text-test-'));
test.after(() => rmSync(temporary, { recursive: true, force: true }));
const output = path.join(temporary, 'runtime.mjs');
await build({ entryPoints: [path.join(root, 'src/capabilities/studio-create/runtime.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { studioCreateRuntimeHandlers } = await import(pathToFileURL(output).href);

async function runStream(events) {
  const partials = [];
  let canceled = 0;
  const result = await studioCreateRuntimeHandlers['chat.stream']({
    capability: { id: 'chat.stream', label: 'Text stream' },
    prompt: 'Say hello', scenarioId: 'stream-regression',
    input: { onPartial: (text) => partials.push(text) },
    host: {
      appId: 'openmontage.studio', surfaceId: 'studio',
      client: { ai: { text: { streamTurn: async () => ({
        async *[Symbol.asyncIterator]() { yield* events; },
        async cancel() { canceled += 1; },
      }) } } },
      runners: { aiConsume: runRuntimeAIConsumeCapability },
      nonSuccess: (capability, reason, message, diagnostics) => ({ ok: false, capabilityId: capability.id, reason, message, diagnostics }),
    },
  });
  return { result, partials, canceled };
}

const delta = (sequence, text) => ({ type: 'delta', sequence, traceId: 'stream-trace', itemIndex: 0, text });

test('one-turn text continues past opaque state without displaying or completing on it', async () => {
  const { result, partials, canceled } = await runStream([
    delta('1', 'hello '),
    { type: 'reasoning-continuity', sequence: '2', traceId: 'stream-trace', itemIndex: 1, carrier: { kind: 'test.opaque', version: 1, payload: [1, 2] } },
    delta('3', 'world'),
    { type: 'completed', sequence: '4', traceId: 'stream-trace', finishReason: 'stop' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.output.text, 'hello world');
  assert.deepEqual(partials, ['hello ', 'hello world']);
  assert.equal(canceled, 1);
});

for (const event of [
  { type: 'tool-call', sequence: '2', traceId: 'stream-trace', itemIndex: 1, toolCall: { id: 'call-1', name: 'undeclared', arguments: {} } },
  { type: 'completed', sequence: '2', traceId: 'stream-trace', finishReason: 'tool-calls' },
]) {
  test(`text-only output rejects ${event.type} tool output instead of reporting success`, async () => {
    const { result, canceled } = await runStream([delta('1', 'partial'), event]);
    assert.equal(result.ok, false);
    assert.match(result.message, /undeclared tool output/);
    assert.equal(canceled, 1);
  });
}
