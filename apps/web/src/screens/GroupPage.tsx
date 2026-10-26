import { useState } from 'react';
import { shortDate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { seasonsOf } from '../data/season.ts';
import { groupMembers, opsUngroup } from '../data/groups.ts';
import { runningSchedule } from '../data/connect.ts';
import { describeSchedule } from '@six/core';
import { GroupSheet, sharedTasksOf } from '../components/Connections.tsx';
import { MoveSheet } from '../components/MoveSheet.tsx';
import { navigate } from '../router.ts';
import { BackLink, Empty, useToast } from '../components/ui.tsx';
import { GoalRow, GroupRollup, WeekStrip, placeGoals } from './Season.tsx';

/**
 * A group's own page, like an open folder: its goals this season and next as rows, the tasks they
 * share with this week's days logged, and its actions (edit, move, ungroup).
 */
export function GroupPage({ id }: { id: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<'edit' | 'share' | null>(null);
  const [moving, setMoving] = useState(false);
  const group = data.groups.find((g) => g.id === id);
  if (!group) return <Empty title="This group isn’t here anymore." />;
  const seasons = seasonsOf(view);
  const placed = placeGoals(view, data, today, seasons).filter((p) => p.card.goal.group_id === group.id);
  const now = placed.filter((p) => p.season !== 'next');
  const later = placed.filter((p) => p.season === 'next');
  const members = groupMembers(data, group.id);
  const shared = sharedTasksOf(view, members);
  const card = (title: string, rows: typeof placed) => (
    <section className="season-card" aria-label={title}>
      <div className="season-card-head">
        <span className="season-card-title">
          <span className="mono">{title}</span>
        </span>
      </div>
      {rows.map((m) => (
        <GoalRow key={m.card.goal.id} placed={m} />
      ))}
    </section>
  );
  return (
    <div className="stack rise">
      <BackLink label="Goals" fallback="/goals" />
      <div className="stack-sm" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 32 }}>{group.name}</h1>
        <span className="small muted">
          {now.length} goal{now.length === 1 ? '' : 's'} this season{later.length ? ` · ${later.length} next season` : ''}
        </span>
      </div>
      <section className="card" style={{ padding: 0 }}>
        <GroupRollup group={group} big />
      </section>
      <div className="season-layout">
        <div className="season-main">
          {now.length > 0 && card(seasons.current ? `THIS SEASON · BY ${shortDate(seasons.current.end_date).toUpperCase()}` : 'NOW', now)}
          {later.length > 0 && card(seasons.next ? `NEXT SEASON · BY ${shortDate(seasons.next.end_date).toUpperCase()}` : 'NEXT SEASON', later)}
          {placed.length === 0 && <div className="card small muted">None of this group’s goals are running right now.</div>}
        </div>
        <aside className="season-aside">
          <section className="season-card" aria-label="Shared this week">
            <div className="outcomes-head">
              <b>Shared this week</b>
              <span className="xsmall muted">Logged once, counts for every goal here</span>
            </div>
            {shared.length === 0 && <span className="small muted outcome-row">No shared tasks yet.</span>}
            {shared.map((a) => {
              const sch = runningSchedule(data, a.id, today);
              return (
                <div key={a.id} className="shared-row">
                  <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                    <span className="small">{a.title}</span>
                    <span className="xsmall muted">{sch ? describeSchedule(sch) : 'ended'}</span>
                  </span>
                  <WeekStrip actionId={a.id} />
                </div>
              );
            })}
            <div className="group-actions">
              <button className="link-btn small" onClick={() => setEditing('edit')}>
                Edit group
              </button>
              <button className="link-btn small" onClick={() => setEditing('share')}>
                Share a task
              </button>
              {now.length > 0 && (
                <button className="link-btn small" onClick={() => setMoving(true)}>
                  Move
                </button>
              )}
              <button
                className="link-btn small"
                style={{ color: 'var(--danger)' }}
                onClick={() => {
                  commit(opsUngroup(data, group));
                  toast(`${group.name} ungrouped. The goals and their tasks are unchanged.`);
                  navigate('/goals');
                }}
              >
                Ungroup
              </button>
            </div>
          </section>
        </aside>
      </div>
      {editing && <GroupSheet group={group} startSharing={editing === 'share'} onClose={() => setEditing(null)} />}
      {moving && <MoveSheet goals={now.map((p) => p.card.goal)} title={group.name} onClose={() => setMoving(false)} />}
    </div>
  );
}
