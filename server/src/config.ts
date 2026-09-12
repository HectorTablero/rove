import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env; both src/ (tsx) and dist/ (tsup bundle) sit two levels below it.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/**
 * A variable the server cannot run without.
 *
 * Read through a getter rather than at module load, so that *importing* something is never the
 * thing that demands a credential. It used to throw as this file was evaluated, which meant any
 * module transitively reaching config — errors.ts does, via telemetry — could not be imported at
 * all without a populated .env. That made whole areas of the server untestable, and it is why CI
 * would otherwise need real Google secrets to run unit tests that never make a request.
 *
 * Fail-fast is unchanged where it counts. Every one of these is read by buildAuth(), which
 * index.ts calls before the server listens, so a missing variable still stops startup immediately
 * and still names itself.
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

/** The root package.json version is the single source of truth for the app version, and it is
    copied into the runtime image, so the server reads it rather than taking a build arg. */
const readAppVersion = (): string => {
  try {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')).version ?? 'dev';
  } catch {
    return 'dev';
  }
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/rove',
  get googleClientId() {
    return required('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret() {
    return required('GOOGLE_CLIENT_SECRET');
  },
  get betterAuthSecret() {
    return required('BETTER_AUTH_SECRET');
  },
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  // Better Stack error + metrics reporting. Optional: with either unset, telemetry stays
  // console-only, so local development and self-hosters need no account.
  betterStackToken: process.env.BETTERSTACK_SOURCE_TOKEN,
  betterStackIngestUrl: process.env.BETTERSTACK_INGEST_URL,
  /* Amap, both halves. The Web Service key never leaves the server and is what geocoding spends;
     the JS security code is the server-side half of the browser map's key (see
     providers/amap/jsProxy.ts). Both optional: without them geocoding answers "not configured"
     rather than throwing at import, and the map still draws if the browser was built with a key. */
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY ?? '',
  amapJsSecurityCode: process.env.AMAP_JS_SECURITY_CODE ?? '',
  /** Whether the web build carries a map key — decides whether the CSP admits the Amap SDK. */
  amapJsKey: process.env.VITE_AMAP_JS_KEY ?? '',
  /* The host's shared Redis. On the VPS it is another container on the same network, reached by
     service name (redis://redis:6379); that name resolves nowhere on a laptop, so the default is
     the local port. Every key this app ever writes there carries the prefix, so one Redis can
     serve several apps without a `flush` in one taking out another. Nothing in the server reads
     Redis yet — RSSHub (docker-compose.yml) is the only consumer, and its keys are prefixed
     `rsshub:` by RSSHub itself; give it a database index in the URL if that ever needs isolating. */
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisKeyPrefix: 'rove:',
  /* The self-hosted RSSHub the pollers read. Infrastructure, not a user setting: it lives next to
     this container (see docker-compose.yml). Empty means polling answers "not configured". */
  rsshubBaseUrl: process.env.RSSHUB_BASE_URL ?? '',
  /** How often every enabled feed is read. Six hours is plenty for listings that change daily. */
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES ?? 360),
  appVersion: readAppVersion(),
};
