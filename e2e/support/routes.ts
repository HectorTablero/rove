import type { Locator, Page } from '@playwright/test';

/* The app's screens, each paired with proof that it actually rendered.
 *
 * `navigation.spec.ts` walks it to prove every lazy chunk resolves in the built artefact. The
 * `proof` locator is not decoration: every page is a lazy `import()` behind a Suspense boundary,
 * so `goto` resolving means the *URL* changed and nothing more — what is on screen at that moment
 * is a spinner. Waiting on the page's own content is what turns the check into one about chunks.
 */

export interface AppRoute {
  path: string;
  /** Something only this page renders, on the far side of its Suspense boundary. */
  proof: (page: Page) => Locator;
}

/** The map page having rendered — also the "the app booted" check every spec opens with. */
export const mapHeading = (page: Page): Locator => page.getByRole('heading', { name: 'Map' });

export const ROUTES: AppRoute[] = [
  { path: '/map', proof: mapHeading },
  { path: '/list', proof: (page) => page.getByRole('heading', { name: 'List' }) },
  { path: '/add', proof: (page) => page.getByRole('heading', { name: 'Add' }) },
  { path: '/settings', proof: (page) => page.getByRole('switch', { name: 'Require a passcode' }) },
];
