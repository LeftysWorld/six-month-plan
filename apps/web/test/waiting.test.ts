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

test('Glamping Site: a group of four ideas, selected for next, planned next season, waiting on the job', async () => {
  const { applyUpdate, glampGroupUpdate } = await import('../src/data/updates.ts');
  const { invertOps } = await import('../src/data/planPack.ts');
  const { opsMakeGoal } = await import('../src/data/newGoal.ts');
  const { column } = await import('@six/core');
  let d = base();
  d.plans = [{ id: 'season', name: 'Oct 26 – Apr 26', start_date: '2026-10-26', end_date: '2027-04-26', block_days: 28, archived_at: null }];
  d.paths = [{ id: 'planC', name: 'Glamping: build, sell, do it again abroad', headline: '', why: '', color: '#3a3', rank: 3, created_at: '', archived_at: null } as never];
  d = run(d, opsSetWaiting('ideas', d.ideas[0]!, 'goal:job', '2026-10-29T12:00:00Z'));
  const today = '2026-10-29';
  assert.equal(glampGroupUpdate.preview(d, today).done, false);
  const { ops } = applyUpdate(glampGroupUpdate, d, today, {});
  const after = run(d, ops);
  // Next season made: the six months after this one.
  const next = after.plans.find((p) => p.id !== 'season')!;
  assert.equal(next.start_date, '2027-04-27');
  assert.equal(next.name, 'Apr 27 – Oct 26');
  const group = after.groups.find((g) => g.name === 'Glamping Site')!;
  assert.equal(group.waits_on_goal_id, 'job');
  assert.equal(group.waiting_since, '2026-10-29T12:00:00Z');
  const ideas = after.ideas.filter((i) => i.group_id === group.id);
  assert.deepEqual(ideas.map((i) => i.title).sort(), ['Build 3 domes', 'Build 3 tarp glamping sites', 'Build an A-frame', 'Buy land']);
  // The old idea became Buy land, its wait moved to the group.
  const land = after.ideas.find((i) => i.id === 'glamp')!;
  assert.equal(land.title, 'Buy land');
  assert.equal(land.waits_on_goal_id, null);
  assert.equal(land.planned_start, '2027-04-27');
  assert.equal(land.planned_end, '2027-06-30');
  // All selected for next, on Plan C, planned next season, filled in.
  assert.equal(column(after.ideas, 'selected').filter((i) => i.group_id === group.id).length, 4);
  assert.ok(ideas.every((i) => i.path_id === 'planC' && i.plan_id === next.id && i.note && i.done_means));
  // Undo puts it all back; running again changes nothing.
  assert.equal(glampGroupUpdate.preview(after, today).done, true);
  // (A field that wasn't there comes back empty: the same thing.)
  const clean = (r: object) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)));
  const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map(clean).sort() : v])));
  assert.equal(norm(run(after, invertOps(d, ops))), norm(d));

  // Making one a goal: into the group and next season with its planned dates, or pulled into this one.
  const domes = ideas.find((i) => i.title === 'Build 3 domes')!;
  const input = { title: domes.title, type: 'finish' as const, why: domes.note, doneMeans: domes.done_means ?? '', color: '#000', planId: next.id, start: domes.planned_start ?? null, finish: domes.planned_end ?? null, unit: '', measureName: '', baseline: null, target: null, targetDate: '', pathEdits: {}, milestones: [], prize: '', prizeOnTime: '', weekGoal: '', task: null, shareActionIds: [], groupWithGoalId: null, groupId: domes.group_id, pathId: domes.path_id ?? null, ideaId: domes.id };
  const made = opsMakeGoal(after, next, input, today);
  const withGoal = run(after, made.ops);
  const goal = withGoal.goals.find((g) => g.id === made.goalId)!;
  assert.equal(goal.group_id, group.id);
  assert.equal(goal.start_date, '2027-08-01');
  assert.equal(withGoal.ideas.find((i) => i.id === domes.id)!.status, 'started');
  // The group stays (its other ideas are still in the backlog).
  assert.ok(withGoal.groups.some((g) => g.id === group.id));
});
