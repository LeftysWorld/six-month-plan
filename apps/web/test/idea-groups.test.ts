import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GoalIdea } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { emptyGroups, opsJoinIdeaGroup } from '../src/data/groups.ts';
import { ideaWait } from '../src/data/waiting.ts';

const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const idea = (id: string, extra: Partial<GoalIdea> = {}): GoalIdea => ({ id, title: id, note: '', done_means: '', status: 'backlog', rank: 1, goal_id: null, created_at: '2026-10-29T00:00:00Z', started_at: null, ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'next', name: 'Apr 27 – Oct 26', start_date: '2027-04-27', end_date: '2027-10-26', block_days: 28, archived_at: null }];
  d.paths = [{ id: 'pC', name: 'Glamping', headline: '', rank: 3 } as never];
  d.goals = [{ id: 'job', title: 'Land an AI product owner role', type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: null }];
  d.groups = [
    { id: 'glamp', name: 'Glamping Site', created_at: '2026-10-29T00:00:00Z', waits_on_goal_id: 'job', waiting_since: '2026-10-29T00:00:00Z' },
    { id: 'fresh', name: 'Just made', created_at: '2026-10-29T01:00:00Z' },
  ];
  d.ideas = [idea('land', { group_id: 'glamp', path_id: 'pC', plan_id: 'next' }), idea('frame', { group_id: 'glamp', path_id: 'pC', plan_id: 'next' }), idea('sauna'), idea('podcast')];
  return d;
}

test('an idea joining a group takes its path, its planned season and its wait', () => {
  const d = base();
  const sauna = d.ideas.find((i) => i.id === 'sauna')!;
  const { ops, picked } = opsJoinIdeaGroup(d, sauna, 'glamp');
  const after = run(d, ops);
  const s = after.ideas.find((i) => i.id === 'sauna')!;
  assert.equal(s.group_id, 'glamp');
  assert.equal(s.path_id, 'pC');
  assert.equal(s.plan_id, 'next');
  assert.equal(ideaWait(after, s, '2026-11-05')?.goal.id, 'job');
  assert.deepEqual(picked, ['on Glamping', 'planned for Apr 27 – Oct 26', 'waiting with the group']);
});

test('what an idea already has stays; a group that disagrees passes nothing on', () => {
  const d = base();
  d.ideas = d.ideas.map((i) => (i.id === 'frame' ? { ...i, path_id: null, plan_id: null } : i.id === 'podcast' ? { ...i, path_id: 'pB' } : i));
  const podcast = d.ideas.find((i) => i.id === 'podcast')!;
  const after = run(d, opsJoinIdeaGroup(d, podcast, 'glamp').ops);
  const p = after.ideas.find((i) => i.id === 'podcast')!;
  assert.equal(p.group_id, 'glamp');
  assert.equal(p.path_id, 'pB');
  assert.equal(p.plan_id ?? null, null);
});

test('an empty group is listed until something is in it', () => {
  const d = base();
  assert.deepEqual(emptyGroups(d).map((g) => g.id), ['fresh']);
  const after = run(d, opsJoinIdeaGroup(d, d.ideas.find((i) => i.id === 'podcast')!, 'fresh').ops);
  assert.deepEqual(emptyGroups(after).map((g) => g.id), []);
});
