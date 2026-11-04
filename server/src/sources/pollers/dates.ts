import type { WhenDto } from '@rove/shared';
import { CANDIDATE_UNDATED_TTL_DAYS } from '@rove/shared';

/* Reading dates the way Chinese ticketing sites print them, and nothing cleverer.
 *
 * `2026.09.20`, `2026-09-20`, `2026/09/20`, `2026年9月20日`, optionally followed by a weekday and
 * a `19:30`, optionally followed by a second date after `-`, `~`, `至` or `到`. Anything else is
 * `null`, which the UI shows as "time unknown" — the brief would rather see that than a guess.
 *
 * Douban writes the start of a range without its year — `11月05日 周四 00:00 ~ 2027年02月28日` —
 * so a date may omit the year, but only in the `MM月DD日` form: a bare `1-2` or `39.0` is a count
 * or a price, never a date. A missing year comes from the other end of the range, or else is the
 * one that puts the date nearest the poll without being more than four months behind it. */

// Five groups: year, month, day with a year; or month, day in the 月日 form without one.
const DATE = String.raw`(?:(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?|(\d{1,2})月(\d{1,2})日)`;
const TIME = String.raw`(?:\s*(?:周[一二三四五六日天]|星期[一二三四五六日天]|[A-Za-z]{3})?\s*(\d{1,2}):(\d{2}))?`;
const RANGE = new RegExp(`${DATE}${TIME}(?:\\s*[-~至到–]\\s*${DATE}${TIME})?`, 'g');
/** Groups per end of a range: five for the date, two for the time. */
const END_GROUPS = 7;

interface Stamp {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
}
type Loose = Omit<Stamp, 'year'> & { year: number | null };

/** One end of a match, or null when that end is absent or not a real calendar day. */
const stamp = (m: (string | undefined)[], offset: number): Loose | null => {
  const [year, month, day, bareMonth, bareDay, hour, minute] = m.slice(offset, offset + END_GROUPS);
  const mo = Number(month ?? bareMonth);
  const d = Number(day ?? bareDay);
  if (!mo || !d || mo > 12 || d > 31) return null;
  return {
    year: year ? Number(year) : null,
    month: mo,
    day: d,
    hour: hour !== undefined ? Number(hour) : null,
    minute: minute !== undefined ? Number(minute) : null,
  };
};

const monthDay = (s: { month: number; day: number }) => s.month * 100 + s.day;

/** The year that puts a month-day nearest `now` without falling more than ~4 months behind it. */
function nearestYear(s: { month: number; day: number }, now: Date, tz: string): number {
  const current = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(now),
  );
  const floor = now.getTime() - 120 * 86_400_000;
  for (const year of [current - 1, current, current + 1])
    if (Date.UTC(year, s.month - 1, s.day) >= floor) return year;
  return current + 1;
}

/** A wall-clock instant in a zone, as an ISO string. Only correct for zones without DST offsets
    that vary across the year — Asia/Shanghai is UTC+8 year-round, which is the region that exists.
    A DST region would replace this with a real zone library. */
export function zonedIso(s: Stamp, tz: string): string {
  const offsetMinutes = zoneOffsetMinutes(tz, new Date(Date.UTC(s.year, s.month - 1, s.day)));
  const utc =
    Date.UTC(s.year, s.month - 1, s.day, s.hour ?? 0, s.minute ?? 0) - offsetMinutes * 60_000;
  return new Date(utc).toISOString();
}

/** The zone's UTC offset at an instant, from Intl — no table to keep. */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The first date or date range in a piece of text, as a time window in the region's zone. */
export function parseWhen(text: string, tz: string, now: Date = new Date()): WhenDto | null {
  /* A date that states its year beats one that leaves it out: `9月27日晚（2026-09-27 19:30）`
     means the second, which also carries the time. Yearless dates are the fallback. */
  let fallback: WhenDto | null = null;
  for (const m of text.matchAll(RANGE)) {
    const first = stamp(m, 1);
    if (!first) continue;
    const second = stamp(m, 1 + END_GROUPS);
    const when = toWindow(first, second, tz, now);
    if (first.year !== null || second?.year != null) return when;
    fallback ??= when;
  }
  return fallback;
}

function toWindow(first: Loose, second: Loose | null, tz: string, now: Date): WhenDto {
  // A missing year comes from the other end of the range, else from the poll date.
  const startYear =
    first.year ??
    (second?.year != null
      ? second.year - (monthDay(first) > monthDay(second) ? 1 : 0)
      : nearestYear(first, now, tz));
  const start: Stamp = { ...first, year: startYear };
  const end: Stamp | null = second
    ? { ...second, year: second.year ?? startYear + (monthDay(second) < monthDay(start) ? 1 : 0) }
    : null;
  const allDay = start.hour === null;
  const startIso = zonedIso(start, tz);
  let endIso: string | null = null;
  if (end) {
    // An all-day range ends at the end of its last day.
    endIso = zonedIso(end.hour === null ? { ...end, hour: 23, minute: 59 } : end, tz);
  } else if (allDay) {
    endIso = zonedIso({ ...start, hour: 23, minute: 59 }, tz);
  }
  if (endIso && endIso < startIso) endIso = null;
  return { start: startIso, end: endIso, tz, allDay };
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** A schema.org `startDate`/`endDate` pair — local wall-clock times without an offset, as Douban's
    event pages write them (`2025-09-01T00:00:00` → `2026-12-31T23:59:59`) — as a window in `tz`.
    Midnight to 23:59 is a run of whole days, which is how a months-long exhibition is meant. */
export function windowFromSchemaDates(
  start: string | null,
  end: string | null,
  tz: string,
): WhenDto | null {
  const read = (text: string | null): Stamp | null => {
    const m = text ? ISO_LOCAL.exec(text) : null;
    if (!m) return null;
    const [year, month, day, hour, minute] = m.slice(1).map(Number);
    return { year, month, day, hour, minute };
  };
  const from = read(start);
  if (!from) return null;
  const to = read(end);
  const allDay =
    from.hour === 0 && from.minute === 0 && (!to || (to.hour === 23 && to.minute === 59));
  const startIso = zonedIso(from, tz);
  const endIso = to
    ? zonedIso(to, tz)
    : allDay
      ? zonedIso({ ...from, hour: 23, minute: 59 }, tz)
      : null;
  return { start: startIso, end: endIso && endIso > startIso ? endIso : null, tz, allDay };
}

/** When a candidate leaves the inbox: after its window, or a month from now if it has none. */
export function expiryFor(
  when: WhenDto | null,
  now: Date,
  ttlDays = CANDIDATE_UNDATED_TTL_DAYS,
): string {
  if (when) {
    const endMs = Date.parse(when.end ?? when.start);
    // An event that already happened would expire in the past; keep it a day so it is at least
    // seen, rather than created and swept in the same minute.
    return new Date(Math.max(endMs, now.getTime() + 86_400_000)).toISOString();
  }
  return new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
}

/** The line after a label such as `演出时间：`, or null. */
export function labelled(text: string, labels: string[]): string | null {
  for (const line of text.split('\n')) {
    for (const label of labels) {
      if (line.startsWith(label)) {
        const value = line
          .slice(label.length)
          .replace(/^[:：\s]+/, '')
          .trim();
        if (value) return value;
      }
    }
  }
  return null;
}
