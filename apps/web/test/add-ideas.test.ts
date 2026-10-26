import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsAddIdeas, parseIdeaFile } from '../src/data/backlog.ts';
import { column } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);

test('an ideas file is read as a list or under "ideas", and bad files say why', () => {
  assert.equal(parseIdeaFile('[{"title":"A"}]').length, 1);
  const items = parseIdeaFile('{"ideas":[{"title":" B ","note":"why","done_means":"done"},{"note":"no title"}]}');
  assert.deepEqual(items, [{ title: 'B', note: 'why', done_means: 'done' }]);
  assert.throws(() => parseIdeaFile('nope'), /valid JSON/);
  assert.throws(() => parseIdeaFile('{"goals":[]}'), /no list of ideas/);
  assert.throws(() => parseIdeaFile('[{"note":"x"}]'), /no ideas with a title/);
});

test('ideas join the end of the backlog in order, skipping names already taken', () => {
  const d = emptyData();
  d.goals = [{ id: 'g', title: 'Lose weight', type: 'number', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null }];
  const first = opsAddIdeas(d, [{ title: 'Old idea' }]);
  const before = run(d, first.ops);
  const { ops, added, skipped } = opsAddIdeas(before, [{ title: 'lose weight' }, { title: 'A', done_means: 'x' }, { title: 'B' }, { title: 'a' }, { title: 'old idea' }]);
  assert.deepEqual(added, ['A', 'B']);
  assert.deepEqual(skipped, ['lose weight', 'a', 'old idea']);
  const after = run(before, ops);
  assert.deepEqual(column(after.ideas, 'backlog').map((i) => i.title), ['Old idea', 'A', 'B']);
  assert.equal(after.ideas.find((i) => i.title === 'A')!.done_means, 'x');
  assert.equal(after.goals.length, 1, 'nothing else changes');
});
