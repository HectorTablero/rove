import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_LOGO_PATHS, BRAND_LOGO_PATHS } from '@rove/shared';
import { describe, expect, it } from 'vitest';

/* The boot splash in index.html morphs the brand mark into the app mark before any JS runs, so
   its paths are written out by hand — and once already drifted (Rove shipped Diary's logo in
   it). Pinned here to the constants, with the pairing AnimatedLogo uses. */

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const from = (cls: string) => html.match(new RegExp(`<path class="${cls}" d="([^"]+)"`))?.[1];
const to = (cls: string) =>
  html.match(new RegExp(String.raw`#boot-splash\.morph \.${cls} \{\s*d: path\('([^']+)'\)`))?.[1];
const points = (d: string | undefined) => d?.match(/[ML]/g)?.length;

describe('boot splash', () => {
  const pairs = [
    ['bs-h', BRAND_LOGO_PATHS[0].d, APP_LOGO_PATHS[2].d],
    ['bs-c', BRAND_LOGO_PATHS[1].d, APP_LOGO_PATHS[1].d],
    ['bs-v', BRAND_LOGO_PATHS[2].d, APP_LOGO_PATHS[0].d],
  ] as const;

  it.each(pairs)('%s morphs from the brand mark into the app mark', (cls, brand, app) => {
    expect(from(cls)).toBe(brand);
    expect(to(cls)).toBe(app);
    // CSS only animates `d` between paths with the same commands; otherwise it jumps.
    expect(points(from(cls))).toBe(points(to(cls)));
  });
});
