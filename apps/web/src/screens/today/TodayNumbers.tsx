import { useState } from 'react';
import type { Session } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { href } from '../../router.ts';
import { fmt } from '../../data/derive.ts';
import { useView } from '../../data/useView.ts';
import { opsLogSession, opsRestoreSession } from '../../data/ops.ts';
import { lastReading, measureLabel, measureOnToday, opsRecordReading, readingOn } from '../../data/connect.ts';
import { nextValuedPrize } from '../../data/prizes.ts';
import { shortDate, type Goal } from '@six/core';
import { Icon, useToast } from '../../components/ui.tsx';
import { FileThumb, useAddFiles } from '../../components/Attachments.tsx';
import { usePhotoInput } from '../../components/usePhotoInput.tsx';

/**
 * Today's numbers: the measurements you've set to show on Today (a goal's main number by default),
 * logged right here so you never have to open each goal. Stopped measurements never show. One
 * that already has a "Log a number" task today is left to that task.
 */
export function TodayNumbers({ photoSessions }: { photoSessions: Session[] }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const { addFiles, uploading } = useAddFiles();
  const photo = usePhotoInput(async (s, files) => {
    const added = await addFiles(s, files, { quiet: true });
    if (added === 0) return;
    if (s.status === 'planned') {
      commit(opsLogSession(s, { status: 'done', on: today }));
      toast(`${s.title}: saved`, () => commit(opsRestoreSession(s)));
    } else toast(`${s.title}: photo added`);
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState<Record<string, boolean>>({});

  const liveGoals = data.goals.filter((g) => !g.archived_at && !g.completed_at);
  const taskTypes = new Set(
    data.sessions
      .filter((s) => s.date === today && s.status !== 'skipped')
      .map((s) => data.actions.find((a) => a.id === s.action_id))
      .filter((a) => a?.kind === 'measure' && a.measurement_type_id)
      .map((a) => a!.measurement_type_id!),
  );
  const rows = data.measurementTypes
    .filter((t) => measureOnToday(data, t.id) && !taskTypes.has(t.id))
    .map((t) => ({ type: t, goal: liveGoals.find((g) => g.id === t.goal_id || g.measurement_type_id === t.id) }))
    .filter((r): r is { type: typeof r.type; goal: NonNullable<typeof r.goal> } => !!r.goal)
    .sort((a, b) => Number(b.goal.measurement_type_id === b.type.id) - Number(a.goal.measurement_type_id === a.type.id));
  if (rows.length === 0 && photoSessions.length === 0) return null;

  const title = rows.length && photoSessions.length ? 'Today’s numbers and photos' : photoSessions.length ? 'Today’s photos' : 'Today’s numbers';

  function save(typeId: string, name: string, unit: string) {
    const raw = (values[typeId] ?? '').trim();
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) return;
    const { ops, undo } = opsRecordReading(data, typeId, v, today);
    commit(ops);
    toast(`${name}: ${fmt(v)} ${unit}`.trim(), () => commit(undo));
    setValues({ ...values, [typeId]: '' });
    setChanging({ ...changing, [typeId]: false });
  }

  // "· next prize: 184.2 lb by Dec 13 · 1.6 to go" for a number goal with a dated prize ahead.
  function nextPrizeText(goal: Goal, current: number | null): string {
    const m = nextValuedPrize(view, goal);
    if (!m || m.value == null) return '';
    const gap = current != null ? Math.abs(current - m.value) : null;
    return ` · next prize at ${fmt(m.value)} ${goal.unit ?? ''} by ${shortDate(m.due_date)}${gap != null && gap > 0 ? ` · ${fmt(gap)} to go` : ''}`;
  }

  return (
    <section className="card tight stack-sm today-numbers" aria-label={title}>
      <span className="label">{title}</span>
      {photo.input}
      {rows.map(({ type, goal }) => {
        const logged = readingOn(data, type.id, today);
        const last = lastReading(data, type.id);
        const editing = logged == null || changing[type.id];
        return (
          <form
            key={type.id}
            className="today-number"
            onSubmit={(e) => {
              e.preventDefault();
              save(type.id, type.name, type.unit);
            }}
          >
            <span className="dot" style={{ background: goal.color }} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="today-number-name">{measureLabel(type)}</span>
              <span className="xsmall muted today-number-goal">
                {goal.title}
                {nextPrizeText(goal, logged ?? last?.value ?? null)}
              </span>
            </span>
            {editing ? (
              <>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  aria-label={`${type.name} today${type.unit ? ` (${type.unit})` : ''}`}
                  placeholder={last ? fmt(last.value) : ''}
                  value={values[type.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [type.id]: e.target.value })}
                />
                <span className="small muted">{type.unit}</span>
                <button className="btn small primary" type="submit" disabled={(values[type.id] ?? '').trim() === ''}>
                  Save
                </button>
              </>
            ) : (
              <>
                <span className="num">
                  <Icon name="check" size={13} stroke={3} /> {fmt(logged!)} {type.unit}
                </span>
                <button type="button" className="link-btn xsmall" onClick={() => setChanging({ ...changing, [type.id]: true })}>
                  Change
                </button>
              </>
            )}
          </form>
        );
      })}
      {photoSessions.map((s) => {
        const goal = view.goalsForAction(s.action_id).find((g) => !g.archived_at);
        const files = data.attachments.filter((a) => a.session_id === s.id);
        const done = s.status !== 'planned';
        return (
          <div key={s.id} className="today-number">
            <span className="dot" style={{ background: goal?.color ?? 'var(--muted)' }} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="today-number-name">{s.title}</span>
              {goal && (
                <span className="xsmall muted today-number-goal">
                  {goal.title}
                  {' · '}
                  <a href={href(`/goals/${goal.id}/photos`)}>timeline</a>
                </span>
              )}
            </span>
            {files.slice(-2).map((f) => (
              <span key={f.id} className="today-photo">
                <FileThumb file={f} caption="" />
              </span>
            ))}
            {done && files.length > 0 && <Icon name="check" size={13} stroke={3} />}
            <button
              type="button"
              className={`btn small${done ? '' : ' primary'}`}
              disabled={uploading > 0}
              onClick={() => photo.pick(s)}
            >
              <Icon name="camera" size={16} /> {uploading > 0 ? '…' : done ? 'Add' : 'Take'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

/**
 * "+ Add a task" on Today (or any other day): something to do that day. Two kinds, each with its
 * own options:
 * - General: a title, a goal or none, and about how long. With no goal it's a one-off; it can be
 *   linked to a goal later from its log sheet.
 * - Workout: do one of your workouts again that day, or make a new one with its exercises (sets,
 *   reps, weight), for a goal or none. It logs like any workout.
 */
