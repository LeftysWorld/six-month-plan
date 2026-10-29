import { test } from 'node:test';
import assert from 'node:assert/strict';
import { column, missingSessionsForWeek } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsEnsureWeek } from '../src/data/ops.ts';
import { invertOps } from '../src/data/planPack.ts';
import { applyUpdate, fermentUpdate } from '../src/data/updates.ts';

const TODAY = '2026-10-29';
const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'season', name: 'Oct 26 – Apr 26', start_date: '2026-10-26', end_date: '2027-04-26', block_days: 28, archived_at: null }];
  d.sessions = missingSessionsForWeek(d.actions, d.schedules, [], '2026-10-26', () => crypto.randomUUID());
  return d;
}

test('Fermentation: four goals this season in the group, one shared Sunday session, doburoku and sake planned next season', () => {
  const d = base();
  assert.equal(fermentUpdate.preview(d, TODAY).done, false);
  const { ops, undo } = applyUpdate(fermentUpdate, d, TODAY, {});
  let after = run(d, ops);
  const group = after.groups.find((g) => g.name === 'Fermentation')!;
  const goals = after.goals.filter((g) => g.group_id === group.id);
  assert.deepEqual(goals.map((g) => `${g.title}: ${g.start_date ?? 'Oct 26'} → ${g.target_date ?? 'season end'}`), [
    'Kombucha, dialed in: Oct 26 → 2026-11-29',
    'Hard kombucha: 2026-11-08 → 2027-01-31',
    'Mead: a hydromel: 2026-12-06 → season end',
    'Koji basics: amazake, miso, grown koji: 2026-12-20 → season end',
  ]);
  assert.ok(goals.every((g) => g.why && g.done_means));
  const ms = after.milestones.filter((m) => goals.some((g) => g.id === m.goal_id));
  assert.ok(ms.some((m) => m.title === 'Amazake batch 1' && m.due_date === '2026-12-20'));
  assert.ok(ms.some((m) => m.title === 'Koji grown: 3 runs' && m.due_date === '2027-04-04'));
  // One task every Sunday, shared by all four.
  const task = after.actions.find((a) => a.title === 'Fermentation Sunday')!;
  assert.deepEqual(after.schedules.filter((s) => s.action_id === task.id).map((s) => s.days), [[7]]);
  assert.equal(after.actionGoals.filter((x) => x.action_id === task.id).length, 4);
  assert.ok(after.sessions.some((s) => s.action_id === task.id && s.date === '2026-11-01'));
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  assert.ok(after.sessions.some((s) => s.action_id === task.id && s.date === '2026-11-08'));
  assert.ok(!after.sessions.some((s) => s.action_id === task.id && s.date !== null && new Date(`${s.date}T00:00:00Z`).getUTCDay() !== 0));
  // Next season made, with doburoku and sake planned in it and selected for next.
  const next = after.plans.find((p) => p.id !== 'season')!;
  const ideas = after.ideas.filter((i) => i.group_id === group.id);
  assert.deepEqual(ideas.map((i) => `${i.title}: ${i.planned_start} → ${i.planned_end}`), ['Doburoku: 2027-04-27 → 2027-06-30', 'Sake: 2027-07-01 → 2027-10-26']);
  assert.ok(ideas.every((i) => i.plan_id === next.id));
  assert.equal(column(after.ideas, 'selected').length, 2);
  // Done; Undo puts everything back.
  assert.equal(fermentUpdate.preview(run(d, ops), TODAY).done, true);
  const clean = (r: object) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)));
  const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map(clean).sort() : v])));
  assert.equal(norm(run(run(d, ops), undo)), norm(d));
  void invertOps;
});

test('Fermentation: a setup that only half saved shows again and finishes, without duplicates', () => {
  const d = base();
  const full = run(d, applyUpdate(fermentUpdate, d, TODAY, {}).ops);
  const group = full.groups.find((g) => g.name === 'Fermentation')!;
  const goals = full.goals.filter((g) => g.group_id === group.id);
  // The goals saved, but not their season, the group or the task links.
  const half: AppData = {
    ...full,
    groups: full.groups.filter((g) => g.id !== group.id),
    goals: full.goals.map((g) => (g.group_id === group.id ? { ...g, group_id: null } : g)),
    planGoals: full.planGoals.filter((pg) => !goals.some((g) => g.id === pg.goal_id)),
    actionGoals: full.actionGoals.filter((ag) => !goals.some((g) => g.id === ag.goal_id)),
  };
  const p = fermentUpdate.preview(half, TODAY);
  assert.equal(p.done, false);
  assert.ok(p.lines.some((l) => l.includes('in this season')));
  const fixed = run(half, applyUpdate(fermentUpdate, half, TODAY, {}).ops);
  assert.equal(fermentUpdate.preview(fixed, TODAY).done, true);
  const g2 = fixed.groups.filter((g) => g.name === 'Fermentation');
  assert.equal(g2.length, 1);
  assert.equal(fixed.goals.filter((g) => goals.some((x) => x.id === g.id) && g.group_id === g2[0]!.id).length, 4);
  assert.equal(fixed.goals.length, full.goals.length);
  assert.ok(goals.every((g) => fixed.planGoals.some((pg) => pg.goal_id === g.id && pg.plan_id === 'season')));
  const task = fixed.actions.find((a) => a.title === 'Fermentation Sunday')!;
  assert.equal(fixed.actionGoals.filter((x) => x.action_id === task.id).length, 4);
  assert.ok(fixed.ideas.filter((i) => i.group_id === g2[0]!.id).length === 2);
});
