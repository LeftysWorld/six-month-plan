import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, weekStart, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { BackLink, useToast } from '../components/ui.tsx';
import { sheetDate, sheetMonday, weekSheet, weekSheetHtml } from '../data/weekSheet.ts';
import { navigate } from '../router.ts';

/**
 * The week sheet: this week's (or next week's) lifting, day by day, in the same layout as the
 * weekly PDFs. "Save as PDF" prints the sheet on its own; "Open as a page" is for phones, where
 * Share → Print → Save to Files makes the PDF.
 */
export function WeekSheetScreen({ week }: { week: string | null }) {
  const { data, today } = useStore();
  const toast = useToast();
  const thisMonday = weekStart(today);
  const monday = (week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : sheetMonday(today)) as ISODate;
  const sheet = useMemo(() => weekSheet(data, monday, today), [data, monday, today]);
  const html = useMemo(() => weekSheetHtml(sheet), [sheet]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  // The sheet is its own page; size the frame to it so the screen scrolls, not the frame.
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    const fit = () => {
      const doc = f.contentDocument;
      if (doc?.body) setHeight(doc.documentElement.scrollHeight + 4);
    };
    f.addEventListener('load', fit);
    const t = window.setTimeout(fit, 300);
    return () => {
      f.removeEventListener('load', fit);
      window.clearTimeout(t);
    };
  }, [html]);

  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };
  const openPage = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const tab = window.open(url, '_blank');
    if (!tab) toast("Couldn't open a new tab here: allow pop-ups, or use Save as PDF");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const go = (m: ISODate) => navigate(`/workouts/week?week=${m}`);

  return (
    <div className="stack">
      <BackLink label="Back" fallback="/workouts/report" />
      <h1>Week sheet</h1>
      <p className="small muted" style={{ margin: '-6px 0 0' }}>
        Every workout of the week with its weight, sets and reps from your progression rules, and what you did last time.
        {sheet.coach ? ` It includes the coach's changes from ${sheetDate(sheet.coach.as_of)}.` : ''}
      </p>
      <div className="card stack-sm no-print">
        <div className="seg" role="tablist" aria-label="Which week">
          <button role="tab" aria-selected={monday === thisMonday} onClick={() => go(thisMonday)}>
            This week · {sheetDate(thisMonday)}
          </button>
          <button role="tab" aria-selected={monday === addDays(thisMonday, 7)} onClick={() => go(addDays(thisMonday, 7))}>
            Next week · {sheetDate(addDays(thisMonday, 7))}
          </button>
        </div>
        <div className="row-start" style={{ gap: 8 }}>
          <button type="button" className="btn primary" onClick={print}>
            Save as PDF
          </button>
          <button type="button" className="btn ghost" onClick={openPage}>
            Open as a page
          </button>
        </div>
        <span className="xsmall muted">On a phone: Open as a page, then Share → Print → Save to Files for the PDF.</span>
      </div>
      <iframe ref={frame} className="week-sheet-frame" title="Week sheet" srcDoc={html} style={{ height }} />
    </div>
  );
}
