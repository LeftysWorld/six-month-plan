import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { opsMakeGoal, opsStartSeason, type NewGoalInput } from '../src/data/newGoal.ts';
import { opsRecordReading } from '../src/data/connect.ts';
import { opsCreateGroup } from '../src/data/groups.ts';
import { opsCompleteGoal } from '../src/data/ops.ts';
import { allPrizes, goalPrizes, groupPrize, opsSetGoalPrizes, opsSetGroupPrize, unclaimedPrizes } from '../src/data/prizes.ts';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const TODAY = '2026-10-26';

function weightInput(planId: string): NewGoalInput {
  return {
    title: 'Down to 155 lb',
    type: 'number',
    why: '',
    doneMeans: '',
    color: '#22B07D',
    planId,
    start: null,
    finish: null,
    unit: 'lb',
    measureName: 'Weight',
    baseline: 194.2,
    target: 155,
    targetDate: '2027-04-26',
    pathEdits: {},
    milestones: [
      { title: '10 lb down', due_date: '2026-12-13', value: 184.2, prize: 'A massage' },
      { title: '20 lb down', due_date: '2027-01-31', value: 174.2, prize: 'A nice burr grinder' },
    ],
    prize: 'Something nice',
    prizeOnTime: 'Something nicer',
    weekGoal: '',
    task: null,
    shareActionIds: [],
    groupWithGoalId: null,
    pathId: null,
    ideaId: null,
  };
}

function setup() {
  let d = emptyData();
  const season = opsStartSeason('Season', TODAY);
  d = run(d, season.ops);
  const plan = d.plans[0]!;
  const made = opsMakeGoal(d, plan, weightInput(plan.id), TODAY);
  d = run(d, made.ops);
  return { d, plan, goalId: made.goalId };
}

test('a new goal carries its dated prizes, finish prize and bonus (judged against the date it had)', () => {
  const { d, plan, goalId } = setup();
  const view = new View(d, TODAY, 0.5);
  const goal = d.goals.find((g) => g.id === goalId)!;
  assert.equal(goal.prize, 'Something nice');
  assert.equal(goal.prize_on_time, 'Something nicer');
  assert.equal(goal.target_date_at_set, '2027-04-26');
  const prizes = goalPrizes(view, goal, TODAY, plan);
  assert.deepEqual(
    prizes.map((p) => [p.kind, p.title, p.status]),
    [
      ['milestone', 'A massage', 'open'],
      ['milestone', 'A nice burr grinder', 'open'],
      ['finish', 'Something nice', 'open'],
      ['bonus', 'Something nicer', 'open'],
    ],
  );
});

test('a reading at or below a dated number ticks the date off and earns its prize; undo puts it back', () => {
  let { d, plan, goalId } = setup();
  const goal = d.goals.find((g) => g.id === goalId)!;
  const typeId = goal.measurement_type_id!;
  const miss = opsRecordReading(d, typeId, 185, '2026-12-01');
  d = run(d, miss.ops);
  assert.equal(d.milestones.filter((m) => m.completed_at).length, 0);
  const hit = opsRecordReading(d, typeId, 184.0, '2026-12-09');
  d = run(d, hit.ops);
  const ten = d.milestones.find((m) => m.title === '10 lb down')!;
  assert.ok(ten.completed_at);
  assert.equal(new View(d, '2026-12-09', 0.5).dayOf(ten.completed_at!), '2026-12-09');
  const view = new View(d, '2026-12-10', 0.5);
  const p = goalPrizes(view, d.goals[0]!, '2026-12-10', plan).find((x) => x.title === 'A massage')!;
  assert.equal(p.status, 'earned');
  assert.equal(unclaimedPrizes(d, view, '2026-12-10').map((x) => x.title).join(), 'A massage');
  d = run(d, p.claim);
  assert.equal(unclaimedPrizes(d, new View(d, '2026-12-10', 0.5), '2026-12-10').length, 0);
  // undo the reading: the date reopens
  d = run(d, hit.undo);
  assert.equal(d.milestones.find((m) => m.title === '10 lb down')!.completed_at, null);
});

test('late finish keeps the prize but loses the bonus; moving the date later does not move the bonus', () => {
  let { d, plan, goalId } = setup();
  let goal = d.goals.find((g) => g.id === goalId)!;
  d = run(d, [{ kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: '2027-05-10' } }]);
  goal = d.goals.find((g) => g.id === goalId)!;
  const late = '2027-05-02';
  d = run(d, opsCompleteGoal(d, goal, '', late).map((op) => (op.kind === 'update' && op.collection === 'goals' ? { ...op, patch: { ...op.patch, completed_at: `${late}T15:00:00.000Z` } } : op)));
  const view = new View(d, late, 0.5);
  const prizes = goalPrizes(view, d.goals.find((g) => g.id === goalId)!, late, plan);
  const finish = prizes.find((p) => p.kind === 'finish')!;
  const bonus = prizes.find((p) => p.kind === 'bonus')!;
  assert.equal(finish.status, 'earned'); // by the moved date
  assert.equal(bonus.status, 'late'); // judged against Apr 26
  assert.equal(bonus.lost, true);
});

test('setting prizes later fixes the bonus date once; clearing the bonus frees it', () => {
  const { d, goalId } = setup();
  const goal = { ...d.goals.find((g) => g.id === goalId)!, prize_on_time: '', target_date_at_set: null };
  const ops = opsSetGoalPrizes(goal, 'X', 'Y', '2027-04-26');
  assert.deepEqual(ops[0]!.kind === 'update' && ops[0]!.patch, { prize: 'X', prize_on_time: 'Y', target_date_at_set: '2027-04-26' });
  const cleared = opsSetGoalPrizes({ ...goal, prize_on_time: 'Y', target_date_at_set: '2027-04-26' }, 'X', '', '2027-05-10');
  assert.deepEqual(cleared[0]!.kind === 'update' && cleared[0]!.patch, { prize: 'X', prize_on_time: '', target_date_at_set: null });
});

test('a group prize is earned when enough of its goals finish', () => {
  let { d, plan, goalId } = setup();
  const second = opsMakeGoal(d, plan, { ...weightInput(plan.id), title: 'Splits', type: 'practice', milestones: [], prize: '', prizeOnTime: '', unit: '', baseline: null, target: null, targetDate: '', task: { title: 'Stretch', days: [1, 2, 3], minutes: 20 } }, TODAY);
  d = run(d, second.ops);
  const grp = opsCreateGroup(d, 'Body', [goalId, second.goalId]);
  d = run(d, grp.ops);
  d = run(d, opsSetGroupPrize(d.groups[0]!, 'A scouting trip', 0.85));
  let view = new View(d, TODAY, 0.5);
  let p = groupPrize(d, view, d.groups[0]!, TODAY)!;
  assert.equal(p.status, 'open');
  assert.equal(p.score!.done, 0);
  d = run(d, opsCompleteGoal(d, d.goals.find((g) => g.id === goalId)!, '', '2027-03-01'));
  view = new View(d, '2027-03-01', 0.5);
  p = groupPrize(d, view, d.groups[0]!, '2027-03-01')!;
  assert.equal(p.score!.earned, false); // 1 of 2 = 50%
  d = run(d, opsCompleteGoal(d, d.goals.find((g) => g.id === second.goalId)!, '', '2027-03-02'));
  view = new View(d, '2027-03-02', 0.5);
  p = groupPrize(d, view, d.groups[0]!, '2027-03-02')!;
  assert.equal(p.score!.earned, true);
  assert.equal(p.status, 'earned');
  assert.equal(allPrizes(d, view, '2027-03-02').filter((x) => x.kind === 'group').length, 1);
});
