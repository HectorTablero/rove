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

export interface ApiMock {
  state: ApiState;
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

  await page.route('**/api/{items,snapshots,reviews,impressions,settings}**', async (route) => {
    const call = record(route);
    if (unreachable) return route.abort('connectionfailed');

    const index = rejections.findIndex((r) => r.method === call.method && r.path.test(call.path));
    if (index !== -1) {
      const [rejection] = rejections.splice(index, 1);
      return json(route, { error: rejection.code }, rejection.status);
    }

    // Apply creates so the next pull returns them — a round trip rather than two assertions.
    if (call.method === 'POST' && call.path === '/api/items') {
      const body = call.body as ItemDto;
      state.items = [...state.items, { ...body, updatedAt: body.createdAt }];
    }
    await json(route, {}, call.method === 'POST' ? 201 : 200);
  });

  return {
    state,
    calls,
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
}
