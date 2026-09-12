import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { installApiMock, SIGNED_IN_USER, type ApiMock } from './api';

/* Booting the app into a known state.
 *
 * Two halves are needed and neither is sufficient alone: the session call has to be answered (see
 * api.ts) *and* localStorage has to be seeded. The seeding uses `addInitScript` rather than an
 * `evaluate` after `goto`, because index.html runs a pre-paint script that reads `theme` and `lang`
 * before any module loads. */

interface BootOptions {
  /** Boot without an account, the way "continue without an account" does. */
  localOnly?: boolean;
  /** Passed to the app-lock module's storage, for the lock spec. */
  appLock?: unknown;
  /** Which palette to boot into. Never `'auto'` — that would depend on the runner's OS setting. */
  theme?: 'light' | 'dark';
  /** Boot as a device that has never run the app: no cached user and no local-only flag. */
  firstRun?: boolean;
}

export async function seedBrowserState(
  context: BrowserContext,
  options: BootOptions = {},
): Promise<void> {
  await context.addInitScript(
    ({ user, localOnly, appLock, theme, firstRun }) => {
      /* Belt to `serviceWorkers: 'block'`'s braces. workbox-window feature-detects
         `'serviceWorker' in navigator`, so hiding it makes registerSW a no-op even where the
         context option is unavailable. */
      Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });

      localStorage.setItem('theme', theme);
      localStorage.setItem('lang', 'en');
      if (!firstRun) localStorage.setItem('preferences', JSON.stringify({ onboardingSeen: true }));
      if (firstRun) {
        localStorage.removeItem('rove.user');
        localStorage.removeItem('rove.localOnly');
      } else if (localOnly) {
        localStorage.setItem('rove.localOnly', '1');
        localStorage.removeItem('rove.user');
      } else {
        /* Not only the offline-usable bypass in AppLayout: `syncNow()` returns immediately when
           `getCachedUser()` is null, so without this *nothing syncs at all* until AppLayout's
           session effect has run — which makes every sync assertion race a React effect. */
        localStorage.setItem('rove.user', JSON.stringify(user));
        localStorage.removeItem('rove.localOnly');
      }
      if (appLock) localStorage.setItem('appLock', JSON.stringify(appLock));
    },
    {
      user: { name: SIGNED_IN_USER.name, email: SIGNED_IN_USER.email, image: null },
      localOnly: options.localOnly ?? false,
      appLock: options.appLock ?? null,
      theme: options.theme ?? 'light',
      firstRun: options.firstRun ?? false,
    },
  );
}

/**
 * A page with the API mocked and the browser seeded, ready to navigate.
 *
 * Exposed as a fixture so a spec reads `test('…', async ({ page, api }) => …)` and cannot
 * accidentally navigate before the routes are installed.
 */
export const test = base.extend<{ api: ApiMock; app: Page }>({
  api: async ({ page }, use) => {
    await use(await installApiMock(page));
  },
  app: async ({ page, context, api }, use) => {
    void api; // ordering: the mock must be installed before anything navigates
    await seedBrowserState(context);
    await use(page);
  },
});

export { expect } from '@playwright/test';
