import { useRef, useState } from 'react';
import {
  addDays,
  currentTargets,
  daysBetween,
  isoWeekday,
  logsReading,
  onTrackBand,
  projectNumberGoal,
  rollingAverage,
  shortDate,
  steadyRange,
  suggestPath,
  valueOnPath,
  weighInStatus,
  weightMilestones,
  weightWeeks,
  atPaceDate,
  dateIn,
  onPathDate,
  weightStopValues,
  isTally,
  type Goal,
  type ISODate,
  type Milestone,
  type Plan,
  type WeighInStatus,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { opsLogSession, opsReplacePath, opsRestoreSession } from '../data/ops.ts';
import { opsRecordReading } from '../data/connect.ts';
import { opsAddMilestone, opsToggleMilestone } from '../data/ops.ts';
import { opsDeleteMilestone, opsUpdateMilestone } from '../data/dated.ts';
import type { Op } from '../data/model.ts';
import { href } from '../router.ts';
import { Icon, useToast } from './ui.tsx';
import { FileThumb } from './Attachments.tsx';
import { photosOnGoal } from '../screens/PhotoTimeline.tsx';
import { WeightGoalChart, type WeightRange } from './WeightGoalChart.tsx';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Everything the weight page computes once: path, readings, the weigh-in's standing, the pace. */
function useWeight(goal: Goal, plan: Plan) {
  const { data, today } = useStore();
  const view = useView();
  const n = view.goalPace(goal, plan).number;
  const type = data.measurementTypes.find((m) => m.id === goal.measurement_type_id);
  const unit = goal.unit ?? type?.unit ?? '';
  const readings = view.measurementsFor(goal.measurement_type_id);
  const path = view.pathFor(goal);
  const target = goal.target_value ?? 0;
  const by = goal.target_date ?? plan.end_date;
  const start = n?.start ?? { date: readings[0]?.measured_on ?? today, value: Number(goal.baseline_value ?? readings[0]?.value ?? target) };
  const direction = Math.sign(target - start.value) || -1;
  const latest = readings.filter((r) => r.measured_on <= today).at(-1) ?? null;
  const pathAt = (d: ISODate) => valueOnPath(start, path, d);
  const statusOn = (w: number, d: ISODate): WeighInStatus => weighInStatus(w, pathAt(d), direction, unit);
  const proj = projectNumberGoal({ target_value: target, target_date: by }, readings, today);
  const perDay = proj.perDay ?? null;
  const pathPerWeek = (Math.abs(target - start.value) / Math.max(1, daysBetween(start.date, by))) * 7;
  const remaining = latest ? target - Number(latest.value) : target - start.value;
  const slowEta = latest && pathPerWeek > 0 ? addDays(latest.measured_on, Math.ceil((Math.abs(remaining) / pathPerWeek) * 7)) : null;
  const trendAt = (d: ISODate) => rollingAverage(readings, d);
  const band = onTrackBand(unit);
  const milestones = weightMilestones(start, path, target, readings, latest, perDay, unit);
  return { data, today, view, type, unit, readings, path, target, by, start, direction, latest, pathAt, statusOn, proj, perDay, pathPerWeek, slowEta, trendAt, band, milestones };
}

const chipStyle = (s: WeighInStatus | null) =>
  !s
    ? { background: 'var(--fill)', color: 'var(--muted)' }
    : s.zone === 'over'
      ? { background: 'var(--amber-soft)', color: 'var(--amber-ink)' }
      : { background: 'var(--blue-soft)', color: 'var(--blue-ink)' };

function Chip({ s, fallback }: { s: WeighInStatus | null; fallback?: string }) {
  return (
    <span className="wg-chip" style={chipStyle(s)}>
      <span className="wg-chip-dot" style={{ background: !s ? 'var(--faint)' : s.zone === 'over' ? 'var(--amber-bar)' : 'var(--blue)' }} />
      {s ? s.text : fallback}
    </span>
  );
}

/**
 * The left column of a weight goal: today's weigh-in as the headline, the chart (Week, 2W, 1M, 3M,
 * All) with this week's days and the day you tap, and week by week. Shared state, so tapping a week
 * opens its days in the chart.
 */
export function WeightProgress({ goal, plan, onSetWeek }: { goal: Goal; plan: Plan; onSetWeek: () => void }) {
  const w = useWeight(goal, plan);
  const { data, today, view, type, unit, readings, target, by, start, latest, statusOn, proj } = w;
  const { commit } = useStore();
  const toast = useToast();
  const [range, setRange] = useState<WeightRange>('week');
  const [picked, setPicked] = useState<ISODate>(latest?.measured_on ?? today);
  const [logging, setLogging] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);

  const latestValue = latest ? Number(latest.value) : null;
  const status = latest ? statusOn(Number(latest.value), latest.measured_on) : null;
  const total = Math.abs(target - start.value) || 1;
  const done = latestValue != null ? (start.value - latestValue) * -w.direction : 0;
  const prog = Math.max(0, Math.min(100, (done / total) * 100));
  const tick = Math.max(0, Math.min(100, ((Math.abs(w.pathAt(today) - start.value)) / total) * 100));
  const trendNow = latest ? w.trendAt(latest.measured_on) : null;
  const change = latestValue != null ? latestValue - start.value : null;
  const toGo = latestValue != null ? Math.abs(target - latestValue) : total;
  const loggedToday = latest?.measured_on === today;

  function saveReading() {
    const v = Number(value);
    if (!type || value.trim() === '' || !Number.isFinite(v)) {
      setError('Enter your weight');
      return;
    }
    const { ops, undo } = opsRecordReading(data, type.id, v, today);
    const task = data.sessions.find((x) => x.date === today && x.status === 'planned' && logsReading(view.action(x.action_id)?.kind) && view.action(x.action_id)?.measurement_type_id === type.id);
    commit([...ops, ...(task ? opsLogSession(task, { status: 'done', on: today }) : [])]);
    toast(`${type.name}: ${fmt(v)} ${unit}`.trim(), () => commit([...undo, ...(task ? opsRestoreSession(task) : [])]));
    setLogging(false);
    setValue('');
    setPicked(today);
  }

  // The pace in one or two sentences, and the levers when you're running late.
  const late = proj.eta && proj.daysOff != null && proj.daysOff > 7;
  let pace = '';
  if (proj.points < 3) pace = 'A few more weigh-ins and this will say when you get there at your current rate.';
  else if (!proj.eta) pace = `Over the last four weeks the trend is ${proj.ratePerWeek === 0 ? 'flat' : 'going the wrong way'}; at that rate ${fmt(target)} doesn’t arrive.`;
  else {
    const rate = `${fmt(Math.abs(proj.ratePerWeek ?? 0))} ${unit} a week`;
    const off = proj.daysOff ?? 0;
    const when = off < -13 ? `, ${Math.round(-off / 7)} weeks before your date` : off < -7 ? `, ${-off} days before your date` : off > 7 ? `, ${off} days after ${shortDate(by)}` : ', about on time';
    pace = `At your 4-week rate (${rate}) you reach ${fmt(target)} around ${shortDate(proj.eta)}${when}.`;
    if (!late && w.slowEta && w.slowEta <= by && w.slowEta > proj.eta) pace += ` Slow to the path’s pace (${fmt(w.pathPerWeek)} ${unit} a week) and you’d still get there ${shortDate(w.slowEta)}.`;
  }
  const moveDate = () => {
    if (!proj.eta) return;
    const eta = proj.eta as ISODate;
    const from = latestValue ?? start.value;
    const points = suggestPath(from, target, today, eta, plan.block_days);
    const replace = opsReplacePath(data, goal, points, today);
    const oldIds = currentTargets(data.goalTargets, goal.id).map((t) => t.id);
    const inserted = replace.flatMap((op) => (op.kind === 'insert' && op.collection === 'goalTargets' ? op.rows.map((r) => r.id) : []));
    commit([...replace, { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: eta } }]);
    const undo: Op[] = [
      ...inserted.map((id): Op => ({ kind: 'delete', collection: 'goalTargets', id })),
      ...oldIds.map((id): Op => ({ kind: 'update', collection: 'goalTargets', id, patch: { superseded_at: null } })),
      { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: goal.target_date ?? null } },
    ];
    toast(`Finish moved to ${shortDate(eta)}`, () => commit(undo));
  };

  // This week's days, for the strip under the chart (the week of the picked day).
  const monday = addDays(picked, 1 - isoWeekday(picked));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const readingOn = (d: ISODate) => readings.find((r) => r.measured_on === d) ?? null;
  const shots = photosOnGoal(data, goal);

  const pickedR = readingOn(picked);
  const prevR = readingOn(addDays(picked, -1));
  const pickedStatus = pickedR && picked >= start.date ? statusOn(Number(pickedR.value), picked) : null;
  const shot = shots.filter((s) => s.day === picked).at(-1) ?? null;
  const note = (() => {
    if (!pickedR) return picked < start.date ? 'Before this goal started.' : picked > today ? 'Still to come.' : 'No weigh-in this day.';
    const v = Number(pickedR.value);
    const firstR = readings.find((r) => r.measured_on >= start.date);
    if (firstR?.measured_on === picked) return 'Your first weigh-in for this goal. The path starts here.';
    if (prevR) {
      const d = v - Number(prevR.value);
      if (d * w.direction <= -1.2) {
        const kcal = Math.round((Math.abs(d) * (/kg/i.test(unit) ? 7700 : 3500)) / 100) * 100;
        return `Up ${fmt(Math.abs(d))} overnight. That’s water, salt and food, not fat: ${fmt(Math.abs(d))} ${unit} of fat in a day would take about ${kcal.toLocaleString()} extra calories. Your trend barely moved.`;
      }
      const prevStatus = statusOn(Number(prevR.value), prevR.measured_on);
      if (prevStatus.zone === 'over' && pickedStatus?.zone !== 'over') return 'Back inside the on-track zone.';
    }
    const best = readings.filter((r) => r.measured_on >= start.date && r.measured_on <= picked).reduce((m, r) => (w.direction < 0 ? Math.min(m, Number(r.value)) : Math.max(m, Number(r.value))), w.direction < 0 ? Infinity : -Infinity);
    if (v === best && change != null) return `Your best weigh-in yet, ${fmt(Math.abs(v - start.value))} ${unit} from where you started.`;
    if (pickedStatus?.zone === 'over') return `Over the zone today. One morning isn’t the trend: your 7-day average is ${fmt1(w.trendAt(picked) ?? v)}.`;
    if (prevR) {
      const d = v - Number(prevR.value);
      return `${d === 0 ? 'Same as' : `${d < 0 ? 'Down' : 'Up'} ${fmt(Math.abs(d))} from`} the day before.`;
    }
    return '';
  })();

  return (
    <>
      <section className="card wg-card" aria-label="Weight">
        <div className="wg-hero">
          <span className="mono">{loggedToday ? 'Today’s weigh-in' : latest ? `Last weigh-in · ${shortDate(latest.measured_on)}` : 'No weigh-ins yet'}</span>
          <span className="wg-now num">
            {latestValue != null ? fmt(latestValue) : '—'}
            <span className="wg-unit"> {unit}</span>
          </span>
          <span className="small muted">
            toward {fmt(target)} {unit} by {shortDate(by)}
            {change != null && Math.abs(change) >= 0.05 && (
              <>
                {' · '}
                {change * w.direction > 0 ? 'down' : 'up'} <b className="wg-ink">{fmt(Math.abs(change))}</b> since you started
              </>
            )}
            {' · '}
            <b className="wg-ink">{fmt(toGo)}</b> to go
          </span>
          <Chip s={status} fallback="Log a weigh-in to see where you stand" />
          {logging ? (
            <form
              className="row-start"
              style={{ flexWrap: 'nowrap', alignSelf: 'stretch' }}
              onSubmit={(e) => {
                e.preventDefault();
                saveReading();
              }}
            >
              <label className="visually-hidden" htmlFor="weigh-in-today">
                Today’s weight
              </label>
              <input id="weigh-in-today" className="input" type="number" step="any" inputMode="decimal" autoFocus value={value} placeholder={latestValue != null ? fmt(latestValue) : ''} onChange={(e) => (setValue(e.target.value), setError(''))} />
              <span className="small muted">{unit}</span>
              <button className="btn small primary" type="submit" style={{ minHeight: 44, flex: 'none' }}>
                Save
              </button>
              <button className="btn small" type="button" onClick={() => setLogging(false)} style={{ minHeight: 44, flex: 'none' }}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => (setValue(loggedToday && latestValue != null ? String(latestValue) : ''), setLogging(true))}>
              {loggedToday ? 'Change today’s weigh-in' : 'Log today’s weight'}
            </button>
          )}
          {error && <span className="xsmall" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>

        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="season-track" style={{ marginLeft: 0, height: 8 }} aria-label={`${Math.round(prog)}% of the way; the path is at ${Math.round(tick)}% today`}>
            <span className="season-fill" style={{ width: `${prog}%`, background: goal.color }} />
            <span className="season-tick" style={{ left: `${tick}%` }} />
          </span>
          <span className="row-between xsmall muted">
            <span>
              Start {fmt(start.value)} · {shortDate(start.date)}
            </span>
            <span>Tick: the path today</span>
            <span>
              {fmt(target)} · {shortDate(by)}
            </span>
          </span>
        </div>

        <div className="wg-stats">
          <div>
            <span>7-day average</span>
            <b style={{ color: 'var(--accent-ink)' }}>{trendNow != null ? fmt1(trendNow) : '—'}</b>
          </div>
          <div>
            <span>Rate, last 4 weeks</span>
            <b>{proj.ratePerWeek != null && proj.points >= 3 ? `${fmt(Math.abs(proj.ratePerWeek))} ${unit}/wk` : '—'}</b>
          </div>
          <div>
            <span>The path today</span>
            <b style={{ color: 'var(--blue-ink)' }}>{fmt1(w.pathAt(today))}</b>
          </div>
        </div>

        <div className="wg-pace">
          <span>{pace}</span>
          {late && (
            <span className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
              {proj.eta && proj.eta <= plan.end_date ? (
                <button className="btn small" onClick={moveDate}>
                  Move the date to {shortDate(proj.eta)}
                </button>
              ) : (
                proj.eta && <span className="xsmall muted">{shortDate(proj.eta)} is past the season ({shortDate(plan.end_date)}); the date can’t move that far.</span>
              )}
              <button className="btn small" onClick={onSetWeek}>
                Tighten this week
              </button>
            </span>
          )}
        </div>

        <div ref={chartRef}>
          <WeightGoalChart
            start={start}
            path={w.path}
            readings={readings}
            range={{ start: start.date, end: by }}
            today={today}
            unit={unit}
            band={w.band}
            perDay={w.perDay}
            target={target}
            slowEta={w.slowEta}
            milestones={w.milestones}
            trendAt={w.trendAt}
            rangeId={range}
            onRange={setRange}
            picked={range === 'week' ? picked : null}
            onPick={(d) => {
              setPicked(d);
              setRange('week');
            }}
          />
        </div>

        {range === 'week' ? (
          <>
            <div className="wg-days" role="group" aria-label="Days of the week">
              {weekDays.map((d, i) => {
                const r = readingOn(d);
                const on = d === picked;
                return (
                  <button key={d} type="button" aria-pressed={on} className={`wg-day${on ? ' on' : ''}${r ? '' : ' empty'}`} onClick={() => setPicked(d)} aria-label={`${DAY[i]} ${shortDate(d)}${r ? `, ${fmt(Number(r.value))} ${unit}` : ', no weigh-in'}`}>
                    <span className="wg-day-wd">
                      {WD[i]} {Number(d.slice(8))}
                    </span>
                    <b>{r ? fmt1(Number(r.value)) : '—'}</b>
                  </button>
                );
              })}
            </div>
            <div className="wg-detail" aria-live="polite">
              <div className="wg-detail-main">
                <b className="wg-detail-weight num">{pickedR ? fmt1(Number(pickedR.value)) : '—'}</b>
                <span className="small" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>
                  {DAY[isoWeekday(picked) - 1]}, {shortDate(picked)}
                  {picked === today ? ' · today' : ''}
                </span>
                {pickedR && picked >= start.date && <Chip s={pickedStatus} />}
                {note && <span className="small" style={{ lineHeight: 1.5, color: 'var(--ink-2)' }}>{note}</span>}
              </div>
              <div className="wg-detail-side">
                <div className="wg-detail-nums">
                  <span>
                    Day before
                    <b>{pickedR && prevR ? `${fmt1(Number(prevR.value))} (${Number(pickedR.value) - Number(prevR.value) > 0 ? '+' : '−'}${fmt1(Math.abs(Number(pickedR.value) - Number(prevR.value)))})` : '—'}</b>
                  </span>
                  <span>
                    Path
                    <b style={{ color: 'var(--blue-ink)' }}>{picked >= start.date ? fmt1(w.pathAt(picked)) : '—'}</b>
                  </span>
                  <span>
                    Trend
                    <b style={{ color: 'var(--accent-ink)' }}>{w.trendAt(picked) != null && picked >= start.date ? fmt1(w.trendAt(picked)!) : '—'}</b>
                  </span>
                </div>
                {shot && (
                  <div className="wg-shot">
                    <FileThumb file={shot.file} caption={`${shortDate(shot.day)}`} />
                    <a href={href(`/goals/${goal.id}/photos`)} className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
                      Compare in the timeline ›
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          readings.length > 0 && (
            <div>
              {[...readings].reverse().slice(0, 5).map((m) => (
                <div key={m.id} className="list-row small" style={{ minHeight: 40, padding: '8px 0' }}>
                  <span className="grow">{m.measured_on === today ? 'Today' : shortDate(m.measured_on)}</span>
                  <span className="num">
                    {fmt(Number(m.value))} {unit}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </section>

      <WeekByWeek
        w={w}
        onOpen={(sunday) => {
          setRange('week');
          setPicked(sunday > today ? today : sunday);
          chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
    </>
  );
}

function WeekByWeek({ w, onOpen }: { w: ReturnType<typeof useWeight>; onOpen: (lastDay: ISODate) => void }) {
  const { today, start, path, readings, unit, direction } = w;
  const weeks = weightWeeks(start, path, readings, today, addDays(today, 14), direction);
  const past = weeks.filter((x) => x.start <= today).slice(-4);
  const future = weeks.filter((x) => x.start > today).slice(0, 2);
  if (!past.length) return null;
  return (
    <section className="card stack-sm" aria-label="Week by week">
      <div className="row-between" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 17, fontWeight: 650 }}>Week by week</span>
        <span className="xsmall muted">Where each week ended against the path. Tap a week to see its days.</span>
      </div>
      <div className="wg-weeks">
        {[...past].reverse().map((x) => {
          const thisWeek = x.start <= today && today <= x.end;
          const over = x.aheadBy != null && x.aheadBy < -w.band;
          const ahead = x.aheadBy != null && x.aheadBy >= 0.05;
          return (
            <button key={x.start} type="button" className={`wg-week${over ? ' over' : x.last != null ? ' good' : ''}`} onClick={() => onOpen(x.end)}>
              <span className="xsmall muted">
                {shortDate(x.start)}
                {thisWeek ? ' · this week' : ''}
              </span>
              <b className="num">{x.last != null ? fmt1(x.last) : '—'}</b>
              <span className="xsmall muted">
                path {fmt1(x.pathEnd)}
                {x.average != null ? ` · avg ${fmt1(x.average)}` : ''}
              </span>
              {x.aheadBy != null && (
                <span className="xsmall" style={{ fontWeight: 650, color: over ? 'var(--amber-ink)' : 'var(--blue-ink)' }}>
                  {ahead ? `${fmt(x.aheadBy)} ahead` : over ? `${fmt(-x.aheadBy)} over` : 'On track'}
                  {x.change != null && Math.abs(x.change) >= 0.05 ? ` · ${x.change * direction > 0 ? 'down' : 'up'} ${fmt(Math.abs(x.change))}` : ''}
                </span>
              )}
            </button>
          );
        })}
        {future.map((x) => (
          <div key={x.start} className="wg-week future">
            <span className="xsmall muted">{shortDate(x.start)}</span>
            <b className="num muted">—</b>
            <span className="xsmall muted">
              {WD[6]} target {fmt1(x.pathEnd)} {unit}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The right column's weight cards: your pace against a steady range, the round-number milestones
 * at your pace and on the path, and (well ahead) the choice to keep the date or pull it in.
 */
export function WeightSide({ goal, plan }: { goal: Goal; plan: Plan }) {
  const w = useWeight(goal, plan);
  const { unit, proj, latest, target, by, today, data, start } = w;
  const { commit } = useStore();
  const toast = useToast();
  const [kept, setKept] = useState(false);
  const weight = latest ? Number(latest.value) : start.value;
  const steady = steadyRange(weight);
  // Positive = moving toward the target.
  const toward = proj.ratePerWeek != null && proj.points >= 3 ? proj.ratePerWeek * w.direction : null;
  const max = Math.max(3, (toward ?? 0) * 1.25, steady.high * 1.5);
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const firstWeeks = daysBetween(start.date, today) < 21;
  const paceText =
    toward == null
      ? 'A few more weigh-ins and this shows your pace.'
      : toward <= 0
        ? 'Over the last four weeks the trend has gone the wrong way. One flat week happens; two is a sign to tighten something.'
        : toward > steady.high
          ? `Fast for now${firstWeeks ? ', and that’s normal: the first weeks of a cut drop water and stored carbs, so expect this to settle toward' : '. Faster than about 1% a week risks muscle; a steadier'} ${fmt(steady.low)}–${fmt(steady.high)} ${unit} a week${firstWeeks ? '.' : ' keeps it.'}`
          : toward >= steady.low
            ? `Steady: ${fmt(steady.low)}–${fmt(steady.high)} ${unit} a week (0.5–1% of your weight) is the pace that keeps muscle.`
            : `Slower than steady. Your path needs ${fmt(w.pathPerWeek)} ${unit} a week.`;

  // Well ahead: keep the date as margin, or pull it in to where a steady 1% a week would land.
  const remaining = Math.abs(target - weight);
  const pullTo = latest ? addDays(latest.measured_on, Math.ceil((remaining / steady.high) * 7)) : null;
  const wellAhead = !kept && proj.eta && proj.daysOff != null && proj.daysOff < -14 && pullTo && pullTo < by && pullTo > proj.eta && daysBetween(today, proj.eta) > 14;
  const pullIn = () => {
    if (!pullTo) return;
    const points = suggestPath(weight, target, today, pullTo, plan.block_days);
    const replace = opsReplacePath(data, goal, points, today);
    const oldIds = currentTargets(data.goalTargets, goal.id).map((t) => t.id);
    const inserted = replace.flatMap((op) => (op.kind === 'insert' && op.collection === 'goalTargets' ? op.rows.map((r) => r.id) : []));
    commit([...replace, { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: pullTo } }]);
    const undo: Op[] = [
      ...inserted.map((id): Op => ({ kind: 'delete', collection: 'goalTargets', id })),
      ...oldIds.map((id): Op => ({ kind: 'update', collection: 'goalTargets', id, patch: { superseded_at: null } })),
      { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: goal.target_date ?? null } },
    ];
    toast(`Finish pulled in to ${shortDate(pullTo)}`, () => commit(undo));
  };

  return (
    <>
      <section className="card stack-sm" aria-label="Your pace">
        <span style={{ fontSize: 17, fontWeight: 650 }}>Your pace</span>
        <span className="small muted" style={{ marginTop: -4 }}>
          {toward != null ? (
            <>
              <b className="wg-ink">
                {fmt(Math.abs(proj.ratePerWeek ?? 0))} {unit} a week
              </b>{' '}
              over the last four weeks
            </>
          ) : (
            'Not enough weigh-ins yet'
          )}
        </span>
        <div className="wg-meter" aria-hidden="true">
          <span className="wg-meter-steady" style={{ left: pos(steady.low), width: `calc(${pos(steady.high)} - ${pos(steady.low)})` }} />
          <span className="wg-meter-fast" style={{ left: pos(steady.high) }} />
          <span className="wg-meter-path" style={{ left: pos(w.pathPerWeek) }} />
          {toward != null && toward > 0 && <span className="wg-meter-you" style={{ left: pos(toward) }} />}
        </div>
        <span className="row-between xsmall muted">
          <span>Slow</span>
          <span style={{ color: 'var(--blue-ink)' }}>
            Steady {fmt(steady.low)}–{fmt(steady.high)} · path {fmt(w.pathPerWeek)}
          </span>
          {toward != null && toward > 0 && <span style={{ color: 'var(--accent-ink)', fontWeight: 650 }}>You {fmt(toward)}</span>}
        </span>
        <span className="small" style={{ lineHeight: 1.5, color: 'var(--ink-2)' }}>{paceText}</span>
      </section>

      <WeightMilestonesCard goal={goal} plan={plan} />

      {wellAhead && pullTo && (
        <section className="card stack-sm" aria-label="Ahead by weeks">
          <span style={{ fontSize: 17, fontWeight: 650 }}>Ahead by weeks</span>
          <span className="small" style={{ lineHeight: 1.5, color: 'var(--ink-2)' }}>
            Keep {shortDate(by)} and bank the margin for holidays and slow weeks, or pull the date in to {shortDate(pullTo)}: that asks for about {fmt(steady.high)} {unit} a week.
          </span>
          <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small primary" onClick={() => setKept(true)}>
              Keep {shortDate(by)}
            </button>
            <button className="btn small" onClick={pullIn}>
              Pull in to {shortDate(pullTo)}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/** A heading with a short explanation on hover, focus or tap. */
function InfoTip({ label, text, align = 'left' }: { label: string; text: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="wg-tip-wrap">
      <button type="button" className="wg-tip-btn" aria-expanded={open} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}>
        {label} <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <span role="tooltip" className={`wg-tip ${align}`}>
          {text}
        </span>
      )}
    </span>
  );
}

const ROUND_KEY = (goalId: string) => `six.milestones.round.${goalId}`;

/**
 * A weight goal's milestones: one list of weights on the way, each with its prize, when you get there
 * at your pace and where the path has you. These are the goal's milestones (the same ones the
 * roadmap, calendar and Prizes use): each ticks itself the morning a weigh-in reaches it. Adding one
 * asks for a weight and a prize; its date is the path's. Milestones set off the app's stops (184.2)
 * get a one-time offer to round to them (185), prizes and all.
 */
function WeightMilestonesCard({ goal, plan }: { goal: Goal; plan: Plan }) {
  const w = useWeight(goal, plan);
  const { data, unit, start, path, target, latest, perDay, by, direction } = w;
  const { commit } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null); // milestone id, or 'new'
  const [wInput, setWInput] = useState('');
  const [prizeInput, setPrizeInput] = useState('');
  const [roundGone, setRoundGone] = useState(() => {
    try {
      return localStorage.getItem(ROUND_KEY(goal.id)) === '1';
    } catch {
      return false;
    }
  });
  const tz = data.profile.timezone;
  const all = data.milestones.filter((m) => m.goal_id === goal.id);
  const weighted = all.filter((m) => m.value != null && !isTally(m) && !m.count_action_id).sort((a, b) => (Number(b.value) - Number(a.value)) * (direction < 0 ? 1 : -1));
  const dated = all.filter((m) => !weighted.includes(m) && !isTally(m)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const stops = weightStopValues(start.value, target, unit);
  const dueFor = (v: number) => onPathDate(start, path, v) ?? by;
  const titleFor = (v: number) => `${fmt(v)} ${unit}`.trim();
  const downText = (v: number) => `${fmt(Math.abs(start.value - v))} ${unit} ${direction < 0 ? 'down' : 'up'}`;

  // Milestones that sit off the app's stops: each to its nearest free stop.
  const used = new Set(weighted.map((m) => Number(m.value)));
  const rounding: { m: Milestone; to: number }[] = [];
  for (const m of weighted) {
    const v = Number(m.value);
    if (m.completed_at || stops.includes(v)) continue;
    const near = stops.filter((x) => !used.has(x) && !rounding.some((r) => r.to === x)).sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0];
    if (near != null && Math.abs(near - v) <= (/kg/i.test(unit) ? 2.5 : 5)) rounding.push({ m, to: near });
  }
  const dismissRound = () => {
    setRoundGone(true);
    try {
      localStorage.setItem(ROUND_KEY(goal.id), '1');
    } catch {
      // storage blocked: the offer comes back next visit
    }
  };
  const doRound = () => {
    const ops = rounding.flatMap(({ m, to }) => opsUpdateMilestone(m, { value: to, title: titleFor(to), due_date: dueFor(to) }));
    const undo = rounding.flatMap(({ m }): Op[] => [{ kind: 'update', collection: 'milestones', id: m.id, patch: { value: m.value, title: m.title, due_date: m.due_date } }]);
    commit(ops);
    dismissRound();
    toast('Rounded to the app’s stops. Your prizes moved with them.', () => commit(undo));
  };

  const open = (m: Milestone | null) => {
    setEditing(m ? m.id : 'new');
    setWInput(m && m.value != null ? String(m.value) : '');
    setPrizeInput(m?.prize ?? '');
  };
  const wNum = Number(wInput);
  const wOk = wInput.trim() !== '' && Number.isFinite(wNum) && (direction < 0 ? wNum < start.value && wNum > target : wNum > start.value && wNum < target);
  const save = () => {
    if (!wOk) return;
    if (editing === 'new') {
      commit(opsAddMilestone(goal.id, titleFor(wNum), dueFor(wNum), { value: wNum, prize: prizeInput.trim() }));
      toast(`Milestone added: ${titleFor(wNum)}`);
    } else {
      const m = all.find((x) => x.id === editing);
      if (m) {
        const moved = Number(m.value) !== wNum;
        commit(opsUpdateMilestone(m, { value: wNum, prize: prizeInput.trim(), ...(moved ? { title: titleFor(wNum), due_date: dueFor(wNum) } : {}) }));
      }
    }
    setEditing(null);
  };
  const remove = () => {
    const m = all.find((x) => x.id === editing);
    if (!m) return;
    commit(opsDeleteMilestone(m));
    toast(`Removed ${m.title}`, () => commit([{ kind: 'insert', collection: 'milestones', rows: [m as unknown as { id: string } & Record<string, unknown>] }]));
    setEditing(null);
  };
  const addStops = () => {
    const ops = stops.flatMap((v) => opsAddMilestone(goal.id, titleFor(v), dueFor(v), { value: v }));
    commit(ops);
    toast(`Added ${stops.map((v) => fmt(v)).join(', ')}`);
  };

  const form = (
    <div className="wg-ms-form" role="group" aria-label={editing === 'new' ? 'Add a milestone' : 'Change milestone'}>
      <b className="small">{editing === 'new' ? 'Add a milestone' : 'Change milestone'}</b>
      <div className="row-start" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 'none' }}>
          Weight
          <span className="row-start" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input type="number" step="any" inputMode="decimal" autoFocus value={wInput} onChange={(e) => setWInput(e.target.value)} placeholder={stops[0] != null ? fmt(stops[0]) : ''} style={{ width: 100 }} />
            {wOk && <span className="small" style={{ color: 'var(--ink)' }}>{downText(wNum)}</span>}
          </span>
        </label>
        <label className="field" style={{ flex: '1 1 180px' }}>
          Prize (optional)
          <input value={prizeInput} onChange={(e) => setPrizeInput(e.target.value)} placeholder="e.g. New running shoes" />
        </label>
      </div>
      <span className="xsmall muted">
        {wOk ? `On your calendar and roadmap on ${shortDate(dueFor(wNum))}, where the path has you there.` : `Between ${fmt(start.value)} and ${fmt(target)} ${unit}.`}
      </span>
      <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn small primary" disabled={!wOk} onClick={save}>
          Save
        </button>
        <button type="button" className="btn small" onClick={() => setEditing(null)}>
          Cancel
        </button>
        {editing !== 'new' && (
          <button type="button" className="link-btn small" style={{ color: 'var(--danger)' }} onClick={remove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );

  const rows = [...weighted.map((m) => ({ m, value: Number(m.value) })), { m: null as Milestone | null, value: target }];
  const nextOpen = rows.find((r) => (r.m ? !r.m.completed_at : !(latest && (direction < 0 ? Number(latest.value) <= target : Number(latest.value) >= target))));

  return (
    <section className="card stack-sm" aria-label="Milestones">
      <div className="row-between">
        <span className="label">Milestones</span>
        <button type="button" className="link-btn small" onClick={() => open(null)}>
          + Add a milestone
        </button>
      </div>

      {!roundGone && rounding.length > 0 && (
        <div className="wg-round">
          <b className="small">Round your milestones to the app’s stops?</b>
          <span className="small" style={{ lineHeight: 1.5 }}>
            {rounding.map((r) => `${fmt(Number(r.m.value))} → ${fmt(r.to)}`).join(', ')}. Your prizes move with them, and their dates move to where your path has you ({rounding.map((r) => shortDate(dueFor(r.to))).join(', ')}).
          </span>
          <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn small primary" onClick={doRound}>
              Round them
            </button>
            <button type="button" className="btn small" onClick={dismissRound}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      {weighted.length === 0 && stops.length > 0 && (
        <div className="wg-round">
          <span className="small" style={{ lineHeight: 1.5 }}>
            Stops on the way down, each ticking itself when you get there: {stops.map((v) => fmt(v)).join(', ')}. Put a prize on the ones you want to work for.
          </span>
          <button type="button" className="btn small primary" style={{ alignSelf: 'flex-start' }} onClick={addStops}>
            Add the app’s stops
          </button>
        </div>
      )}

      <div className="wg-ms4 head xsmall muted">
        <span />
        <span>Milestone</span>
        <InfoTip label="At your pace" text={`If you keep losing what you have over the last four weeks${w.proj.ratePerWeek != null ? ` (${fmt(Math.abs(w.proj.ratePerWeek))} ${unit} a week)` : ''}, this is when you get there. It moves as your pace changes.`} />
        <InfoTip label="On the path" align="right" text={`Where your plan has you: the steady line from your start to ${fmt(target)} by ${shortDate(by)}. Be there by this date and you stay on schedule. It’s also when the milestone shows on your calendar and roadmap.`} />
      </div>

      {rows.map(({ m, value }) => {
        const reached = m ? !!m.completed_at : !!latest && (direction < 0 ? Number(latest.value) <= value : Number(latest.value) >= value);
        const reachedOn = m?.completed_at ? dateIn(tz, m.completed_at) : null;
        const pace = atPaceDate(latest, value, perDay);
        const onPath = onPathDate(start, path, value);
        const toGo = latest ? Math.max(0, (Number(latest.value) - value) * (direction < 0 ? 1 : -1)) : null;
        const isNext = nextOpen && (nextOpen.m ? nextOpen.m === m : !m);
        return (
          <div key={m?.id ?? 'goal'} className={`wg-ms4${reached ? ' reached' : ''}`}>
            <span className={`wg-ring${reached ? ' on' : ''}`} aria-label={reached ? 'Reached' : 'Not yet'}>
              {reached && <Icon name="check" size={12} stroke={3.4} />}
            </span>
            <span className="stack-sm" style={{ gap: 3, minWidth: 0 }}>
              {m ? (
                <button type="button" className="wg-ms-name" onClick={() => open(m)} aria-label={`Change the ${fmt(value)} milestone`}>
                  <b className="num">{fmt(value)}</b>
                  <span className="xsmall muted">{downText(value)}</span>
                </button>
              ) : (
                <span className="wg-ms-name">
                  <b className="num">{fmt(value)}</b>
                  <span className="xsmall muted">The goal</span>
                </span>
              )}
              {m?.prize?.trim() ? (
                <span className="wg-prize">
                  <Icon name="gift" size={13} stroke={2} />
                  <span>{m.prize}</span>
                </span>
              ) : (
                m && !reached && (
                  <button type="button" className="link-btn xsmall" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => open(m)}>
                    + Add a prize
                  </button>
                )
              )}
              {!reached && isNext && toGo != null && <span className="xsmall muted">{fmt(toGo)} {unit} to go</span>}
              {m && reached && m.prize?.trim() && !m.prize_claimed_at && (
                <button
                  type="button"
                  className="btn small wg-claim"
                  onClick={() => {
                    commit([{ kind: 'update', collection: 'milestones', id: m.id, patch: { prize_claimed_at: new Date().toISOString() } }]);
                    toast(`Enjoy it: ${m.prize}`);
                  }}
                >
                  Claim your prize
                </button>
              )}
              {m && reached && m.prize_claimed_at && <span className="xsmall" style={{ color: 'var(--blue-ink)', fontWeight: 650 }}>Prize claimed</span>}
            </span>
            <b className="small" style={{ color: reached ? 'var(--blue-ink)' : 'var(--accent-ink)' }}>{reached ? `Reached${reachedOn ? ` ${shortDate(reachedOn)}` : ''}` : pace ? shortDate(pace) : '—'}</b>
            <span className="small muted">{onPath ? shortDate(onPath) : '—'}</span>
          </div>
        );
      })}

      {dated.length > 0 && (
        <div className="stack-sm" style={{ gap: 0, marginTop: 4 }}>
          <span className="xsmall muted">Other dates</span>
          {dated.map((m) => (
            <div key={m.id} className="row-between small" style={{ minHeight: 44, borderTop: '1px solid var(--line-2)' }}>
              <span className="row-start" style={{ gap: 8 }}>
                <button type="button" className={`wg-ring${m.completed_at ? ' on' : ''}`} aria-label={m.completed_at ? `${m.title} done, tap to reopen` : `Mark ${m.title} done`} onClick={() => commit(opsToggleMilestone(m))}>
                  {m.completed_at && <Icon name="check" size={12} stroke={3.4} />}
                </button>
                {m.title}
                {m.prize?.trim() ? <span className="xsmall muted">· {m.prize}</span> : null}
              </span>
              <span className="muted">{shortDate(m.due_date)}</span>
            </div>
          ))}
        </div>
      )}

      {editing && form}

      <span className="xsmall muted" style={{ lineHeight: 1.45 }}>
        Each ticks itself the first morning you weigh in at or {direction < 0 ? 'under' : 'over'} it. They show on your calendar and roadmap on their path date, and their prizes in Prizes.
      </span>
    </section>
  );
}
