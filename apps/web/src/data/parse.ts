import { addDays, isoWeekday, type ISODate } from '@six/core';

/**
 * Quick add in plain words, parsed on the device (no AI):
 *   "guitar 20m mon wed fri"       → repeats Mon/Wed/Fri, 20 min
 *   "call mom tomorrow !"          → one-off tomorrow, priority
 *   "stretch 10 min daily #splits" → every day, linked to the goal matching "splits"
 *   "apply to 3 jobs fri"          → one-off on the coming Friday
 */
export interface ParsedTask {
  title: string;
  minutes: number | null;
  /** ISO weekdays (1 = Monday) when the task repeats; empty for a one-off. */
  days: number[];
  /** Date for a one-off task (null = the day you're adding it to). */
  date: ISODate | null;
  priority: boolean;
  /** The word after #, used to find a goal. */
  goalTag: string | null;
}

const DAY_WORDS: [RegExp, number][] = [
  [/^mon(day)?s?$/, 1],
  [/^tue(s|sday)?s?$/, 2],
  [/^wed(nesday)?s?$/, 3],
  [/^thu(r|rs|rsday)?s?$/, 4],
  [/^fri(day)?s?$/, 5],
  [/^sat(urday)?s?$/, 6],
  [/^sun(day)?s?$/, 7],
];

export function parseQuickAdd(input: string, today: ISODate): ParsedTask {
  let text = ` ${input.trim()} `;
  let minutes: number | null = null;
  let priority = false;
  let goalTag: string | null = null;
  let date: ISODate | null = null;
  const days = new Set<number>();
  let repeat = false;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (m) {
      fn(m);
      text = text.replace(m[0], ' ');
    }
  };

  take(/\s#([\p{L}\p{N}_-]+)/u, (m) => (goalTag = m[1]!.toLowerCase()));
  take(/\s(!|priority)(?=\s)/i, () => (priority = true));
  take(/\s(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)(?=\s)/i, (m) => (minutes = Math.round(Number(m[1]) * 60)));
  if (minutes == null) take(/\s(\d+)\s*(m|min|mins|minute|minutes)(?=\s)/i, (m) => (minutes = Number(m[1])));
  take(/\s(every\s*day|daily)(?=\s)/i, () => {
    repeat = true;
    [1, 2, 3, 4, 5, 6, 7].forEach((d) => days.add(d));
  });
  take(/\s(weekdays|every\s+weekday)(?=\s)/i, () => {
    repeat = true;
    [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  });
  take(/\s(weekends|every\s+weekend)(?=\s)/i, () => {
    repeat = true;
    [6, 7].forEach((d) => days.add(d));
  });
  take(/\stoday(?=\s)/i, () => (date = today));
  take(/\stomorrow(?=\s)/i, () => (date = addDays(today, 1)));
  take(/\severy(?=\s)/i, () => (repeat = true));

  // Day names: two or more (or "every fri") repeat; a single one is the next such day.
  const words = text.trim().split(/\s+/);
  const kept: string[] = [];
  const named: number[] = [];
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[,.]$/, '');
    const hit = DAY_WORDS.find(([re]) => re.test(clean));
    if (hit && clean.length >= 3) named.push(hit[1]);
    else kept.push(w);
  }
  if (named.length > 1 || (named.length === 1 && repeat)) named.forEach((d) => days.add(d));
  else if (named.length === 1) {
    const ahead = (named[0]! - isoWeekday(today) + 7) % 7;
    date = addDays(today, ahead);
  }

  const title = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : '',
    minutes,
    days: [...days].sort((a, b) => a - b),
    date,
    priority,
    goalTag,
  };
}
