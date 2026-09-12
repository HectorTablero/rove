# Project brief: personal discovery & recommendation system

## Read this first

Do **not** start writing code. Research the problem, then give me a written plan
and wait for my approval. Everything below is context and suggestion, not spec.
I've thought about this for a few minutes; you should assume I've missed things and
that some of my assumptions are wrong. If you find a better architecture, or an
existing tool that makes half of this unnecessary, say so plainly instead of
building what I described.

---

## What I want

A personal system that finds things worth my time and puts them somewhere I'll
actually look.

Concretely, today: interesting places (restaurants, cafés, bars, hikes, viewpoints)
surfaced from Instagram accounts and Xiaohongshu, geocoded, shown on a map, one tap
away from navigation in Amap (高德地图). I want to mark places visited and keep my
own private ratings and notes.

Eventually: movies currently in cinemas, upcoming events, drone shows, exhibitions,
live music, pop-ups — anything time-bound and local. Plus LLM-generated suggestions,
both on a weekly schedule and on demand ("what's worth doing this weekend?").

I live in Shenzhen. **Build only for Shenzhen / the Greater Bay Area.** But the core
should not assume China. I may move, or travel long enough to want this elsewhere.
I do not want a proof-of-concept second region — just don't paint yourself into a
corner.

---

## Start with research

Before planning, go find out:

- What already exists. Self-hosted bookmarking/recommendation tools, personal
  knowledge-base tools with map views, RSS-based automation stacks. If something
  covers 60% of this, I'd rather extend it than write it.
- The real state of the data sources. Which of these can actually be read reliably,
  and at what cost in fragility and account risk: Instagram, Xiaohongshu, 豆瓣同城,
  大麦, 猫眼/淘票票, 秀动, WeChat 公众号, Shenzhen government announcement channels.
  Check whether RSSHub still has working routes for them — self-hosting RSSHub may
  collapse a lot of scraper work into polling feeds.
- Amap's developer surface: Web Service API for POI search and geocoding, quotas and
  key types, the URI API for handing off to the app, JS API for rendering a map.
  Confirm current quota limits rather than trusting a blog post.
- Whether anything has changed about Amap favorites — last I checked there is no bulk
  import or export of 收藏夹. Verify. If that's still true it shapes the whole design.

Be honest in the plan about legal and ToS exposure. Scraping Instagram and Xiaohongshu
violates their terms; Instagram in particular restricts accounts for it. I'm fine with
personal-scale use and manual-share fallbacks, but I want the tradeoffs written down,
not glossed over, and I want the architecture to survive a source being switched from
automated to manual.

---

## Ideas I've had — challenge these

**Model everything as `items`, not `places`.** Type, title, optional coordinates,
optional time window, source URL, raw payload, status, my rating, my notes. A restaurant
is an item that never expires; a drone show is an item that does. If this holds, adding
cinema listings later is one new ingester rather than a schema migration.

**Pipeline: fetch → normalize → dedupe → geocode → score → deliver.** Stages isolated so
one broken scraper doesn't kill a run. Store the raw payload before extraction, so I can
improve the extraction prompt and re-run over history without re-fetching.

**Three distinct LLM jobs, kept separate:** extraction (messy post → strict JSON),
ranking (taste profile + candidates → shortlist with reasons), and digest writing.
The taste profile should learn from what I skip, not only what I rate well.

**The LLM must never originate a fact.** Showtimes, addresses, dates, prices come from
stored fields. The model selects, orders, and explains — it does not fill gaps. I'd
rather see "showtime unknown" than a plausible invented one. Consider making this
structurally enforceable rather than a prompt instruction.

**Dedupe with embeddings plus coordinate proximity**, not LLM pairwise comparison — the
same restaurant shows up under four name variants and pairwise gets expensive fast.

**Delivery:** weekly cron to a Telegram or 飞书 bot. For on-demand, expose the database
as an MCP server so I can query my own data conversationally.

Push back on any of this.

---

## Region pluggability

This is the part I care most about getting right, because it's the part that rots
silently if done badly.

A region should be a declared bundle of: geocoding provider, navigation handoff method,
coordinate system, source/ingester list, locale, timezone, currency. Shenzhen means
Amap + `uri.amap.com` deep links + GCJ-02 + the Chinese sources. Somewhere else would
mean a different geocoder and a different set of feeds, with no core changes.

Specific traps I want handled deliberately:

- **Coordinate systems.** GCJ-02 vs WGS-84 vs BD-09. Coordinates should carry their
  datum in the type system, or be normalized at a single explicit boundary. Silent
  mixing produces a ~500m offset that looks like nothing is wrong.
- **Geocoding and navigation are separate interfaces.** Don't let Amap-shaped
  assumptions (POI IDs, `region` params) leak into the core.
- Ingesters registered and tagged by region, discovered rather than hardcoded.
- No English-only or Latin-script-only assumptions in text handling.

Only the Shenzhen region gets implemented. The abstraction should be thin — just enough
that a second region is additive. If you think some of this is premature and should be
deferred until a real second region exists, argue for that; I'd rather hear it now.

---

## Scope

Phase 1 is small on purpose: places only, I paste source URLs manually, one geocoder,
a static map page with visited/unvisited markers and Amap deep links, my ratings and
notes stored locally.

Automated ingestion, the generalized item schema, ranking, events, and the digest all
come later. Ranking is worthless until I have something like 50 rated items, so don't
build it early even though it's the fun part.

Propose your own phasing if you disagree. What I want is something usable within the
first phase, not a scaffold I have to finish before it does anything.

## Constraints

- Runs on my own machine or a small VPS. No SaaS dependency I can't replace.
- My ratings and notes are private and stay local.
- Failures are loud. A silently empty feed is worse than a crash.
- Prefer boring, durable tools. This should still run in two years with little attention.
- Keep costs near zero at personal scale.

---

## What to give me back

A plan document covering: what you found in research (including anything that
contradicts my assumptions above), proposed architecture with the region boundary drawn
explicitly, the data model, phasing with a definition of done for phase 1, the
source-by-source reliability and ToS assessment, and the open questions you need me to
answer.

Then stop and wait. I'd rather spend a round arguing about the schema than a week
undoing it.

