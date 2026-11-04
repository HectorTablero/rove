import type { ItemKind, RegionDescriptor, WhenDto } from '@rove/shared';
import type { FeedEntry } from '../rss';

/* What a poller turns a feed entry into: a candidate the user has not seen yet. Everything here
   is what the *source* said — a time it printed, a venue it named — and nothing is filled in.
   `when: null` is shown as "time unknown"; a venue without coordinates waits for the user to
   press "find on map", which spends one geocoder call on purpose rather than sixty per poll. */

export interface CandidateDraft {
  kind: ItemKind;
  title: string;
  /** The entry's link, canonical for dedupe: the same event seen on two runs is one candidate. */
  link: string;
  /** Everything the entry said, for the snapshot and the extractor. */
  text: string;
  when: WhenDto | null;
  venue: string | null;
  /** The price line as printed, or null. */
  price: string | null;
  coverUrl: string | null;
  /** Genre or style tags from the source; become the item's categories. */
  categories: string[];
  /** When to drop the candidate from the inbox if nothing is done with it. */
  expiresAt: string;
  entry: FeedEntry;
}

export interface Poller {
  id: string;
  /** The RSSHub route for this region, or a `poll.missing_param:<name>` error. */
  route(region: RegionDescriptor): string;
  /** Map one entry, or null to skip it (no title, a category page rather than an event, …). */
  map(entry: FeedEntry, region: RegionDescriptor, now: Date): CandidateDraft | null;
  /** For a feed that leaves out what the event page has: the draft completed from the page
      (one fetch), or null when the page could not be read — the feed's draft then stands. */
  detail?(
    draft: CandidateDraft,
    region: RegionDescriptor,
    now: Date,
  ): Promise<CandidateDraft | null>;
}
