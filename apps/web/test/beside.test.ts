import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { agenda, comingNext, focusOf, prizesInReach, scheduleWords, todayTasks, type BesideGoal } from '../src/data/beside.ts';
import { applyUpdate, fermentUpdate } from '../src/data/updates.ts';
import { stageOf } from '../src/data/season.ts';

const TODAY = '2026-10-30'; // a Friday
const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);

function seeded() {
  const d = emptyData();
  d.plans = [{ id: 'season', name: 'Oct 26 – Apr 26', start_date: '2026-10-26', end_date: '2027-04-26', block_days: 28, archived_at: null }];
  const after = run(d, applyUpdate(fermentUpdate, d, '2026-10-29', {}).ops);
  const view = new View(after, TODAY, 0.5);
  const plan = after.plans.find((p) => p.id === 'season')!;
  const goals: BesideGoal[] = view.goalsForPlan('season').map((g) => {
    const start = view.startFor(g, plan);
    return { goal: g, plan, start, stage: stageOf(start, TODAY) };
  });
  return { data: after, view, goals };
}

test('Next 14 days: dates, goal starts and the Saturday reviews, in order; what lands just after', () => {
  const { view, goals } = seeded();
  const { items, after } = agenda(view, goals, TODAY);
  const lines = items.map((x) => `${x.date} ${x.kind} ${x.title}`);
  assert.ok(lines.includes('2026-10-31 review Weekly review'));
  assert.ok(lines.includes('2026-11-07 review Weekly review'));
  assert.ok(lines.some((l) => l === '2026-11-08 start Hard kombucha starts'));
  assert.ok(lines.some((l) => l.startsWith('2026-11-08 date ')), 'batch 2 bottled is a date');
  assert.deepEqual(items.map((x) => x.date), items.map((x) => x.date).slice().sort());
  assert.ok(items.every((x) => x.date >= TODAY && x.date <= '2026-11-12'));
  assert.ok(after && after.date > '2026-11-12');
  // This week's review drops off once it's done.
  assert.ok(!agenda(view, goals, TODAY, 14, true).items.some((x) => x.date === '2026-10-31'));
});

test('Today, focus, prizes and coming next read from the season', () => {
  const { view, goals } = seeded();
  const kom = goals.find((g) => g.goal.title === 'Kombucha, dialed in')!;
  assert.equal(kom.stage, 'now');
  const f = focusOf(view, kom.goal, TODAY);
  assert.ok(f.milestones.length >= 2);
  assert.equal(f.actions[0]!.action.title, 'Fermentation Sunday');
  assert.equal(scheduleWords(view, f.actions[0]!.action.id, TODAY), 'Sun');
  // Friday: the Sunday task isn't today.
  assert.equal(todayTasks(view, goals, TODAY).length, 0);
  const sunday = new View(view.data, '2026-11-01', 0.5);
  assert.ok(todayTasks(sunday, goals, '2026-11-01').some((t) => t.action?.title === 'Fermentation Sunday'));
  const p = prizesInReach(view, goals, TODAY);
  assert.ok(p.without.some((g) => g.id === kom.goal.id));
  const next = comingNext(view, goals, { start: '2026-11-02', end: '2026-11-08' });
  assert.deepEqual(next.map((x) => x.goal.title), ['Hard kombucha']);
  assert.ok(next[0]!.first);
});
