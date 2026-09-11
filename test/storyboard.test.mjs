import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard, storyboardMessages } from '../src/production/storyboard.ts';

const scene = { title: '场景', narration: '已提供的事实', imagePrompt: '对应事实的画面' };
test('storyboard parsing rejects incomplete and unusable model output before generation', () => {
  assert.throws(() => parseStoryboard('{"title":'), /完整/);
  assert.throws(() => parseStoryboard(JSON.stringify({ title: '短片', scenes: [scene] })), /三个场景/);
  assert.throws(() => parseStoryboard(JSON.stringify({ title: '短片', scenes: [scene, scene, { ...scene, narration: '' }] })), /旁白/);
});
test('a complete fenced storyboard is normalized without inventing missing scenes', () => {
  const result = parseStoryboard('```json\n' + JSON.stringify({ title: ' 短片 ', scenes: [scene, scene, scene] }) + '\n```');
  assert.equal(result.title, '短片');
  assert.equal(result.scenes.length, 3);
  assert.equal(result.scenes[2].narration, scene.narration);
});
test('the planning input keeps supplied source material separate from the directing instruction', () => {
  const messages = storyboardMessages('用户提供的事实', 45);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].text.includes('用户提供的事实'));
  assert.throws(() => storyboardMessages('', 45));
});
