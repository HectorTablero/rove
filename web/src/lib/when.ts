import type { WhenDto } from '@rove/shared';

/* Time windows, rendered and reasoned about in the region's zone — never the device's. A phone
   in Madrid looking at a Shenzhen concert should read the Shenzhen clock. */

const day = (iso: string, tz: string, lng: string): string =>
  new Intl.DateTimeFormat(lng, {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));

const time = (iso: string, tz: string, lng: string): string =>
  new Intl.DateTimeFormat(lng, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

/** "Sat 20 Sep · 19:30", "Sat 19 Sep – Mon 21 Sep", or "Sat 20 Sep" for an all-day single day. */
export function formatWhen(when: WhenDto, lng: string): string {
  const start = day(when.start, when.tz, lng);
  if (when.allDay) {
    if (!when.end) return start;
    const end = day(when.end, when.tz, lng);
    return end === start ? start : `${start} – ${end}`;
  }
  const startTime = time(when.start, when.tz, lng);
  if (!when.end) return `${start} · ${startTime}`;
  const endDay = day(when.end, when.tz, lng);
  const endTime = time(when.end, when.tz, lng);
  return endDay === start
    ? `${start} · ${startTime}–${endTime}`
    : `${start} · ${startTime} – ${endDay} · ${endTime}`;
}

/** The weekday (0 = Sunday) and hour of an instant in a zone, from Intl — no zone table. */
function zonedParts(at: Date, tz: string): { weekday: number; hour: number; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    weekday,
    hour: Number(get('hour')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The instant of `ymd` at `hour:00` in `tz`, by asking Intl what UTC that is. */
function zonedInstant(ymd: string, hour: number, tz: string): Date {
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

export interface Window {
  start: Date;
  end: Date;
}

/**
 * "This weekend": Friday 18:00 to Sunday 24:00 in the region's zone — the coming one, or the one
 * underway. Monday to Thursday it is the next; from Friday it is this. Nothing before *now* is
 * included, so an event that already started is not offered as a plan.
 */
export function weekendWindow(now: Date, tz: string): Window {
  const { weekday, ymd } = zonedParts(now, tz);
  // Days until Friday (0 on Friday, 1 on Thursday, 6 on Saturday → but Saturday is *this* weekend).
  const toFriday = weekday === 6 ? -1 : weekday === 0 ? -2 : (5 - weekday + 7) % 7;
  const friday = new Date(zonedInstant(ymd, 0, tz).getTime() + toFriday * 86_400_000);
  const fridayYmd = zonedParts(friday, tz).ymd;
  const start = zonedInstant(fridayYmd, 18, tz);
  const end = new Date(start.getTime() + (6 + 24 + 24) * 3_600_000); // Sun 24:00
  return { start: new Date(Math.max(start.getTime(), now.getTime())), end };
}

/** Whether a time window overlaps another. Open-ended windows count from their start. */
export function overlaps(when: WhenDto, window: Window): boolean {
  const start = Date.parse(when.start);
  const end = when.end ? Date.parse(when.end) : start;
  return start <= window.end.getTime() && end >= window.start.getTime();
}

export type WhenRange = 'today' | 'weekend' | 'week';

/** "Today": now until midnight in the region's zone. "Next 7 days": now plus a week. */
export function rangeWindow(range: WhenRange, now: Date, tz: string): Window {
  if (range === 'weekend') return weekendWindow(now, tz);
  if (range === 'week') return { start: now, end: new Date(now.getTime() + 7 * 86_400_000) };
  const midnight = zonedInstant(zonedParts(now, tz).ymd, 0, tz);
  return { start: now, end: new Date(midnight.getTime() + 86_400_000) };
}
