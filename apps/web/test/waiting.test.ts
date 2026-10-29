import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal, GoalIdea, Milestone } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsSetWaiting, opsStartAnyway, waitChoices, waitOf, waiters, waitText, waitValue } from '../src/data/waiting.ts';

const TODAY = '2026-12-17';
const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const goal = (id: string, title: string, group: string | null, target: string | null = null): Goal => ({ id, title, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: target, color: '#000', measurement_type_id: null, archived_at: null, group_id: group });
const idea: GoalIdea = { id: 'glamp', title: 'Glamping site: land search and numbers', note: 'The second campground.', done_means: '', status: 'backlog', rank: 1, goal_id: null, created_at: '2026-10-26T00:00:00Z', started_at: null };
const offer: Milestone = { id: 'offer', goal_id: 'job', title: 'Offer signed', due_date: '2027-02-28', completed_at: null, value: null, prize: '', prize_claimed_at: null };

function base(): AppData {
  const d = emptyData();
  d.groups = [{ id: 'ai', name: 'AI', created_at: '' }, { id: 'camp', name: 'Camp', created_at: '' }];
  d.goals = [goal('job', 'Land an AI product owner role', 'ai', '2027-03-31'), goal('jhu', 'JHU certificate', 'ai', '2027-04-16'), goal('land', 'Land search', 'camp')];
  d.milestones = [offer];
  d.ideas = [idea];
  return d;
}

test('an idea waits on a goal: weeks counted, nothing met until the goal is done', () => {
  let d = base();
  d = run(d, opsSetWaiting('ideas', d.ideas[0]!, 'goal:job', '2026-10-29T12:00:00Z'));
  const w = waiters(d, TODAY);
  assert.equal(w.length, 1);
  assert.equal(w[0]!.info.met, false);
  assert.equal(w[0]!.info.weeks, 7);
  assert.equal(w[0]!.info.due, '2027-03-31');
  assert.equal(w[0]!.info.group?.name, 'AI');
  assert.equal(waitText(w[0]!.info), 'Waiting · 7 weeks on Land an AI product owner role');
  // The other goals in the group finishing doesn't matter: only the keystone does.
  d = run(d, [{ kind: 'update', collection: 'goals', id: 'jhu', patch: { completed_at: '2027-04-16T00:00:00Z' } }]);
  assert.equal(waitOf(d, d.ideas[0]!, TODAY)!.met, false);
  d = run(d, [{ kind: 'update', collection: 'goals', id: 'job', patch: { completed_at: '2027-01-20T00:00:00Z' } }]);
  assert.equal(waitOf(d, d.ideas[0]!, TODAY)!.met, true);
  assert.equal(waitOf(d, d.ideas[0]!, TODAY)!.metAt, '2027-01-20T00:00:00Z');
});

test('a group waits on a milestone inside another group', () => {
  let d = base();
  d = run(d, opsSetWaiting('groups', d.groups[1]!, 'ms:offer'));
  const info = waitOf(d, d.groups.find((g) => g.id === 'camp')!, TODAY)!;
  assert.equal(info.label, 'Offer signed (Land an AI product owner role)');
  assert.equal(info.due, '2027-02-28');
  d = run(d, [{ kind: 'update', collection: 'milestones', id: 'offer', patch: { completed_at: '2027-02-01T00:00:00Z' } }]);
  assert.equal(waitOf(d, d.groups.find((g) => g.id === 'camp')!, TODAY)!.met, true);
  // A group can't wait on its own goals.
  assert.ok(!waitChoices(d, 'camp').some((c) => c.goal.id === 'land'));
});

test('setting the same wait again changes nothing; clearing it clears everything', () => {
  let d = base();
  d = run(d, opsSetWaiting('ideas', d.ideas[0]!, 'goal:job', '2026-10-29T12:00:00Z'));
  assert.deepEqual(opsSetWaiting('ideas', d.ideas[0]!, 'goal:job'), []);
  assert.equal(waitValue(d.ideas[0]!), 'goal:job');
  d = run(d, opsSetWaiting('ideas', d.ideas[0]!, ''));
  assert.equal(d.ideas[0]!.waits_on_goal_id, null);
  assert.equal(d.ideas[0]!.waiting_since, null);
  assert.equal(waiters(d, TODAY).length, 0);
});

test('start anyway takes the wait off and keeps the reason on the idea', () => {
  let d = base();
  d = run(d, opsSetWaiting('ideas', d.ideas[0]!, 'goal:job'));
  const info = waitOf(d, d.ideas[0]!, TODAY)!;
  d = run(d, opsStartAnyway(d.ideas[0]!, info, 'Found financing.'));
  assert.equal(waitOf(d, d.ideas[0]!, TODAY), null);
  assert.equal(d.ideas[0]!.note, 'The second campground. Started before Land an AI product owner role was done: Found financing.');
});

test('the glamping update links the idea to the job once', async () => {
  const { applyUpdate, glampWaitsUpdate } = await import('../src/data/updates.ts');
  const d = base();
  assert.equal(glampWaitsUpdate.preview(d, TODAY).done, false);
  const after = run(d, applyUpdate(glampWaitsUpdate, d, TODAY, {}).ops);
  assert.equal(after.ideas[0]!.waits_on_goal_id, 'job');
  assert.equal(glampWaitsUpdate.preview(after, TODAY).done, true);
});
