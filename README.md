# Rove

A personal map of places and events worth your time. Share a post from Instagram or Xiaohongshu
into the app, it reads the caption, finds the place, and puts it on a map one tap away from
navigation. Ratings and notes stay yours.

Built for Shenzhen. Built so that a second region is additive.

## Status

**Phase 1 — places, manually fed.** Share a post (Instagram, Xiaohongshu, any page) into the app:
the server reads it, the model you configure suggests the places it names, the geocoder finds the
one you pick, and it lands on the map with navigation one tap away. Ratings, notes and visits are
yours. The infrastructure came from [Diary] (local-first sync, PWA, Android shell, asset
generation, versioning, i18n checks, telemetry); Phase 0 stripped the diary out of it.

The plan, with the research behind it, is in `PLAN.md`. The brief it answers is `BRIEF.md`.

## Concepts

- **Items** — one row shape for everything: a `place` (never expires), an `event` (has a time
  window), a `film` (in cinemas for a few weeks). `kind` is a discriminated union, so a place
  must have a location and a film cannot. `status` runs `candidate → saved → visited`, or
  `dismissed`; nothing becomes `saved` without you.
- **Snapshots** — the raw payload a source produced for a URL, kept so extraction can be re-run
  over history without re-fetching. Bounded (256 KB), scripts stripped.
- **Reviews** — your rating, notes and visit dates. A separate collection from items on purpose:
  items can be re-derived from snapshots, a rating cannot. Exported first in a backup.
- **Impressions** — "this item was shown here, and this is what happened". Logged from day one so
  ranking, when it arrives, has skips to learn from and not only ratings.
- **Regions** — a declared bundle: datum, geocoder, navigation hand-off, map renderer, sources.
  Shenzhen is Amap + GCJ-02 + `uri.amap.com` deep links. Core reads the bundle through a registry
  and never names a provider.
- **Coordinates carry their datum.** `GeoPoint = { lon, lat, datum: 'WGS84' | 'GCJ02' | 'BD09' }`.
  Conversion happens in exactly one file (`shared/src/providers/datum.ts`) and is called only by a
  provider's navigation builder or renderer. A test greps for it.

## The region boundary

```
core (shared/, server/, web/)        reads through registries only
  ├─ regions/index      → RegionDescriptor by id     (shared/src/regions)
  ├─ providers/index    → Navigation by id           (shared/src/providers)
  ├─ sources/index      → SourceManifest by id/url   (shared/src/sources)
  ├─ server geocoders   → Geocoder by id             (Phase 1)
  └─ web renderers      → MapRenderer by id          (Phase 1)
```

`shared/src/boundaries.test.ts` enforces four rules against the source tree: core never imports a
provider or source directly; `gcoord` is imported by one file and `toDatum` is called only from a
provider's navigation or renderer; core never reads a `providerRef.id`; every region names
registered providers and sources.

## Sources

| Source                        | Tier | Mode                                                       |
| ----------------------------- | ---- | ---------------------------------------------------------- |
| Instagram post                | A    | Meta's tokenless oEmbed (public posts) → caption           |
| Xiaohongshu note              | B    | share link → public page → state blob; no account involved |
| Any other page                | B    | Open Graph title and description                           |
| 豆瓣同城 / 秀动 / 大麦 / 猫眼 | A/B  | Phase 2, through a self-hosted RSSHub                      |
| WeChat 公众号                 | M    | manual share only                                          |

Tiers: **A** official API · **B** public page, only an IP at stake · **C** needs a logged-in cookie,
account at stake · **M** manual. Every source is a `Resolver` (URL → snapshot) and optionally a
`Poller` (feed → snapshots); both produce the same row, so demoting a source from polled to manual
removes a poller and changes nothing else.

## Stack

npm workspaces monorepo:

| Workspace | Stack                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/`    | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, TanStack Query, react-router, i18next (es/en/it/ja/zh), Dexie, PWA, Capacitor (Android) |
| `server/` | Hono on Node, Mongoose (MongoDB), Better Auth (Google OAuth)                                                                                    |
| `shared/` | zod schemas, DTO types, constants, the region registry, providers and source manifests                                                          |

In production the server serves the built SPA (single origin, single container).

## Offline / sync

The app is **local-first**: every page reads from an IndexedDB mirror (`web/src/db`), so reading
_and writing_ work fully offline. Mutations apply locally and queue in an outbox that replays
against the REST API when online; `GET /api/sync?since=` then pulls everything that changed
(deletes propagate via tombstones). Conflicts resolve last-write-wins — fine for a single-user app.

Every synced collection is one call to `syncedCollectionRouter` (`server/src/routes/synced.ts`),
which holds the tolerance rules the outbox depends on: a replayed create 409s and is treated as
applied, a patch to a missing row 404s and is treated as applied, a create retracts any tombstone
naming its id so undo converges on every device.

Tombstones are kept for `TOMBSTONE_RETENTION_DAYS` (180) and swept by a Mongo TTL index; a cursor
older than that is answered with the complete state and `reset: true`.

## Settings

Synced settings are the region, quiet notifications, and the extraction model: any
OpenAI-compatible chat-completions endpoint (base URL, model, optional key). The key is write-only
— stored on the server, never returned; the client is told only whether one exists. Device-local
preferences (theme, language, telemetry, wi-fi-only sync) live in `localStorage` and never sync.

## Share target

The PWA manifest declares a `share_target` on `/add`. Android puts the shared link in `text`, often
behind the caption, so `web/src/lib/shareTarget.ts` finds the first URL in any of the three fields,
stopping at CJK punctuation. `/add` is also an App Link, so the installed Android app claims it.

## Amap

Three keys, one 应用 in [console.amap.com](https://console.amap.com) (the account needs 个人认证):

| Key                   | Where it goes                                  | Bind it to                     | Pool it spends                                               |
| --------------------- | ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Web服务 (Web Service) | `AMAP_WEB_SERVICE_KEY`, server only            | the VPS's IP (IP 白名单)       | 基础搜索服务: **5,000 calls/month** on the personal tier     |
| Web端 (JS API)        | `VITE_AMAP_JS_KEY`, inlined into the web build | the site's domain (域名白名单) | map loads, 1,500,000/month                                   |
| its 安全密钥 (jscode) | `AMAP_JS_SECURITY_CODE`, server only           | —                              | — (the browser reaches Amap through `/_AMapService` instead) |

The search pool is the scarce one. Every 输入提示 answer is cached forever by query
(`GeocodeCache`), a monthly counter (`ProviderUsage`) is bumped before each paid call, and the
server refuses new searches at 4,500 with `geocode.quota` rather than failing at 5,000. Settings →
Region shows the month's count.

The personal tier's free quota is documented as a one-year grant from authentication — check the
console before relying on it in year two.

## The paste pipeline

```
share sheet → /add?text=…            web/src/lib/shareTarget.ts
  → POST /api/ingest/resolve         server/src/sources/*          (URL → snapshot fields)
  → Snapshot row, local + queued     web/src/db/mutations.ts
  → POST /api/ingest/extract         server/src/services/extractService.ts
      (model proposes mentions; evidence must be a verbatim substring, or it is dropped)
  → GET /api/geocode/suggest         server/src/providers/amap/geocoder.ts (cached, counted)
  → dedupe                           web/src/lib/dedupe.ts
      (same providerRef → same folded title within 100 m → same canonical URL)
  → Item row, local + queued
```

The model never originates a fact: it returns spans of the post, and only spans that are actually
in the post survive `validateMentions`. Coordinates, addresses and POI ids come from the geocoder.

## Setup

1. `cp .env.example .env` and fill it in (`BETTER_AUTH_SECRET` via `openssl rand -base64 32`,
   the three Amap keys above).
2. In Google Cloud Console, add the OAuth redirect URIs:
   - `http://localhost:5173/api/auth/callback/google` (dev)
   - `https://<your-domain>/api/auth/callback/google` (prod)
3. `npm ci --force` (the `--force` is a known peer conflict between `@hono/node-ws` and
   `@hono/node-server` v2; the Dockerfile does the same)
4. `npm run dev` → http://localhost:5173 (API on the port from `.env`, proxied).

## Scripts

- `npm run dev` — API (tsx watch) + web (Vite) concurrently
- `npm run build` / `npm start` — production build / run
- `npm run typecheck` — all workspaces
- `npm test` — every workspace. In `web/` this is `checkI18n.ts` plus the `logic` and
  `components` vitest projects
- `npm run test:e2e` — real Chromium over the built SPA, `/api/**` answered by route interception

Versioning, releases, Android signing, live updates and telemetry work exactly as in Diary; the
sections of its README that describe them still apply verbatim, with `es.tablerus.rove` and
`rove.tablerus.es` in place of the diary's ids.

[Diary]: https://github.com/HectorTablero/diary
