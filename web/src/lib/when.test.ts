import { describe, expect, it } from 'vitest';
import { formatWhen, overlaps, weekendWindow } from './when';

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
