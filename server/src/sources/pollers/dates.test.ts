import { describe, expect, it } from 'vitest';
import { expiryFor, labelled, parseWhen, zoneOffsetMinutes } from './dates';

const TZ = 'Asia/Shanghai';

describe('parseWhen', () => {
  it('reads a dotted date with a weekday and a time, in the region zone', () => {
    const when = parseWhen('演出时间：2026.09.20 周日 19:30', TZ);
    expect(when).toEqual({
      start: '2026-09-20T11:30:00.000Z',
      end: null,
      tz: TZ,
      allDay: false,
    });
  });

  it('reads a range, and ends an all-day range at the end of its last day', () => {
    const when = parseWhen('2026-09-19 至 2026-09-21', TZ);
    expect(when?.start).toBe('2026-09-18T16:00:00.000Z');
    expect(when?.end).toBe('2026-09-21T15:59:00.000Z');
    expect(when?.allDay).toBe(true);
  });

  it('reads the Chinese date form', () => {
    expect(parseWhen('2026年10月1日 20:00', TZ)?.start).toBe('2026-10-01T12:00:00.000Z');
  });

  it('is null rather than a guess for text with no date', () => {
    expect(parseWhen('周末见', TZ)).toBeNull();
    expect(parseWhen('票价 80 元', TZ)).toBeNull();
  });
});

describe('zoneOffsetMinutes', () => {
  it('knows Shenzhen is UTC+8 all year', () => {
    expect(zoneOffsetMinutes(TZ, new Date('2026-01-15T00:00:00Z'))).toBe(480);
    expect(zoneOffsetMinutes(TZ, new Date('2026-07-15T00:00:00Z'))).toBe(480);
  });
});

describe('expiryFor', () => {
  const now = new Date('2026-09-12T00:00:00.000Z');

  it('expires an event after its window', () => {
    const when = {
      start: '2026-09-20T11:30:00.000Z',
      end: '2026-09-20T14:00:00.000Z',
      tz: TZ,
      allDay: false,
    };
    expect(expiryFor(when, now)).toBe('2026-09-20T14:00:00.000Z');
  });

  it('keeps an already-past event a day so it is at least seen', () => {
    const when = { start: '2026-09-01T11:30:00.000Z', end: null, tz: TZ, allDay: false };
    expect(expiryFor(when, now)).toBe('2026-09-13T00:00:00.000Z');
  });

  it('gives an undated candidate a month', () => {
    expect(expiryFor(null, now)).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('labelled', () => {
  it('returns the value after the first matching label', () => {
    const text = '演出城市：深圳\n场馆：深圳湾体育中心\n演出时间：2026.09.20';
    expect(labelled(text, ['场馆', '地点'])).toBe('深圳湾体育中心');
    expect(labelled(text, ['地点'])).toBeNull();
  });
});
