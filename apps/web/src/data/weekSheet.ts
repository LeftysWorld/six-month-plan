import {
  addDays,
  scheduleForWeek,
  sessionFromSlot,
  slotsForWeek,
  trainingRules,
  weekStart,
  type ISODate,
  type PlannedExercise,
  type Session,
} from '@six/core';
import type { AppData } from './model.ts';
import { bodyWeight, deloadFor, targetsFor, type ExerciseTarget } from './progress.ts';
import type { Decision, DecisionChange } from './workoutHistory.ts';

/**
 * The week sheet: every workout of one week, day by day, each exercise with its weight, sets and
 * reps from your progression rules, what you did last time, and a tag (up, hold, down…). The
 * latest coach report's changes are laid over the plan when you haven't declined them, so the
 * sheet is the week the coach recommends. Printed, it's the PDF.
 */

export type SheetTag = 'UP' | 'HOLD' | 'DOWN' | '+1 SET' | 'TEMPO' | 'LESS ASSIST' | 'LIGHT WEEK' | 'NEW' | 'SWAP' | 'COACH';

export interface SheetRow {
  name: string;
  setsReps: string;
  weight: string;
  tag: SheetTag;
  last: string;
  rest: string;
  note: string;
  coach: boolean;
}

export interface SheetDay {
  date: ISODate | null;
  title: string;
  /** The day's first exercise, for the card's corner label ("Assisted Pull-Up first"). */
  label: string;
  tone: 'green' | 'brown' | 'grey';
  rows: SheetRow[];
}

export interface WeekSheet {
  monday: ISODate;
  units: string;
  bodyweight: number | null;
  /** "Mon · Tue · Thu · Fri · Sat" and the days off. */
  daysOn: string;
  daysOff: string;
  /** The week the "last time" column comes from. */
  fromWeek: ISODate;
  days: SheetDay[];
  /** What changed from last week, in a few lines. */
  summary: string[];
  coach: { as_of: ISODate; summary: string; changes: DecisionChange[] } | null;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const n = (v: number) => String(Math.round(v * 100) / 100);
const dow = (d: ISODate) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
export const sheetDate = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const logged = (s: Session) => s.status !== 'planned' && s.status !== 'skipped' && s.status !== 'moved';
const dayOf = (s: Session) => s.date ?? s.week_start;
const key = (s: string) => s.trim().toLowerCase();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The default week: next week on a Sunday (the report day), otherwise this week. */
export function sheetMonday(today: ISODate): ISODate {
  return dow(today) === 6 ? addDays(today, 1) : weekStart(today);
}

/** The latest coach report that still applies to the week of `monday` (not declined, at most a week old). */
function coachFor(data: AppData, monday: ISODate): WeekSheet['coach'] {
  const r = [...(data.workoutReports ?? [])].filter((x) => x.as_of < monday && x.as_of >= addDays(monday, -8)).sort((a, b) => (a.as_of < b.as_of ? 1 : -1))[0];
  if (!r || r.user_status === 'declined') return null;
  const d = (r.decision ?? {}) as Partial<Decision>;
  if (d.recommendation !== 'change' || !d.changes?.length) return null;
  return { as_of: r.as_of, summary: d.summary ?? '', changes: d.changes };
}

/** A workout's plan with the coach's changes for it laid over (each change only once; already-made ones are no-ops). */
function withCoach(plan: PlannedExercise[], actionId: string, title: string, changes: DecisionChange[]): { plan: PlannedExercise[]; touched: Map<string, DecisionChange> } {
  let out = plan.map((e) => ({ ...e }));
  const touched = new Map<string, DecisionChange>();
  for (const c of changes) {
    if (c.action_id ? c.action_id !== actionId : key(c.workout) !== key(title)) continue;
    const to = (c.to ?? {}) as Partial<PlannedExercise>;
    const i = out.findIndex((e) => key(e.name) === key(c.exercise));
    if (c.type === 'remove') {
      if (i >= 0) out.splice(i, 1);
      continue;
    }
    if (c.type === 'add') {
      if (to.name && !out.some((e) => key(e.name) === key(to.name!))) {
        out = [...out, { name: to.name, sets: to.sets ?? 3, reps_min: to.reps_min ?? 10, reps_max: to.reps_max ?? 12, weight: to.weight ?? null, weight_note: to.weight_note ?? '', rest: to.rest ?? '', note: to.note ?? '' }];
        touched.set(key(to.name), c);
      }
      continue;
    }
    if (i < 0) continue;
    const merged: PlannedExercise = { ...out[i]!, ...Object.fromEntries(Object.entries(to).filter(([, v]) => v != null)) } as PlannedExercise;
    out[i] = merged;
    touched.set(key(merged.name), c);
  }
  return { plan: out, touched };
}

/** "55 × 12, 12, 12 @8": the last time this exercise was done in this workout (or anywhere, if never here). */
function lastTime(data: AppData, actionId: string, name: string, before: ISODate, unit: string): string {
  const sessions = data.sessions.filter((s) => logged(s) && dayOf(s) < before).sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : -1));
  const ids = new Set(data.workoutSets.filter((w) => key(w.exercise) === key(name) && w.done && (w.reps ?? 0) > 0).map((w) => w.session_id));
  const own = sessions.find((s) => s.action_id === actionId && ids.has(s.id));
  const any = own ?? sessions.find((s) => ids.has(s.id));
  if (!any) return 'new';
  const sets = data.workoutSets.filter((w) => w.session_id === any.id && key(w.exercise) === key(name) && w.done && (w.reps ?? 0) > 0).sort((a, b) => a.set_no - b.set_no);
  const weights = [...new Set(sets.map((w) => (w.weight == null ? 'BW' : n(Number(w.weight)))))];
  const reps = sets.map((w) => w.reps).join(', ');
  const body = weights.length === 1 ? `${weights[0]} × ${reps}` : sets.map((w) => `${w.weight == null ? 'BW' : n(Number(w.weight))} × ${w.reps}`).join(', ');
  const effort = data.workoutExercises.find((x) => x.session_id === any.id && key(x.exercise) === key(name))?.effort;
  const where = own ? '' : ` (${SHORT[dow(dayOf(any))]})`;
  void unit;
  return `${body}${effort != null ? ` @${effort}` : ''}${where}`;
}

const TAG: Record<string, SheetTag> = { load_up: 'UP', carry: 'UP', assist_down: 'LESS ASSIST', add_set: '+1 SET', tempo: 'TEMPO', hold: 'HOLD', plan: 'HOLD', failed_jump: 'DOWN', deload: 'LIGHT WEEK' };

function weightText(t: ExerciseTarget, ex: PlannedExercise, unit: string): string {
  if (t.weight == null) return /body/i.test(ex.weight_note) || t.cls === 'bodyweight' ? 'bodyweight' : ex.weight_note || '—';
  return t.cls === 'assisted' ? `${n(t.weight)} ${unit} assist` : `${n(t.weight)} ${unit}${t.tempo ? ' · slow' : ''}`;
}

/** The workouts on each day of the week of `monday`: the sessions already there, else the schedule's slots. */
function workoutsOfWeek(data: AppData, monday: ISODate): Session[] {
  const out: Session[] = [];
  for (const a of data.actions.filter((x) => !x.archived_at && x.kind === 'workout' && x.workout_plan?.length)) {
    const existing = data.sessions.filter((s) => s.action_id === a.id && s.week_start === monday && s.status !== 'moved');
    if (existing.length) {
      out.push(...existing);
      continue;
    }
    const schedule = scheduleForWeek(data.schedules, a.id, monday);
    if (!schedule) continue;
    slotsForWeek(schedule, monday).forEach((slot, i) => out.push(sessionFromSlot(a, slot, `sheet-${a.id}-${i}`)));
  }
  return out.sort((x, y) => (x.date ?? '9999') < (y.date ?? '9999') ? -1 : (x.date ?? '9999') > (y.date ?? '9999') ? 1 : 0);
}

export function weekSheet(data: AppData, monday: ISODate, today: ISODate): WeekSheet {
  const unit = data.profile.units;
  const coach = coachFor(data, monday);
  const sessions = workoutsOfWeek(data, monday);
  const tones: SheetDay['tone'][] = ['green', 'brown', 'grey'];
  const toneOf = new Map<string, SheetDay['tone']>();
  const moves: Record<string, string[]> = { up: [], assist: [], set: [], tempo: [], down: [], hold: [] };
  const upBy = new Map<string, string[]>();

  const days: SheetDay[] = sessions.map((s) => {
    const action = data.actions.find((a) => a.id === s.action_id)!;
    if (!toneOf.has(action.id)) toneOf.set(action.id, tones[toneOf.size % tones.length]!);
    const { plan, touched } = withCoach(action.workout_plan ?? [], action.id, action.title, coach?.changes ?? []);
    const day = s.date ?? monday;
    const { targets } = targetsFor(data, { ...s, date: day }, plan);
    const rows: SheetRow[] = plan.map((ex, i) => {
      const t = targets[i]!;
      const c = touched.get(key(ex.name));
      const last = lastTime(data, action.id, ex.name, day, unit);
      let tag: SheetTag = TAG[t.why] ?? 'HOLD';
      if (last === 'new' || (t.why === 'plan' && / \((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)$/.test(last))) tag = 'NEW';
      if (c) tag = c.type === 'swap' || c.type === 'add' ? 'SWAP' : 'COACH';
      const short = ex.name.replace(/ \(knee test\)/i, '');
      if (!c && tag === 'UP') {
        const what = t.cls === 'bodyweight' ? t.text.replace(/^Every set at \d+: /, '').replace(/ now\.?$|\.$/, '') : `${weightText(t, ex, unit)} ${SHORT[dow(day)]}`;
        upBy.set(short, [...(upBy.get(short) ?? []), what]);
      }
      if (!c && tag === 'LESS ASSIST') moves.assist!.push(`${short} ${SHORT[dow(day)]} ${n(t.weight ?? 0)} ${unit}`);
      if (!c && tag === '+1 SET') moves.set!.push(short);
      if (!c && tag === 'TEMPO') moves.tempo!.push(short);
      if (!c && tag === 'DOWN') moves.down!.push(short);
      const note = c ? `Coach: ${c.reason}${t.text && t.why !== 'plan' ? ` ${t.text}` : ''}` : t.text || ex.note || '';
      return {
        name: ex.name,
        setsReps: `${t.sets} × ${t.reps_min === t.reps_max ? t.reps_min : `${t.reps_min}–${t.reps_max}`}${/\/side/i.test(`${ex.note} ${ex.weight_note}`) ? '/side' : ''}`,
        weight: weightText(t, ex, unit),
        tag,
        last: c?.type === 'swap' && c.exercise && key(c.exercise) !== key(ex.name) ? `replaces ${c.exercise}` : last,
        rest: ex.rest || '',
        note,
        coach: !!c,
      };
    });
    return {
      date: s.date,
      title: `${s.date ? `${DAY_NAMES[dow(s.date)]} · ${sheetDate(s.date)}` : 'Any day this week'} · ${action.title}`,
      label: plan[0] ? `${plan[0].name.replace(/ \(knee test\)/i, '')} first` : '',
      tone: toneOf.get(action.id)!,
      rows,
    };
  });

  const on = [...new Set(sessions.filter((s) => s.date).map((s) => dow(s.date!)))].sort();
  const rules = trainingRules(data.profile.training_rules);
  const summary: string[] = [];
  if (coach) summary.push(`<b>Coach changes</b> (report of ${sheetDate(coach.as_of)}): ${esc(coach.changes.map((c) => (c.type === 'swap' && c.to?.name ? `${c.exercise} → ${c.to.name}` : `${c.exercise} (${c.type === 'reps' ? 'new rep range' : c.type === 'sets' ? 'sets' : c.type === 'load' ? 'weight' : c.type})`)).join('; '))}.`);
  if (rules.max_reps > 0) summary.push(`<b>${rules.max_reps} reps max</b> on everything except bodyweight lifts.`);
  if (upBy.size) summary.push(`<b>Goes up:</b> ${esc([...upBy].map(([name, w]) => `${name} (${[...new Set(w)].join(', ')})`).join('; '))}.`);
  if (moves.assist!.length) summary.push(`<b>Less assist:</b> ${esc(moves.assist!.join(', '))}.`);
  if (moves.set!.length) summary.push(`<b>One more set</b> (a weight step would be too big, or reps are at the cap): ${esc([...new Set(moves.set)].join(', '))}.`);
  if (moves.tempo!.length) summary.push(`<b>Slower tempo</b> (3 s down, 1 s pause): ${esc([...new Set(moves.tempo)].join(', '))}.`);
  if (moves.down!.length) summary.push(`<b>Back down</b> to get into the range: ${esc([...new Set(moves.down)].join(', '))}.`);
  const deload = deloadFor(data, monday);
  if (deload.now) summary.push(`<b>Lighter week:</b> half the sets at the same weights, about 3–4 reps left on each.`);
  else summary.push(`No lighter week this week. The next scheduled one is the week of ${sheetDate(deload.dueBy)}.`);

  return {
    monday,
    units: unit,
    bodyweight: bodyWeight(data, today).latest,
    daysOn: on.map((d) => SHORT[d]).join(' · '),
    daysOff: [0, 1, 2, 3, 4, 5, 6].filter((d) => !on.includes(d)).map((d) => SHORT[d]).join(' and '),
    fromWeek: addDays(monday, -7),
    days,
    summary,
    coach,
  };
}

const TAG_CLASS: Record<SheetTag, string> = { UP: 't-up', 'LESS ASSIST': 't-up', '+1 SET': 't-up', HOLD: 't-hold', TEMPO: 't-hold', DOWN: 't-down', 'LIGHT WEEK': 't-hold', NEW: 't-swap', SWAP: 't-swap', COACH: 't-coach' };

/** The sheet as a self-contained page (letter size, prints straight to PDF). */
export function weekSheetHtml(w: WeekSheet): string {
  const year = w.monday.slice(0, 4);
  const lastWeek = `${sheetDate(w.fromWeek)} – ${sheetDate(addDays(w.fromWeek, 6))}`;
  const days = w.days
    .map(
      (d) => `<div class="card ${d.tone}"><h3>${esc(d.title)} <span class="pill">${esc(d.label)}</span></h3>
<table><tr><th style="width:36%">Exercise</th><th style="width:11%">Sets × reps</th><th style="width:19%">This week</th><th style="width:24%">Last time</th><th>Rest</th></tr>
${d.rows
  .map(
    (r) =>
      `<tr><td class="ex">${esc(r.name)}${r.note ? `<div class="why">${esc(r.note)}</div>` : ''}</td><td>${esc(r.setsReps)}</td><td class="next">${esc(r.weight)}<br><span class="tag ${TAG_CLASS[r.tag]}">${r.tag}</span></td><td class="muted">${esc(r.last)}</td><td>${esc(r.rest)}</td></tr>`,
  )
  .join('\n')}
</table></div>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lifting · Week of ${sheetDate(w.monday)}, ${year}</title>
<style>
@page { size: letter; margin: 0.5in 0.6in; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; color: #161616; font-size: 10.5pt; line-height: 1.45; margin: 0; padding: 0; background: #fff; }
@media screen { body { padding: 20px 16px 40px; max-width: 8.5in; margin: 0 auto; } }
.kicker { font-family: ui-monospace, "DejaVu Sans Mono", Menlo, monospace; font-size: 8pt; letter-spacing: .12em; color: #555; text-transform: uppercase; }
h1 { font-size: 30pt; font-weight: 700; margin: 6px 0 4px; letter-spacing: -.01em; line-height: 1.1; }
.sub { color: #555; font-size: 10.5pt; display: flex; gap: 16px; flex-wrap: wrap; }
.rule { border: 0; border-top: 2px solid #161616; margin: 14px 0 16px; }
.callout { background: #e4efe9; border-left: 4px solid #2f6b55; padding: 12px 16px 10px; margin-bottom: 14px; }
.callout h2 { margin: 0 0 6px; font-size: 13.5pt; }
.callout ul { margin: 4px 0 2px; padding-left: 16px; font-size: 9pt; }
.callout li { margin-bottom: 4px; }
.tag { font-family: ui-monospace, "DejaVu Sans Mono", Menlo, monospace; font-size: 7pt; letter-spacing: .06em; padding: 1px 4px; border: 1px solid; border-radius: 2px; white-space: nowrap; font-weight: 400; }
.t-up, .t-swap { color: #2f6b55; border-color: #2f6b55; }
.t-hold { color: #555; border-color: #888; }
.t-down { color: #a33; border-color: #a33; }
.t-coach { color: #8a4b12; border-color: #c08a52; }
.legend { font-size: 9pt; color: #444; margin: 0 0 12px; display: flex; gap: 14px; flex-wrap: wrap; }
.card { border: 1px solid #ddd; border-top: 4px solid #2f6b55; padding: 10px 12px 6px; margin-bottom: 14px; }
.card.brown { border-top-color: #8a4b12; }
.card.grey { border-top-color: #444; }
.card h3 { break-after: avoid; margin: 0 0 6px; font-size: 13pt; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pill { font-family: ui-monospace, "DejaVu Sans Mono", Menlo, monospace; font-size: 7.5pt; letter-spacing: .08em; background: #e4efe9; color: #2f6b55; padding: 3px 7px; text-transform: uppercase; font-weight: 400; white-space: nowrap; }
.card.brown .pill { background: #f6e8dc; color: #8a4b12; }
.card.grey .pill { background: #eee; color: #444; }
table { width: 100%; border-collapse: collapse; font-size: 9.3pt; }
th { font-family: ui-monospace, "DejaVu Sans Mono", Menlo, monospace; font-size: 7.3pt; letter-spacing: .08em; color: #666; font-weight: 400; text-align: left; padding: 4px 6px 5px; border-bottom: 1.5px solid #161616; text-transform: uppercase; }
td { padding: 4px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
tr { break-inside: avoid; }
td.ex { font-weight: 600; }
td.ex .why { font-weight: 400; color: #444; font-size: 8.6pt; margin-top: 2px; }
.muted { color: #666; }
.next { font-weight: 700; }
@media screen and (max-width: 560px) {
  h1 { font-size: 24pt; }
  table, tbody, tr, td { display: block; width: 100% !important; }
  tr:first-child { display: none; }
  tr { border-bottom: 1px solid #e3e3e3; padding: 6px 0; display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; }
  td { border: 0; padding: 0; }
  td.ex { grid-column: 1 / -1; }
  td:nth-child(2)::before { content: "Sets × reps "; color: #888; font-size: 8pt; }
  td:nth-child(4) { grid-column: 1 / -1; font-size: 9pt; }
  td:nth-child(4)::before { content: "Last time: "; }
  td:nth-child(5) { display: none; }
}
</style></head><body>
<div class="kicker">Week of ${sheetDate(w.monday)}, ${year}${w.bodyweight != null ? ` · Bodyweight ${n(w.bodyweight)} ${esc(w.units)}` : ''}</div>
<h1>This Week's Lifting</h1>
<div class="sub"><span>${esc(w.daysOn)}</span>${w.daysOff ? `<span>${esc(w.daysOff)} off</span>` : ''}<span>Weights from your ${lastWeek} log</span></div>
<hr class="rule">
${w.summary.length ? `<div class="callout"><h2>What changed from last week</h2><ul>${w.summary.map((s) => `<li>${s}</li>`).join('')}</ul></div>` : ''}
<div class="legend"><span><span class="tag t-up">UP</span> heavier, less assist or one more set</span><span><span class="tag t-hold">HOLD</span> same weight, chase the top of the range</span><span><span class="tag t-down">DOWN</span> lighter, back into the range</span><span><span class="tag t-coach">COACH</span> <span class="tag t-swap">SWAP</span> the coach's change</span></div>
${days || '<p class="muted">No workouts scheduled this week.</p>'}
</body></html>`;
}
