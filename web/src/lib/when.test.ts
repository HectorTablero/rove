import { describe, expect, it } from 'vitest';
import type { ItemDto } from '@rove/shared';
import {
  bySoonest,
  endsWithin,
  formatWhen,
  otherYear,
  overlaps,
  rangeWindow,
  weekendWindow,
} from './when';

const TZ = 'Asia/Shanghai';

describe('formatWhen', () => {
  it('renders in the region zone, not the device zone', () => {
    // 19:30 in Shenzhen is 11:30Z; a device in Madrid must still read 19:30.
    const text = formatWhen(
      { start: '2026-09-20T11:30:00.000Z', end: null, tz: TZ, allDay: false },
      'en-GB',
    );
    expect(text).toMatch(/Sun.*20 Sep.*19:30/);
  });

  it('renders an all-day range as two days and a single day as one', () => {
    expect(
      formatWhen(
        {
          start: '2026-09-18T16:00:00.000Z',
          end: '2026-09-21T15:59:00.000Z',
          tz: TZ,
          allDay: true,
        },
        'en-GB',
      ),
    ).toMatch(/19 Sep.*–.*21 Sep/);
    expect(
      formatWhen(
        {
          start: '2026-09-18T16:00:00.000Z',
          end: '2026-09-19T15:59:00.000Z',
          tz: TZ,
          allDay: true,
        },
        'en-GB',
      ),
    ).not.toContain('–');
  });
});

describe('otherYear', () => {
  it("is true only outside this year, in the region's clock", () => {
    const now = new Date('2026-11-04T08:00:00Z');
    expect(otherYear('2026-12-31T15:00:00.000Z', TZ, now)).toBe(false);
    // 31 Dec 16:00Z is already 1 Jan in Shenzhen.
    expect(otherYear('2026-12-31T16:00:00.000Z', TZ, now)).toBe(true);
    expect(otherYear('2025-06-01T00:00:00.000Z', TZ, now)).toBe(true);
  });
});

describe('endsWithin', () => {
  // Next 7 days from Wed 4 Nov 2026.
  const week = { start: new Date('2026-11-04T08:00:00Z'), end: new Date('2026-11-11T08:00:00Z') };
  const w = (start: string, end: string | null) => ({ start, end, tz: TZ, allDay: false });

  it('puts a weekend run, and one begun before but over within the week, in the window', () => {
    expect(endsWithin(w('2026-11-06T16:00:00Z', '2026-11-08T15:59:00Z'), week)).toBe(true);
    expect(endsWithin(w('2025-09-01T00:00:00Z', '2026-11-08T15:59:00Z'), week)).toBe(true);
    expect(endsWithin(w('2026-11-07T11:30:00Z', null), week)).toBe(true);
  });

  it('leaves a run that goes on past the window to the second group', () => {
    expect(endsWithin(w('2025-08-31T16:00:00Z', '2026-12-31T15:59:00Z'), week)).toBe(false);
  });
});

describe('weekendWindow', () => {
  it('on a Wednesday points at the coming Friday evening through Sunday night, Shenzhen time', () => {
    const { start, end } = weekendWindow(new Date('2026-09-16T04:00:00.000Z'), TZ); // Wed 12:00 SZ
    expect(start.toISOString()).toBe('2026-09-18T10:00:00.000Z'); // Fri 18:00 SZ
    expect(end.toISOString()).toBe('2026-09-20T16:00:00.000Z'); // Sun 24:00 SZ
  });

  it('on a Saturday is the weekend underway, starting now', () => {
    const now = new Date('2026-09-19T06:00:00.000Z'); // Sat 14:00 SZ
    const { start, end } = weekendWindow(now, TZ);
    expect(start.toISOString()).toBe(now.toISOString());
    expect(end.toISOString()).toBe('2026-09-20T16:00:00.000Z');
  });

  it('on a Sunday night rolls to the next weekend', () => {
    const { start } = weekendWindow(new Date('2026-09-20T17:00:00.000Z'), TZ); // Mon 01:00 SZ
    expect(start.toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });
});

describe('overlaps', () => {
  const window = {
    start: new Date('2026-09-18T10:00:00.000Z'),
    end: new Date('2026-09-20T16:00:00.000Z'),
  };
  it('counts an event inside, straddling, or open-ended from inside', () => {
    expect(
      overlaps({ start: '2026-09-19T11:00:00.000Z', end: null, tz: TZ, allDay: false }, window),
    ).toBe(true);
    expect(
      overlaps(
        {
          start: '2026-09-10T00:00:00.000Z',
          end: '2026-09-25T00:00:00.000Z',
          tz: TZ,
          allDay: true,
        },
        window,
      ),
    ).toBe(true);
    expect(
      overlaps({ start: '2026-09-22T11:00:00.000Z', end: null, tz: TZ, allDay: false }, window),
    ).toBe(false);
  });
});

describe('rangeWindow', () => {
  it('today ends at the next midnight in the zone, not the device', () => {
    const now = new Date('2026-09-16T04:00:00.000Z'); // Wed 12:00 in Shenzhen
    const { start, end } = rangeWindow('today', now, 'Asia/Shanghai');
    expect(start).toEqual(now);
    expect(end.toISOString()).toBe('2026-09-16T16:00:00.000Z'); // Thu 00:00 Shenzhen
  });

  it('next 7 days is a week from now', () => {
    const now = new Date('2026-09-16T04:00:00.000Z');
    expect(rangeWindow('week', now, 'Asia/Shanghai').end.toISOString()).toBe(
      '2026-09-23T04:00:00.000Z',
    );
  });
});

describe('bySoonest', () => {
  const now = '2026-11-04T08:00:00.000Z';
  const event = (title: string, start: string | null, end: string | null = null) =>
    ({
      kind: 'event',
      title,
      createdAt: '2026-11-01T00:00:00.000Z',
      when: start ? { start, end, tz: 'Asia/Shanghai', allDay: false } : null,
    }) as unknown as ItemDto;

  it('puts dated events first, then open runs, then undated, and finished last', () => {
    const items = [
      event('finished', '2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
      event('undated', null),
      event('6 Nov', '2026-11-06T11:30:00.000Z', '2026-11-06T13:30:00.000Z'),
      event('10 Oct – 20 Nov', '2026-10-09T16:00:00.000Z', '2026-11-20T15:59:00.000Z'),
      event('5 Nov', '2026-11-05T11:30:00.000Z'),
      event('from 1 Dec', '2026-11-30T16:00:00.000Z', '2027-01-15T15:59:00.000Z'),
    ];
    expect(items.sort(bySoonest(now)).map((i) => (i as { title: string }).title)).toEqual([
      '5 Nov',
      '6 Nov',
      '10 Oct – 20 Nov',
      'from 1 Dec',
      'undated',
      'finished',
    ]);
  });
});
