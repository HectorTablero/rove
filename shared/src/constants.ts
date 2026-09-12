/* --- Regions and coordinates -------------------------------------------------------------------

   The datum a coordinate is expressed in. Every GeoPoint carries one, and the conversions between
   them happen at exactly two places: a provider's renderer (drawing a point on its own tiles) and a
   provider's navigation builder (handing a point to a maps app). Nothing in core ever converts.
   A silent mix of GCJ-02 and WGS-84 is a ~500 m offset that looks like nothing is wrong. */
export const DATUMS = ['WGS84', 'GCJ02', 'BD09'] as const;
export type Datum = (typeof DATUMS)[number];

/** The only region that exists. The type is a string on purpose: a second region is additive. */
export const DEFAULT_REGION_ID = 'shenzhen';
export const REGION_ID_REGEX = /^[a-z][a-z0-9-]{0,31}$/;

/* --- Items ---------------------------------------------------------------------------------------

   One row shape for everything worth your time: a place that never expires, an event that does, a
   film that is in cinemas for a few weeks. `kind` is a discriminator on a union (see schemas.ts),
   not a free tag, so a film with coordinates or an event without a time window cannot be stored. */
export const ITEM_KINDS = ['place', 'event', 'film'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** `candidate` is what an ingester produces; nothing becomes `saved` without the user. */
export const ITEM_STATUSES = ['candidate', 'saved', 'visited', 'dismissed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const MAX_TITLE_LENGTH = 200;
export const MAX_ALT_TITLES = 10;
export const MAX_CATEGORIES = 10;
export const MAX_CATEGORY_LENGTH = 40;
export const MAX_ADDRESS_LENGTH = 300;
export const MAX_URL_LENGTH = 2048;
export const MAX_SOURCE_URLS = 20;
export const MAX_SNAPSHOTS_PER_ITEM = 20;
export const MAX_PROVIDER_ID_LENGTH = 100;

/* --- Snapshots -----------------------------------------------------------------------------------

   The raw payload a source produced, kept so extraction can be re-run over history without
   re-fetching — a share page whose token has expired, a caption that has since been edited. Bounded
   because a page is arbitrarily large; the resolver strips scripts before storing, keeping only the
   state blob it read the text from. Measured on the UTF-8 encoding, since Chinese text is three
   bytes a character and the cap is bytes. */
export const MAX_SNAPSHOT_BODY_BYTES = 262_144;
export const MAX_SNAPSHOT_TEXT_LENGTH = 20_000;
export const MAX_MENTIONS_PER_SNAPSHOT = 20;
export const MAX_MENTION_LENGTH = 200;
export const MAX_SOURCE_ID_LENGTH = 40;
export const SOURCE_ID_REGEX = /^[a-z][a-z0-9-]{0,39}$/;

/* --- Reviews -------------------------------------------------------------------------------------

   The only irreplaceable rows: items can be re-derived from snapshots, a rating cannot. Kept apart
   from the item on purpose, and exported first in a backup. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_VISITS = 200;

/* --- Impressions ---------------------------------------------------------------------------------

   "This item was shown here, and this is what happened." Logged from the first day so that when
   ranking arrives it has skips to learn from, not only ratings. */
export const IMPRESSION_SURFACES = ['list', 'map', 'sheet', 'digest'] as const;
export type ImpressionSurface = (typeof IMPRESSION_SURFACES)[number];
export const IMPRESSION_ACTIONS = ['open', 'navigate', 'save', 'dismiss'] as const;
export type ImpressionAction = (typeof IMPRESSION_ACTIONS)[number];

/* --- Settings ------------------------------------------------------------------------------------

   The account's synced settings. Device-local preferences (theme, language, telemetry) live in
   web/src/lib/preferences.ts and never reach the server. */
export const DEFAULT_SETTINGS = {
  regionId: DEFAULT_REGION_ID,
  /** Drop the success toasts for everyday actions, keeping errors and the confirmations the
      user cannot otherwise verify. See notifySuccess in web/src/lib/notify.ts. */
  quietNotifications: true,
  /* The model that extracts place mentions from a pasted post. Any OpenAI-compatible
     chat-completions endpoint: a local box (a DGX Spark running vLLM or Ollama), Groq, OpenRouter.
     The base URL and model are ordinary settings; the key is write-only — see SettingsDto. */
  llmBaseUrl: '',
  llmModel: '',
  /** Whether a key is stored — never the key itself. */
  hasLlmKey: false,
  /** Source ids the server polls for this account. Empty: nothing is fetched on a schedule. */
  pollSources: [] as string[],
};

/* --- Polling -------------------------------------------------------------------------------------

   Feeds are read on a schedule by the server for every account that has switched a source on.
   Candidates expire: an event after it has happened, a film a couple of months after release, and
   anything a poller could not date after a month — a stale suggestion is worse than none. */
export const MAX_POLL_ITEMS_PER_RUN = 60;
export const MAX_POLL_SOURCES = 20;
/** How long an undated candidate stays in the inbox. */
export const CANDIDATE_UNDATED_TTL_DAYS = 30;
/** How long a film stays after its release date. */
export const FILM_TTL_DAYS = 60;
/** Two empty or failed runs in a row is "the source is down", shown as a banner. */
export const SOURCE_DOWN_AFTER_RUNS = 2;
export const MAX_VENUE_LENGTH = 200;

export const MAX_LLM_BASE_URL_LENGTH = 300;
export const MAX_LLM_MODEL_LENGTH = 100;
export const MAX_LLM_KEY_LENGTH = 500;

/** Requests per user per window on the resolve and extract routes, together. A paste is one
    resolve and at most one extract, so this is invisible in normal use and stops a retry loop. */
export const INGEST_RATE_LIMIT = 60;
export const INGEST_RATE_WINDOW_MS = 5 * 60_000;

/** The Android application id. Must match `applicationId` in web/android/app/build.gradle — it is
    half of what Android checks when verifying this site's App Links (the other half is the signing
    certificate), and a mismatch fails silently, as links that simply stop opening the app. */
export const ANDROID_PACKAGE_NAME = 'es.tablerus.rove';

export const LOGO_COLOR = 'rgb(0, 114, 255)';
export const LOGO_LOCAL_COLOR = 'rgb(220, 70, 70)';
export const LOGO_STROKE_WIDTH = 50;
export const LOGO_VIEWBOX = '0 0 500 500';
export const LOGO_DISPLACED_VIEWBOX = '-10 0 490 500';

/** My (Héctor Tablero) personal's portfolio and brand logo, resembling a tab icon (->|)
    In every one of my apps, the logo transforms between the brand and the app logo on different
    moments. In Diary, it does so on sidebar logo hover (web version, tablet+ width) and on the
    Android app's splash screen.
*/
export const BRAND_LOGO_PATHS = [
  { d: 'M 375 250 L 50 250' },
  { d: 'M 300 125 L 337.5 187.5 L 375 250 L 337.5 312.5 L 300 375' },
  { d: 'M 450 100 L 450 400' },
] as const;

/** App path, matching the number of path corners per path in the brand logo so browsers can
    smoothly transition between them (d property). */
export const APP_LOGO_PATHS = [
  { d: 'M 275 400 L 125 400' },
  { d: 'M 200 100 L 375 100 L 325 175 L 375 250 L 200 250' },
  { d: 'M 200 100 L 200 400' },
] as const;

/**
 * Which of the two logos the Android status-bar notification icon is drawn as: 'brand' for the tab
 * mark (->|), 'app' for the app mark.
 *
 * Both read at a glance at 24dp, which is the only real constraint — Android throws away every
 * colour in this icon and keeps the alpha channel, so it is a silhouette in the status bar whatever
 * the source says. Flipping this constant and re-running `npm run generate:assets` is the whole
 * change; the drawable it writes (android/.../drawable/ic_stat_notify.xml) is generated, ignored by
 * git, and named by `smallIcon` in web/capacitor.config.ts.
 *
 * Annotated with the union rather than inferred, so that switching it doesn't turn every comparison
 * against the other value into a type error.
 */
export const NOTIFICATION_ICON_LOGO: 'brand' | 'app' = 'brand';

/**
 * How long a delete stays pullable as a tombstone.
 *
 * A tombstone is the only evidence a client has that a doc was deleted, so this window is the
 * contract between what the server keeps and how far back a client's sync cursor may reach. Past
 * it the deletes have been pruned and an incremental pull would silently omit them, so `/api/sync`
 * answers such a cursor with a full reset instead (`SyncResponse.reset`).
 *
 * It lives here rather than in the environment because both halves of that contract have to agree
 * on one number — it is protocol, not deployment.
 */
export const TOMBSTONE_RETENTION_DAYS = 180;
export const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 86_400_000;

export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/** ObjectId-shaped id (timestamp prefix + random) generated client-side for offline creates. */
export function newObjectId(): string {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return time + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
