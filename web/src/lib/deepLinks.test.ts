import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/* The module is mocked rather than the env var stubbed. API_BASE is `import.meta.env.VITE_API_BASE`
   read at module scope, and Vite replaces that statically during transform — so by the time any
   stub could run, the value is already baked in as the empty string the web build uses, and every
   case below would return null for the wrong reason. */
vi.mock('./apiClient', () => ({ API_BASE: 'https://rove.tablerus.es' }));

import { routeForUrl } from './deepLinks';

/*
 * What the app is willing to open from a link.
 *
 * The list here has to stay in step with the `pathPrefix` entries in AndroidManifest.xml — Android
 * decides which URLs reach the app, this decides what happens to them once they arrive, and a gap
 * either way is silent. Too narrow and a claimed link opens the app on the wrong screen; too wide
 * and the app offers to handle URLs it cannot render.
 */
describe('routeForUrl', () => {
  it('opens the screens the manifest claims', () => {
    expect(routeForUrl('https://rove.tablerus.es/map')).toBe('/map');
    expect(routeForUrl('https://rove.tablerus.es/list')).toBe('/list');
    expect(routeForUrl('https://rove.tablerus.es/settings')).toBe('/settings');
  });

  it('keeps the query and hash, which is how the share target arrives', () => {
    expect(routeForUrl('https://rove.tablerus.es/add?text=https%3A%2F%2Fx.y')).toBe(
      '/add?text=https%3A%2F%2Fx.y',
    );
    expect(routeForUrl('https://rove.tablerus.es/list#top')).toBe('/list#top');
  });

  it('refuses another origin outright', () => {
    // A link that merely mentions the host must not be enough to steer the app.
    expect(routeForUrl('https://example.com/map')).toBeNull();
    expect(routeForUrl('https://rove.tablerus.es.evil.com/map')).toBeNull();
    expect(routeForUrl('http://rove.tablerus.es/map')).toBeNull(); // wrong scheme
  });

  it('never claims the API', () => {
    /* The most important case. /api is this app's own REST endpoint including the OAuth callback,
       and an app that offered to open those URLs could intercept a request meant for the server. */
    expect(routeForUrl('https://rove.tablerus.es/api/sync')).toBeNull();
    expect(routeForUrl('https://rove.tablerus.es/api/auth/callback/google')).toBeNull();
  });

  it('ignores paths the router has no screen for', () => {
    expect(routeForUrl('https://rove.tablerus.es/')).toBeNull();
    expect(routeForUrl('https://rove.tablerus.es/login')).toBeNull();
    expect(routeForUrl('https://rove.tablerus.es/.well-known/assetlinks.json')).toBeNull();
  });

  it('matches whole segments, not string prefixes', () => {
    expect(routeForUrl('https://rove.tablerus.es/mapping')).toBeNull();
    expect(routeForUrl('https://rove.tablerus.es/settingsx/y')).toBeNull();
  });

  it('cannot be walked out of its allowed prefixes', () => {
    // URL parsing resolves `..` before this ever sees it; pinned so that stays true.
    expect(routeForUrl('https://rove.tablerus.es/list/../api/sync')).toBeNull();
  });

  it('tolerates a trailing slash and rubbish input', () => {
    expect(routeForUrl('https://rove.tablerus.es/list/')).toBe('/list');
    expect(routeForUrl('not a url')).toBeNull();
    expect(routeForUrl('')).toBeNull();
  });

  it('accepts exactly what the manifest claims, and nothing else', () => {
    /* Two halves of one decision, in two files that cannot import each other: Android decides
       which URLs reach the app, this decides what becomes of them. Drift is silent in both
       directions — a prefix only in the manifest gives a link that opens the app and then does
       nothing, and one only here is dead code waiting to be trusted. */
    const manifest = readFileSync(
      fileURLToPath(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url)),
      'utf8',
    );
    const claimed = [...manifest.matchAll(/android:pathPrefix="([^"]+)"/g)].map((m) => m[1]).sort();

    expect(claimed.length).toBeGreaterThan(0);
    for (const prefix of claimed) {
      expect(
        routeForUrl(`https://rove.tablerus.es${prefix}`),
        `${prefix} is claimed but ignored`,
      ).toBe(prefix);
    }
  });
});
