import type { WhenDto } from '@rove/shared';
import { CANDIDATE_UNDATED_TTL_DAYS } from '@rove/shared';

/* Reading dates the way Chinese ticketing sites print them, and nothing cleverer.
 *
 * `2026.09.20`, `2026-09-20`, `2026/09/20`, `2026年9月20日`, optionally followed by a weekday and
 * a `19:30`, optionally followed by a second date after `-`, `~`, `至` or `到`. Anything else is
 * `null`, which the UI shows as "time unknown" — the brief would rather see that than a guess. */

const DATE = String.raw`(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?`;
const TIME = String.raw`(?:\s*(?:周[一二三四五六日天]|星期[一二三四五六日天]|[A-Za-z]{3})?\s*(\d{1,2}):(\d{2}))?`;
const RANGE = new RegExp(`${DATE}${TIME}(?:\\s*[-~至到–]\\s*${DATE}${TIME})?`);

interface Stamp {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
}

const stamp = (m: (string | undefined)[], offset: number): Stamp | null => {
  const [year, month, day, hour, minute] = m.slice(offset, offset + 5);
  if (!year || !month || !day) return null;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour !== undefined ? Number(hour) : null,
    minute: minute !== undefined ? Number(minute) : null,
  };
};

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
export function parseWhen(text: string, tz: string): WhenDto | null {
  const m = text.match(RANGE);
  if (!m) return null;
  const start = stamp(m, 1);
  if (!start) return null;
  const end = stamp(m, 6);
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
