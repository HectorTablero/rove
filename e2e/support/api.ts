import type { Page, Route } from '@playwright/test';
import type {
  ImpressionDto,
  ItemDto,
  ReviewDto,
  SettingsDto,
  SnapshotDto,
  SyncResponse,
} from '@rove/shared';
import { DEFAULT_SETTINGS } from '@rove/shared';

/* The server, as a fixture.
 *
 * Stateful rather than a pile of one-off `page.route` calls, because most of these specs are about
 * state moving *through* it: a write leaves the browser, lands here, and comes back on the next
 * pull. Typed against `SyncResponse` from `@rove/shared` — the same type the real route returns —
 * so the fixture cannot drift away from the server without the typecheck saying so. */

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

interface ApiState {
  items: ItemDto[];
  snapshots: SnapshotDto[];
  reviews: ReviewDto[];
  impressions: ImpressionDto[];
  settings: SettingsDto;
  deletions: SyncResponse['deletions'];
}

interface Rejection {
  method: string;
  path: RegExp;
  status: number;
  code: string;
}

/** What the mocked resolver and geocoder answer with, so specs can assert on the same words. */
export const FIXTURES = {
  caption: '周末去了 Bionic Brew，在南山海上世界，精酿不错。',
  candidate: {
    name: 'Bionic Brew',
    district: '南山区',
    location: {
      point: { lon: 113.9167, lat: 22.4869, datum: 'GCJ02' as const },
      address: '南山区 海上世界',
      providerRef: { provider: 'amap', id: 'B0FFH1TEST' },
    },
  },
};

export interface ApiMock {
  state: ApiState;
  fixtures: typeof FIXTURES;
  /** What GET /api/sources/status answers; specs set it before navigating. */
  sourceStatus: {
    sourceId: string;
    down: boolean;
    lastRun: {
      at: string;
      ok: boolean;
      found: number;
      created: number;
      error: string | null;
      trigger: string;
    } | null;
  }[];
  /** What POST /api/sources/poll answers. */
  pollRuns: {
    sourceId: string;
    ok: boolean;
    found: number;
    created: number;
    error: string | null;
  }[];
  /** Every API call the app made, in order. */
  calls: RecordedCall[];
  /** Answer the next pull with the whole state and `reset: true`. */
  nextPullIsReset(): void;
  /** Refuse the next matching write once, the way a validation failure would. */
  rejectOnce(rejection: Rejection): void;
  /** Make the server unreachable *without* taking the network down. */
  setUnreachable(down: boolean): void;
  /** Resolve once the app has made a matching call. */
  waitForCall(method: string, path: RegExp, timeoutMs?: number): Promise<RecordedCall>;
}

export const SIGNED_IN_USER = {
  id: 'user_e2e',
  name: 'E2E User',
  email: 'e2e@example.com',
  emailVerified: true,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SESSION = {
  id: 'sess_e2e',
  userId: SIGNED_IN_USER.id,
  token: 'e2e-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function installApiMock(
  page: Page,
  seed: Partial<ApiState> = {},
  options: { signedIn?: boolean } = {},
): Promise<ApiMock> {
  const { signedIn = true } = options;

  const state: ApiState = {
    items: [],
    snapshots: [],
    reviews: [],
    impressions: [],
    settings: { ...DEFAULT_SETTINGS },
    deletions: [],
    ...seed,
  };
  const calls: RecordedCall[] = [];
  let forceReset = false;
  let unreachable = false;
  const rejections: Rejection[] = [];

  const record = (route: Route): RecordedCall => {
    const request = route.request();
    const call: RecordedCall = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (() => {
        try {
          return request.postDataJSON();
        } catch {
          return undefined;
        }
      })(),
    };
    calls.push(call);
    return call;
  };

  /* Registration order is load-bearing: Playwright matches the *most recently* registered route
     first, so the catch-all has to go on first or it would swallow everything below it. */
  await page.route('**/api/**', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    await json(route, { error: 'errors.not_found' }, 404);
  });

  await page.route('**/api/health', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    await json(route, { ok: true });
  });

  await page.route('**/api/auth/**', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    if (route.request().url().includes('get-session')) {
      // `null` is better-auth's signed-out answer, and a 200 — not a 401.
      return json(route, signedIn ? { session: SESSION, user: SIGNED_IN_USER } : null);
    }
    await json(route, { error: 'errors.not_found' }, 404);
  });

  /* Deliberately refused. `page.route` does not intercept WebSocket handshakes, so if the ticket
     succeeded the app would open a real socket against `vite preview` and re-arm a ten-second
     reconnect for the rest of the run. */
  await page.route('**/api/sync/ws-ticket', async (route) => {
    record(route);
    await json(route, { error: 'errors.unavailable' }, 503);
  });

  await page.route('**/api/sync*', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    const since = new URL(route.request().url()).searchParams.get('since');
    const reset = forceReset || !since;
    forceReset = false;
    const response: SyncResponse = {
      serverTime: new Date().toISOString(),
      reset,
      items: state.items,
      snapshots: state.snapshots,
      reviews: state.reviews,
      impressions: state.impressions,
      settings: state.settings,
      // A reset carries no tombstones — the ids it omits *are* the deletions.
      deletions: reset ? [] : state.deletions,
    };
    await json(route, response);
  });

  /* The paste pipeline: a link resolves to the fixture caption, extraction is "not configured"
     (the honest default without a model), and the geocoder answers one candidate for its name. */
  await page.route('**/api/ingest/resolve', async (route) => {
    const call = record(route);
    if (unreachable) return route.abort('connectionfailed');
    const { url } = call.body as { url: string };
    // Instagram as it answers now: the post is there, its text is not.
    if (url.includes('/p/UNREADABLE')) {
      return json(route, {
        sourceId: 'instagram-oembed',
        fetchedAt: new Date().toISOString(),
        canonicalUrl: url,
        contentType: 'text/html',
        body: '',
        // What the Open Graph fallback finds on the login wall: the page title, nothing more.
        text: 'Instagram',
        error: 'caption_missing',
        title: null,
      });
    }
    await json(route, {
      sourceId: url.includes('xhslink') ? 'xiaohongshu-share' : 'generic-og',
      fetchedAt: new Date().toISOString(),
      canonicalUrl: url,
      contentType: 'application/json',
      body: '{}',
      text: FIXTURES.caption,
      error: null,
      title: null,
    });
  });
  await page.route('**/api/ingest/extract', async (route) => {
    record(route);
    await json(route, { error: 'extract.not_configured' }, 503);
  });
  await page.route('**/api/geocode/suggest*', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const hit = FIXTURES.candidate.name.toLowerCase().includes(q.trim().toLowerCase());
    await json(route, { candidates: hit ? [FIXTURES.candidate] : [] });
  });
  /* The feeds: a status the spec can shape (`api.sourceStatus`), and a poll that answers with
     whatever the spec put in `api.pollRuns`. */
  await page.route('**/api/sources/status', async (route) => {
    record(route);
    await json(route, { sources: mock.sourceStatus });
  });
  await page.route('**/api/sources/poll', async (route) => {
    record(route);
    await json(route, { runs: mock.pollRuns });
  });

  await page.route('**/api/geocode/usage*', async (route) => {
    record(route);
    await json(route, { configured: true, month: '2026-09', calls: 12, limit: 5000, stopAt: 4500 });
  });

  await page.route('**/api/{items,snapshots,reviews,impressions,settings}**', async (route) => {
    const call = record(route);
    if (unreachable) return route.abort('connectionfailed');

    const index = rejections.findIndex((r) => r.method === call.method && r.path.test(call.path));
    if (index !== -1) {
      const [rejection] = rejections.splice(index, 1);
      return json(route, { error: rejection.code }, rejection.status);
    }

    /* Applied, not merely accepted. The app pulls right after every push, and a pull that hands
       back the row as it was before the write would silently undo it locally — which is exactly
       what a real server that lost the write would do, and not what this fixture is for. */
    const match = call.path.match(/^\/api\/(items|snapshots|reviews|impressions)(?:\/([^/]+))?$/);
    if (match) {
      const coll = match[1] as 'items' | 'snapshots' | 'reviews' | 'impressions';
      const id = match[2];
      const rows = state[coll] as { id: string; createdAt: string; updatedAt: string }[];
      const now = new Date().toISOString();
      if (call.method === 'POST') {
        /* With the defaults the shared create schema would have filled in — the real server
           answers a pull with complete DTOs, and a row missing `visits` or `altTitles` would crash
           a component that (correctly) trusts the wire shape. */
        const defaults: Record<typeof coll, object> = {
          items: {
            altTitles: [],
            categories: [],
            status: 'saved',
            snapshotIds: [],
            sourceUrls: [],
            expiresAt: null,
            price: null,
            coverUrl: null,
            when: null,
            venue: null,
          },
          snapshots: {
            canonicalUrl: null,
            contentType: '',
            body: '',
            text: '',
            error: null,
            extraction: null,
          },
          reviews: { rating: null, notes: '', visits: [] },
          impressions: { action: null },
        };
        const body = call.body as { id: string; createdAt: string };
        rows.push({ ...defaults[coll], ...body, updatedAt: now } as never);
      } else if (call.method === 'PATCH' && id) {
        const index = rows.findIndex((r) => r.id === id);
        if (index !== -1)
          rows[index] = { ...rows[index], ...(call.body as object), updatedAt: now };
      } else if (call.method === 'DELETE' && id) {
        const index = rows.findIndex((r) => r.id === id);
        if (index !== -1) {
          rows.splice(index, 1);
          state.deletions.push({ coll: coll.slice(0, -1) as never, docId: id, deletedAt: now });
        }
      }
    }
    await json(route, {}, call.method === 'POST' ? 201 : 200);
  });

  const mock: ApiMock = {
    state,
    fixtures: FIXTURES,
    calls,
    sourceStatus: [],
    pollRuns: [],
    nextPullIsReset: () => {
      forceReset = true;
    },
    rejectOnce: (rejection) => rejections.push(rejection),
    setUnreachable: (down) => {
      unreachable = down;
    },
    waitForCall: async (method, path, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = calls.find((c) => c.method === method && path.test(c.path));
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for ${method} ${path}. Saw: ${
              calls.map((c) => `${c.method} ${c.path}`).join(', ') || '(nothing)'
            }`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
  return mock;
}
