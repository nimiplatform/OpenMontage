import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationCues, validateCues } from '../src/production/subtitles.ts';

test('narration subtitles follow the edited placement and measured audio length, not planned scene length', () => {
  const project = { storyboard: { scenes: [{ id: 's1', narration: 'Actual words', durationSeconds: 10 }] }, assets: [{ narration: { durationSeconds: 1.28 } }], artifacts: { edit_decisions: { audio: { narration: { segments: [{ asset_id: 's1-narration', start_seconds: 5 }] } } } } };
  assert.deepEqual(narrationCues(project), [{ start: 5, end: 6.28, text: 'Actual words' }]);
  assert.throws(() => narrationCues({ ...project, assets: [{ narration: {} }] }), /实际时长/);
});

test('invalid or out-of-video subtitle ranges cannot be submitted for composition', () => {
  assert.throws(() => validateCues([{ start: 2, end: 1, text: 'line' }]), /起止时间/);
  assert.throws(() => validateCues([{ start: 0, end: 11, text: 'line' }], 10), /超过成片时长/);
});
