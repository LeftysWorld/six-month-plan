import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { blankTarget, targetsAt } from '../src/data/ladder.ts';
import { draftGaps, draftOf, draftProgress, firstWeekUnplanned, ideaPreview, opsCommitIdea, opsNewIdeaWithDraft, opsSaveDraft, startsSoon, type IdeaPlanDraft } from '../src/data/ideaPlan.ts';
import type { GoalIdea, Plan } from '@six/core';

const TODAY = '2026-10-30';
const plan: Plan = { id: 'p', name: 'Season', start_date: '2026-11-02', end_date: '2027-04-30', block_days: 28, archived_at: null };
const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const idea = (patch: Partial<GoalIdea> = {}): GoalIdea => ({ id: 'i', title: 'Land a product role', note: 'Own the product', done_means: 'Signed offer', status: 'backlog', rank: 1, goal_id: null, created_at: '2026-10-01T00:00:00Z', started_at: null, ...patch });

function base(): AppData {
  const d = emptyData();
  d.plans = [plan];
  d.ideas = [idea()];
  return d;
}

function planned(d: AppData): IdeaPlanDraft {
  const draft = draftOf(new View(d, TODAY, 0), d.ideas[0]!);
  return {
    ...draft,
    what: true,
    totals: ['150 applications'],
    pace: 'ramp',
    quarter: [{ ...blankTarget(), text: '56 applications', value: 56 }],
    month: [{ ...blankTarget(), text: '20 applications', value: 20 }],
    week: [{ ...blankTarget(), text: '5 applications', value: 5 }],
    tasks: [{ key: 't', title: 'Apply to 1 role', minutes: 45, days: [1, 2, 3, 4, 5], kind: 'count', count: 1, target: 0, repeat: 'month' }],
  };
}

test('a fresh draft is filled from what the idea already says', () => {
  const d = base();
  const draft = draftOf(new View(d, TODAY, 0), d.ideas[0]!);
  assert.equal(draft.input.title, 'Land a product role');
  assert.equal(draft.input.why, 'Own the product');
  assert.equal(draft.input.doneMeans, 'Signed offer');
  assert.equal(draft.input.planId, 'p');
  assert.equal(draftProgress(draft), 0);
});

test('the idea can only be made a goal once the 6-month, 3-month and month levels are set', () => {
  const d = base();
  const draft = draftOf(new View(d, TODAY, 0), d.ideas[0]!);
  assert.deepEqual(draftGaps(d, draft, TODAY), ['the 6-month step', 'a 3-month target', 'a month target']);
  assert.throws(() => opsCommitIdea(d, d.ideas[0]!, draft, TODAY), /Still needs/);
  const ready = planned(d);
  assert.deepEqual(draftGaps(d, { ...ready, week: [], tasks: [] }, TODAY), [], 'the first week is not required');
  assert.equal(draftProgress(ready), 5);
});

test('the preview is the goal as it will be, with its targets on the right periods', () => {
  const d = base();
  const draft = planned(d);
  const pv = ideaPreview(d, draft, TODAY);
  assert.equal(pv.goal.id, draft.goalId);
  assert.equal(pv.goal.pace_curve, 'ramp');
  assert.equal(pv.soon, true);
  assert.equal(targetsAt(pv.data, draft.goalId, 'p', 'month', pv.p.month.start)[0]!.target_note, '20 applications');
  assert.equal(d.goals.length, 0, 'nothing is saved by a preview');
  // Twice gives the same goal.
  assert.equal(ideaPreview(d, draft, TODAY).goal.id, pv.goal.id);
});

test('making the goal writes the goal, its levels, its first week and tasks, and starts the idea', () => {
  let d = base();
  const draft = planned(d);
  d = run(d, opsSaveDraft(d.ideas[0]!, draft));
  const { ops, undo, goalId, tasks } = opsCommitIdea(d, d.ideas[0]!, draft, TODAY);
  const after = run(d, ops);
  const goal = after.goals.find((g) => g.id === goalId)!;
  assert.equal(goal.done_means, 'Signed offer');
  assert.equal(goal.pace_curve, 'ramp');
  assert.equal(after.milestones.find((m) => m.goal_id === goalId)!.title, '150 applications');
  for (const level of ['quarter', 'month', 'week'] as const) assert.equal(after.planSteps.filter((s) => s.goal_id === goalId && s.level === level).length, 1, level);
  assert.equal(tasks, 1);
  const apply = after.actions.find((a) => a.title === 'Apply to 1 role')!;
  assert.ok(apply.step_id && after.planSteps.some((s) => s.id === apply.step_id && s.level === 'week'));
  assert.equal(after.ideas[0]!.status, 'started');
  assert.equal(after.ideas[0]!.goal_id, goalId);
  assert.equal(after.ideas[0]!.plan_draft, null);
  const back = run(after, undo);
  assert.equal(back.goals.length, 0);
  assert.equal(back.ideas[0]!.status, 'backlog');
});

test('a goal that starts later skips its first week until it is up next', () => {
  let d = base();
  const draft = planned(d);
  draft.input.start = '2026-12-07';
  d = run(d, opsSaveDraft(d.ideas[0]!, draft));
  const pv = ideaPreview(d, draft, TODAY);
  assert.equal(pv.soon, false);
  const { ops, tasks } = opsCommitIdea(d, d.ideas[0]!, draft, TODAY);
  assert.equal(tasks, 0);
  const after = run(d, ops);
  assert.equal(after.actions.length, 0);
  // Once it's within two weeks of starting, it shows as needing its first week.
  const view = new View(after, '2026-12-01', 0);
  assert.equal(firstWeekUnplanned(view).length, 1);
  assert.equal(startsSoon('2026-12-07', '2026-12-01'), true);
  assert.equal(firstWeekUnplanned(new View(after, '2026-11-27', 0)).length, 0, 'two weeks out is not up next yet');
});

test('saving a draft copies what the backlog shows onto the idea; a goal from nothing starts as an idea', () => {
  const d = base();
  const draft = { ...planned(d), input: { ...planned(d).input, title: 'Land a technical PO role', doneMeans: 'Offer signed' } };
  const after = run(d, opsSaveDraft(d.ideas[0]!, draft));
  assert.equal(after.ideas[0]!.title, 'Land a technical PO role');
  assert.equal(after.ideas[0]!.done_means, 'Offer signed');
  assert.equal(after.ideas[0]!.plan_id, 'p');
  const fresh = opsNewIdeaWithDraft(d, draftOf(new View(d, TODAY, 0), null));
  assert.equal(fresh.idea.status, 'backlog');
  assert.equal(fresh.idea.title, 'Untitled goal');
});
