import { describe, expect, it } from 'vitest';
import {
  geoPointSchema,
  itemCreateSchema,
  itemUpdateSchema,
  mentionSchema,
  settingsSchema,
  whenSchema,
} from './schemas';

const place = {
  regionId: 'shenzhen',
  kind: 'place' as const,
  title: '文和友',
  location: { point: { lon: 114.05, lat: 22.53, datum: 'GCJ02' as const } },
};

describe('geoPointSchema', () => {
  it('requires a datum — a bare pair is the bug this type exists to prevent', () => {
    expect(() => geoPointSchema.parse({ lon: 114, lat: 22 })).toThrow();
    expect(geoPointSchema.parse({ lon: 114, lat: 22, datum: 'WGS84' }).datum).toBe('WGS84');
  });

  it('rejects a swapped pair (a latitude past 90 is a longitude)', () => {
    expect(() => geoPointSchema.parse({ lon: 22.5, lat: 114.05, datum: 'GCJ02' })).toThrow();
  });
});

describe('itemCreateSchema', () => {
  it('requires a location on a place and forbids one on a film', () => {
    expect(() => itemCreateSchema.parse({ ...place, location: undefined })).toThrow();
    const film = itemCreateSchema.parse({ regionId: 'shenzhen', kind: 'film', title: 'Dune' });
    expect('location' in film).toBe(false);
    expect(film.kind === 'film' && film.when).toBeNull();
  });

  it('lets an event carry no time rather than inventing one', () => {
    const event = itemCreateSchema.parse({ regionId: 'shenzhen', kind: 'event', title: '灯光秀' });
    expect(event.kind === 'event' && event.when).toBeNull();
    expect(event.kind === 'event' && event.location).toBeNull();
  });

  it('defaults a fresh item to saved with empty lists', () => {
    const parsed = itemCreateSchema.parse(place);
    expect(parsed.status).toBe('saved');
    expect(parsed.altTitles).toEqual([]);
    expect(parsed.snapshotIds).toEqual([]);
    expect(parsed.kind === 'place' && parsed.location.address).toBeNull();
  });
});

describe('itemUpdateSchema', () => {
  it('omits keys that were not sent, so a replayed old PATCH cannot blank them', () => {
    const parsed = itemUpdateSchema.parse({ title: 'New name' });
    expect(Object.keys(parsed)).toEqual(['title']);
  });

  it('has no kind or regionId: those are identity, not contents', () => {
    const parsed = itemUpdateSchema.parse({ kind: 'film', regionId: 'tokyo', title: 'x' });
    expect('kind' in parsed).toBe(false);
    expect('regionId' in parsed).toBe(false);
  });
});

describe('whenSchema', () => {
  it('refuses an end before its start', () => {
    expect(() =>
      whenSchema.parse({
        start: '2026-10-02T12:00:00.000Z',
        end: '2026-10-01T12:00:00.000Z',
        tz: 'Asia/Shanghai',
      }),
    ).toThrow();
  });
});

describe('mentionSchema', () => {
  it('requires evidence — a mention with nothing to point at is a guess', () => {
    expect(() => mentionSchema.parse({ nameText: '文和友', evidence: '' })).toThrow();
  });
});

describe('settingsSchema', () => {
  it('strips a trailing slash from the LLM base URL', () => {
    const parsed = settingsSchema.parse({
      regionId: 'shenzhen',
      quietNotifications: true,
      llmBaseUrl: 'http://spark.local:8000/v1/',
      llmModel: 'qwen',
    });
    expect(parsed.llmBaseUrl).toBe('http://spark.local:8000/v1');
    expect('llmApiKey' in parsed).toBe(false);
  });
});
