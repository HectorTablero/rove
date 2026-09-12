# Rove — research and plan

## Context

> Status: Phase 0 (the strip) is done — see the README. Decisions taken in review: the name is Rove, brand constants stay untouched, Amap first behind a swappable renderer, Mongo stays, Google auth plus local-only mode stay, the extraction model is an OpenAI-compatible endpoint configured in Settings (a DGX Spark at home), VPS from day one.

You want a personal system that finds places (later: events, films, shows) worth your time in
Shenzhen, geocodes them, shows them on a map with one-tap Amap navigation, and keeps private
ratings and notes. It must run on your own machine or a small VPS, cost near zero, survive a
source being switched from automated to manual, and not paint itself into an Amap-only or
China-only corner. You copied the Diary project as a base because its infrastructure (PWA,
Android, local-first sync, asset generation, versioning, i18n checks, telemetry) is already right.

This document is the research report and proposed plan from BRIEF.md. No code has been written.
Everything marked **VERIFY** is something I could read from a doc or a search result but could
not confirm end-to-end without an account, a key, or running code.

---

## 1. Research findings

### 1.1 Things that contradict or sharpen the brief's assumptions

| Assumption in the brief | What I found |
| --- | --- |
| Amap quotas are per-day numbers from blog posts | Amap restructured pricing on **2025-05-20** into *monthly* pools shared across Web Service, JS, Android, iOS and mini-program. Personal authenticated developer: **基础搜索服务 (keyword / around / ID search / 输入提示) 5,000 calls/month**, **基础LBS服务 (geocoding, reverse geocoding, routing, static map, 坐标转换) 150,000/month**, **map initialisation (JS map loads, positioning) 1,500,000/month**. Overage is ¥30 per 10,000 calls. The upgrade page says the personal free quota is granted for **one year from authentication** ("享有…1年的免费月配额量（自注册认证之日起计算）") **VERIFY** in the console what happens in year two. Consequence: **POI search is the scarce resource** (≈160/day). Geocoding is plentiful. Every search result must be cached and never repeated for a known item. |
| Amap favourites cannot be bulk imported/exported | Still true for the app's 收藏夹: no official export, and the only "export" is a third-party page-scrape tool. What *does* exist: **高德地图小程序 (wia.amap.com)** — a PC-only "business map" where you batch-import an Excel of `名称 / 经纬度 / 地址 / 颜色 / 描述 / 文件夹`, and it can *import from* your 收藏夹 (one direction). Whether a WIA map is viewable inside the Amap phone app is not stated in the docs **VERIFY**. Design consequence (unchanged from your instinct): **this app is the system of record; Amap is a navigation endpoint**, reached through `https://uri.amap.com/marker?position=lon,lat&name=…&coordinate=gaode&callnative=1` (opens the app on Android) or `androidamap://navi?…&dev=0`. An optional "export to WIA Excel" is a 30-line exporter, not an integration. |
| Instagram is scrape-only | Two changes. (a) Since **2026-06-15 Meta's oEmbed is tokenless again** for single public posts: `GET https://graph.facebook.com/v25.0/instagram_oembed?url=<post>` returns `html` (blockquote with the caption unless `hidecaption=1`), `author_name`, `thumbnail_url` **VERIFY** — one source says the thumbnail/author fields are being deprecated, so parse the caption out of `html` and treat the rest as optional. That is an *official, ToS-clean* way to turn a pasted post URL into caption text. (b) Account feeds (all posts of an account) remain scrape-only: RSSHub `/instagram/2/user/:name` is flagged `antiCrawler`, works without a cookie only for limited public data, and login walls / IP soft-blocks are worse than a year ago. |
| Xiaohongshu can be read via RSSHub | The route `/xiaohongshu/user/:id/notes` exists but is `requirePuppeteer`, `antiCrawler`, appears in RSSHub's "hot error routes", and returns titles/covers only unless a `XIAOHONGSHU_COOKIE` is set. For a *single pasted note* the picture is better: `xhslink.com/m/…` (and `xhslink.cn`) 302s to `www.xiaohongshu.com/discovery/item/<id>?xsec_token=…`; that page's `<title>`, `<meta name="description">` and `window.__INITIAL_STATE__` carry `title`, `desc`, `tagList`, `imageList` **without a login cookie** (RSSHub's own `util.ts` parses exactly that). `xsec_token` expires, so the raw page must be snapshotted at paste time. Signatures for the *API* change quarterly; the *share page* has been the stable surface. No account is involved, so there is no account-ban risk in this mode — only IP-level blocking. |
| WeChat 公众号 via RSS | **wewe-rss was archived 2026-05-11** after WeChat disabled the WeChat Reading interface it relied on; each WeRead account tolerated ~10 subscriptions before being blocked. Wechat2RSS is a paid hosted service. we-mp-rss is the remaining self-hosted option and carries the same account risk. Classify as **manual-share tier**: "文旅深圳" and district accounts are read in WeChat and shared into the app. |
| Douban 同城 / 大麦 / 猫眼 / 秀动 need scrapers | RSSHub has usable routes for all four: `/douban/event/hot/:locationId` (clean rexxar JSON API, no cookie; Shenzhen `locationId` read from `window.__loc_id__` on the Douban city page **VERIFY**), `/damai/activity/:city/:category/:subcategory/:keyword?` (hits `search.damai.cn/searchajax.html`; returns venue, showtime, price; flagged `antiCrawler`), `/showstart/event/:cityCode/:showStyle?` (clean, no cookie; city code via `/showstart/search/city/深圳`), `/maoyan/hot` (`m.maoyan.com/ajax/movieOnInfoList`; **no city, no showtimes** — "in cinemas now" only). No route for 淘票票; 猫眼 covers films. **Self-hosting RSSHub collapses Phase 2 into "poll four feeds".** |
| Shenzhen government channels | sz.gov.cn and district portals have no RSS; the drone-show and festival announcements come through "文旅深圳" 公众号 and press. Manual-share tier. |
| "Something existing may cover 60%" | Closest: **AdventureLog** (Django + SvelteKit, MapLibre, OSM tiles, Nominatim geocoding) — a travel tracker, WGS-84/OSM-native, no ingestion pipeline, no GCJ-02, no Chinese sources; I'd be fighting it from day one. **Obsidian Map View + Geocode Note** is a good *personal GIS* but has no share-target on Android, no pipeline, and OSM-centric geocoding. Linkwarden / Karakeep are bookmark managers with no map. **Conclusion: nothing covers 60% under the China constraints; build it, and keep it small.** The one existing tool that does remove work is self-hosted RSSHub. |
| Map rendering will be Amap | Options: Amap JS API 2.0 (GCJ-02 native, Chinese labels, loads fine in China, 1.5M loads/month free, key ships in the bundle behind a domain whitelist + 安全密钥) vs MapLibre + OSM/OpenFreeMap tiles (WGS-84, poor Shenzhen label coverage, tile hosts slow or blocked without VPN). Recommendation: the *renderer is a region-provided component* with a five-method interface; Shenzhen ships Amap JS API, the obvious second implementation is MapLibre. |

### 1.2 Source-by-source reliability and ToS assessment

Tiers: **A** official/clean API · **B** unauthenticated public page, no account at stake · **C** needs a logged-in cookie, account at stake · **M** manual share only.

| Source | Phase-1 mode (pasted URL) | Later automated mode | Fragility | ToS / legal exposure |
| --- | --- | --- | --- | --- |
| Instagram post | **A** tokenless oEmbed → caption | **C** RSSHub with cookie for account feeds, or **M** | oEmbed: low. Feed: high, and Meta restricts accounts used for it | oEmbed is sanctioned. Feed scraping violates Meta ToS; the risk is to the account whose cookie is used. Recommend never using your main account; ideally never doing it. |
| Xiaohongshu note | **B** resolve share link → page → `__INITIAL_STATE__` | **C** RSSHub + puppeteer + cookie, or **M** | Medium: share-page markup has been stable, API signatures rotate quarterly. Keep a generic `<title>/<meta description>` fallback so a markup change degrades to "caption only", not to nothing | 用户协议 prohibits automated collection; a 2024 criminal case involved commercial-scale scraping for profit. Reading one note you were shown, at personal scale, without an account, is ordinary browser behaviour. Automated feed collection with a cookie is the mode to avoid. |
| 豆瓣同城 | — | **A/B** RSSHub route, JSON API | Low–medium | Personal aggregation of public listings; low. |
| 大麦 | — | **B** RSSHub route (`antiCrawler`) | Medium | Same as above; ticketing sites rate-limit. |
| 秀动 | — | **A/B** RSSHub route | Low | Low. |
| 猫眼 | — | **A/B** RSSHub route; no showtimes | Low | Low. Showtimes per cinema would need a separate scraper — defer; "showtime unknown" is acceptable per the brief. |
| 淘票票 | — | none found | — | Skip; 猫眼 covers the "in cinemas" question. |
| WeChat 公众号 | **M** share article link → generic `og:` extraction | **C** we-mp-rss (WeRead account, ~10 subs before blocking) | High | Account risk is real and the tools keep dying. Manual tier. |
| SZ government | **M** | none | — | — |

The architecture rule that follows: **a source is a `Resolver` (URL → snapshot) in Phase 1 and optionally a `Poller` (feed → snapshots) later.** Both produce the same `Snapshot` row, so downgrading a source from polled to manual removes a poller and changes nothing else.

### 1.3 Amap developer surface (what the app actually needs)

- **Web Service API** (server-side, key with IP whitelist): `v3/assistant/inputtips` (输入提示, counts against the 5k search pool), `v5/place/text` (关键字搜索, 5k pool), `v3/geocode/geo` (地理编码, 150k pool). All return GCJ-02.
- **JS API 2.0** (client-side, key + 安全密钥 + domain whitelist): map, markers, `AMap.Geolocation`. Counts against the 1.5M "map init" pool.
- **URI API**: `uri.amap.com/marker` and `uri.amap.com/navigation` with `callnative=1`; `androidamap://` schemes. No key, no quota.
- **Personal keys are for non-commercial use** — fine here.

---

## 2. Your ideas, challenged

| Idea | Verdict |
| --- | --- |
| Model everything as `items`, not `places` | **Agree**, with one refinement: `kind` is a discriminator on a zod discriminated union, not a free tag. A `place` has a location and no time window; an `event` has a time window and usually a location; a `film` has a time window and no location. Optional fields on one flat shape would let a film with coordinates or an event without a start slip through silently. Adding cinema listings later is one new ingester *and* one new union member, which is the right cost. |
| fetch → normalize → dedupe → geocode → score → deliver, stages isolated, raw payload stored | **Agree.** Phase 1 runs the first four stages synchronously on paste; the same functions become the poller's stages later. Raw snapshots are kept (bounded: 256 KB per snapshot, HTML stripped of scripts except the state blob). |
| Three separate LLM jobs; taste learns from skips | **Agree.** Corollary you didn't list: **impressions must be logged from Phase 1** (item shown in list/map/digest; action taken or not), or there is nothing to learn skips from when ranking arrives. It is one small table and costs nothing now. |
| The LLM must never originate a fact — structurally | **Agree, and here is the structure.** Extraction returns *candidate mentions*: `{ nameText, addressText?, evidence: string }` where `evidence` must be a verbatim substring of the snapshot text (validated in code; non-matching outputs are rejected). The fact (coordinates, address, POI id) comes from the geocoder, never the model. Ranking and digest receive item **ids** and return `{ itemId, reason }[]`; the digest body (title, when, where, link) is rendered by code from stored fields, the model contributes only the reason strings. There is no code path by which model output becomes an item field other than `title`, and `title` must be chosen from a geocoder candidate or typed by you. |
| Dedupe with embeddings + coordinate proximity | **Push back on embeddings, for now.** At personal scale (hundreds of items) the geocoder already collapses name variants: two mentions of the same restaurant resolve to the same provider POI id or to points within ~100 m with the same normalised name. That is a query, not a model. Embeddings add a hosted model or an API dependency and a vector index for a problem you don't have yet. Because raw text is stored, adding embedding-based dedupe later is a re-run over history, not a migration. Revisit if you see false negatives. |
| Weekly cron to Telegram/飞书; MCP server for on-demand | **Agree**, Phase 3. Telegram bot API is simpler than 飞书 from a VPS; 飞书 wins if that is where you already look. MCP server over stdio against the same DB is a thin read layer — cheap, and a good forcing function for keeping queries in `shared/`. |
| Region = bundle of geocoder, navigation, datum, sources, locale, tz, currency | **Agree**, with two pushes: (1) "ingesters discovered rather than hardcoded" — a *static registry* tagged by region (exactly Diary's plugin `registry.ts` pattern) is the discovery; filesystem scanning is magic that fails silently. (2) Locale/currency on the region are **data**, not behaviour: nothing in Phase 1–3 branches on them, so they are two fields, not two subsystems. |
| Coordinates carry their datum in the type system | **Agree, do it from the first line of code.** `GeoPoint = { lon, lat, datum: 'WGS84' | 'GCJ02' | 'BD09' }`, conversions via `gcoord` at exactly two boundaries: renderer input and navigation-URL builder. Storage keeps whatever datum the provider produced, tagged. |
| Geocoding and navigation are separate interfaces; no POI ids in core | **Agree.** Provider-specific ids live in `providerRef: { provider: string, id: string }` — opaque to core, used only by that provider's geocoder (re-lookup) and navigation builder (`poiid=`). |
| Only Shenzhen; abstraction thin | **Agree.** One `Region` object with one implementation is the abstraction. I will not write a stub second region. |
| Phase 1 = places, manual paste, one geocoder, static map, local ratings | **Agree, with one addition**: Android **share-sheet target** in Phase 1. "Paste a URL" on a phone means switching apps and long-pressing; "Share → Discover" is the difference between using it and not. The PWA manifest `share_target` gives this for free once installed. |

---

## 3. Proposed architecture

### 3.1 What stays from Diary, what goes

**Keep (infrastructure, unchanged or lightly renamed):** npm-workspaces monorepo; `web/` Vite 7 + React 19 + Tailwind + shadcn + TanStack Query + react-router + Dexie local-first mirror + outbox sync + vite-plugin-pwa; `server/` Hono + Mongoose + Better Auth (Google) + rate limiting + CSP; `shared/` zod schemas; logo/asset/flag generators driven by constants; version bump hooks; telemetry; i18n checker; e2e scaffold; Dockerfile; local-only mode (`web/src/lib/localOnly.ts`); Capacitor Android project (kept dormant — PWA first).

**Remove:** entries, people, tags, threads, events, talking-points scoring, voice capture, contacts import, the three plugins and the plugin system itself (its surfaces are diary-shaped; the *pattern* — static registry, manifest outside the chunk, checked by a test — is reused for sources and regions), habits widget, period tracker, notebook, backup importer (rewrite small, later), Better Stack alerts specific to diary events.

**Why the server stays even though "ratings stay local":** the browser cannot fetch xiaohongshu.com or graph.facebook.com (CORS), the Amap Web Service key must not ship in the bundle, and the LLM key is server-side. The server is a *resolver + geocoder proxy + sync target*. Ratings and notes ride the existing local-first path and sync only to **your** server; there is no third party in that loop.

**Mongo vs SQLite:** Mongo is heavier than this app deserves, but the sync engine, tombstones, TTL sweeps, and tests already exist against Mongoose. Rewriting them for SQLite is a week of risk for no feature. Keep Mongo; a single-container `mongo` sidecar on the VPS is boring. Open question 4.

### 3.2 Layers and the region boundary

```
┌──────────────────────── core (region-agnostic) ────────────────────────┐
│  shared/: Item, Snapshot, Review, Impression schemas; GeoPoint+datum   │
│  server/: pipeline stages  resolve → extract → geocode → dedupe → save │
│  web/:    list, item sheet, map page shell, share-target route, sync   │
└──────────┬──────────────────────┬──────────────────────┬───────────────┘
           │ Geocoder             │ Navigation           │ MapRenderer
           │ search(q, near?)     │ markerUrl(point,name)│ mount(el, opts)
           │ → Candidate[]        │ routeUrl(point,name) │ setMarkers([..])
           │ (point w/ datum,     │ (needs datum)        │ fitTo / onSelect
           │  providerRef, addr)  │                      │ (needs datum)
┌──────────┴──────────────────────┴──────────────────────┴───────────────┐
│  regions/shenzhen  { id:'shenzhen', tz:'Asia/Shanghai', locale:'zh-CN',│
│    currency:'CNY', datum:'GCJ02', geocoder: amapGeocoder,              │
│    navigation: amapUri, renderer: amapJsRenderer, sources: [...] }     │
│  providers/amap  (web-service client, uri builder, JS renderer)        │
│  sources/  instagram-oembed, xiaohongshu-share, generic-og (Phase 1)   │
│            rsshub-douban, rsshub-damai, rsshub-showstart, rsshub-maoyan│
└────────────────────────────────────────────────────────────────────────┘
```

Rules that make the boundary real (each one gets a test, like Diary's registry tests):

1. `core` may import from `regions/index.ts` (the registry) and nothing under `providers/` or `sources/`. An import-path test enforces it.
2. Every `GeoPoint` has a `datum`. `gcoord` is called only in `providers/*/navigation.ts` and `providers/*/renderer.ts`. A grep test enforces it.
3. `providerRef` is `{ provider, id }` and no core file reads `.id`.
4. A `Source` declares `{ id, regionIds, kinds, tier: 'A'|'B'|'C'|'M', resolve?(url) , poll?() }`. Registry lists them; the UI shows tier so you always know what a source costs.

### 3.3 Data model (zod in `shared/`)

```ts
GeoPoint   = { lon: number; lat: number; datum: 'WGS84' | 'GCJ02' | 'BD09' }

Snapshot   = { id; sourceId; url; canonicalUrl?; fetchedAt; contentType;
               body: string /* ≤256 KB, scripts stripped except state blob */;
               text: string /* caption/description as extracted */;
               extraction?: { model; at; mentions: Mention[] } }
Mention    = { nameText; addressText?; evidence: string /* verbatim substring of text */ }

ItemBase   = { id; regionId; title: string; altTitles: string[]; categories: string[];
               status: 'candidate' | 'saved' | 'visited' | 'dismissed';
               snapshotIds: string[]; sourceUrls: string[];
               createdAt; updatedAt; expiresAt? }
Location   = { point: GeoPoint; address?: string; providerRef?: { provider; id } }
When       = { start: string; end?: string; tz: string; allDay?: boolean }
Item       = ItemBase & (
               { kind: 'place'; location: Location }
             | { kind: 'event'; location?: Location; when: When | { unknown: true } }
             | { kind: 'film';  when: When | { unknown: true }; cinemas?: never } )

Review     = { itemId; rating?: 1|2|3|4|5; notes: string; visits: string[] }   // private
Impression = { itemId; surface: 'list'|'map'|'digest'; at; action?: 'open'|'navigate'|'save'|'dismiss' }
```

- `Review` is a separate collection from `Item` on purpose: items are re-derivable from snapshots; reviews are the only irreplaceable data. Backups export reviews first.
- `status: 'candidate'` is what an ingester produces; nothing becomes `saved` without you. Phase 1 has no candidates from automation, so paste → confirm → `saved` directly.
- Dedupe key, in order: same `providerRef`; else same normalised title within 100 m; else same canonical URL. A match merges `snapshotIds`/`sourceUrls` into the existing item rather than creating one.
- Everything text is `string` with no script assumptions; normalisation for dedupe is NFKC + whitespace + case-fold, not ASCII-only.

### 3.4 Phase-1 pipeline, concretely

1. **Intake**: `/add?url=` (typed or from the share sheet; Android puts the URL in `text`, so coalesce `url ?? text`). Snapshot rows are created client-side immediately so nothing is lost offline; the resolve step runs when online.
2. **Resolve** (server): pick the `Source` whose `matches(url)` is true — `instagram-oembed` (`instagram.com/p|reel/…`), `xiaohongshu-share` (`xhslink.com|xhslink.cn|xiaohongshu.com`), `generic-og` (anything else: `og:title`, `og:description`, `<title>`). Store `Snapshot.body` and `.text`. Failure is loud: the item shows "could not read this link" with the HTTP status, and the URL stays as a bare item you can still name by hand.
3. **Extract**: if an LLM key is configured, one structured-output call returns `Mention[]`; evidence is checked against `Snapshot.text`, non-matching mentions dropped. Without a key, you type the name. Either way you see the caption next to the name field.
4. **Geocode** (server, cached by `(regionId, query)` forever): `inputtips` as you type (debounced, min 2 chars, cap 5 per item), then `place/text` for the chosen tip only if the tip lacks coordinates. Candidates carry `datum: 'GCJ02'` and `providerRef: { provider: 'amap', id }`. You pick one on a small map preview.
5. **Dedupe + save**: merge or create; `status: 'saved'`.
6. **Map**: Amap JS API, markers coloured by status (saved / visited), tap → item sheet with title, address, source link, "Navigate" (`uri.amap.com/marker … callnative=1`), visited toggle, rating, notes. **List** with search over title/notes/categories and a status filter.

### 3.5 LLM provider

Diary already has an OpenAI-compatible chat client (`server/src/lib/aiChatClient.ts`, used with Groq / OpenRouter / Cerebras, with failover). Extraction in Phase 1 is one structured-output call and fits it unchanged. I recommend keeping the provider pluggable behind that client and treating "which model" as configuration: a free-tier Groq/OpenRouter model is enough for extraction; ranking and digest writing (Phase 3) are where a stronger model such as Claude Opus 5 through the Anthropic SDK earns its cost. Decide in open question 6 — I have not assumed an Anthropic key.

---

## 4. Phasing

### Phase 0 — Strip and rebrand (≈ 1 session)

- Pick the name (suggestions in §6). Rename package ids, `appId`, `BRAND_*` constants, logo paths, deep-link host placeholder, manifest, translation-context.
- Delete diary domain code, plugins, and their tests; keep infra green (`npm run typecheck && npm test` passes with an empty domain).
- Add `regions/`, `providers/`, `sources/` folders with the registry files and the three boundary tests from §3.2 (they pass trivially at first).
- Add `share_target` to the manifest.

### Phase 1 — Places, manually fed, usable (the deliverable)

**Definition of done** (every line testable on a phone):

1. Installed as a PWA on Android; "Share → <app>" from Instagram, Xiaohongshu, WeChat and Chrome opens the add screen with the URL filled.
2. Pasting or sharing an Instagram post URL shows its caption within 5 s (oEmbed). Same for an XHS note via its share link. Any other URL shows `og:` title/description. A failed fetch shows the reason, never a blank.
3. With an LLM key, up to 5 suggested place names appear with their evidence highlighted in the caption; without a key, a name field.
4. Typing a name shows Amap 输入提示 candidates; choosing one shows a marker on a small map; saving creates the item with GCJ-02 coordinates tagged as such. The same place shared twice merges into one item (a test with two XHS share links to the same POI).
5. Map page: all saved items as markers, visited items visually distinct, the map centred on your location or Shenzhen. Tapping opens the sheet; "Navigate" opens the Amap app at the marker.
6. Item sheet: visited toggle, 1–5 rating, notes; all of it works offline and syncs when back.
7. List page with text search and status filter.
8. Amap search calls are cached; a counter in Settings shows this month's search-pool usage, and the app refuses new searches at 4,500 rather than silently failing at 5,000.
9. Impressions are recorded for list/map/sheet views.
10. `npm test` covers: datum-boundary grep test, region-import test, the `evidence ⊂ text` validator, dedupe rules, share-target URL coalescing, the Amap URI builders, and each resolver against a stored fixture (no network in tests).
11. Backup: export reviews + items + snapshots as JSON; import restores them.

Explicitly **not** in Phase 1: any polling, any event/film kind, ranking, digest, MCP, embeddings, a second region, Capacitor APK.

### Phase 2 — Time-bound items from clean feeds

Self-hosted RSSHub container; `Poller` sources for 豆瓣同城, 秀动, 大麦, 猫眼 producing `event`/`film` candidates with `expiresAt`; a candidate inbox with save/dismiss; expiry sweep; a "this weekend" view. Failures loud: a poll that returns zero items twice in a row raises a visible banner, not an empty inbox.

### Phase 3 — Ranking, digest, MCP (only after ≥ 50 rated items)

Taste profile from reviews + impressions; ranking job returns `{ itemId, reason }[]`; weekly digest rendered by code with model-written reasons; Telegram (or 飞书) delivery; read-only MCP server over stdio.

### Phase 4 (optional, may never happen) — Account feeds

Instagram/XHS account polling through RSSHub with a cookie, behind an explicit "tier C, account at risk" switch, with a throwaway account. Or stay manual forever; the architecture does not care.

---

## 5. Risks written down

- **Amap free quota may be a one-year grant.** If year two is paid, the bill at your scale is a few 元/month of search calls, but check before relying on it. Mitigation is already in the design (caching, counter, hard stop).
- **XHS share-page markup can change.** Mitigation: `<title>/<meta>` fallback, fixtures in tests, raw snapshot stored so re-extraction is free.
- **Meta can re-token oEmbed** (it did in 2020). Mitigation: the source degrades to `generic-og` on the post page, then to manual.
- **Amap JS API in the bundle exposes a key.** Mitigation: domain whitelist + 安全密钥 proxied through the server as Amap documents; the Web Service key never leaves the server.
- **Self-hosted RSSHub is a moving target.** Pin the image tag; the pollers treat a route error as "source down" (banner), not as "no events".

---

## 6. Open questions for you

1. **Name.** The folder is "Discover", which is generic and hard to search for. Suggestions: **Rove** (short, verb, `es.tablerus.rove`), **Trove**, **Waypoint**, **Sonder**. Your call; Phase 0 renames once.
2. **Map renderer for Shenzhen:** Amap JS API (recommended; native GCJ-02, Chinese labels, works without VPN) or MapLibre + OSM (provider-neutral, worse in Shenzhen)? Either sits behind the same interface.
3. **Do you already have an Amap developer account, and is it 个人认证?** The 5k/month search pool and the one-year clause need checking in *your* console.
4. **Keep Mongo** (reuse Diary's sync engine as-is) or **move to SQLite** (lighter VPS, rewrite sync)? I recommend Mongo.
5. **Auth:** keep Google sign-in via Better Auth (needed if the server is on the public internet) with a single-email allowlist, or run local-only on your machine with no auth at all for Phase 1?
6. **LLM provider for extraction:** reuse the existing OpenAI-compatible client with a free-tier key (Groq/OpenRouter), or add the Anthropic SDK now? Extraction is small; I'd reuse and revisit at Phase 3.
7. **Where does it run:** your Windows machine (Docker Desktop) or a VPS from day one? Affects whether the share target works away from home (the PWA origin must be reachable).
8. **Telegram or 飞书** for Phase 3 delivery — which one do you actually look at?
9. **Language of the UI:** keep Diary's five languages, or collapse to en + zh for now (the i18n checker makes adding back cheap)?
10. Anything on the "never" list? For example: never use a logged-in IG/XHS cookie, ever (which deletes Phase 4 and simplifies the tier model).
