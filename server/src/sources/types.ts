/* What a source's resolver produces for one URL — the fields of a Snapshot the server can fill.
   The client owns the row (it creates it through its outbox, so the add screen works offline up
   to the fetch); the server only does the part a browser cannot: the cross-origin fetch. */

export interface Resolved {
  /** After redirects and tracking-parameter stripping. */
  canonicalUrl: string | null;
  contentType: string;
  /** The raw payload, bounded and script-stripped. Empty on failure. */
  body: string;
  /** The caption / description the extractor will read. Empty on failure. */
  text: string;
  /** A short i18n-ish code plus detail, or null. Loud on purpose: "could not read this link" with
      a reason beats a blank. */
  error: string | null;
  /** Anything the source learned that is worth surfacing: a title, an author. */
  title: string | null;
}

export interface Resolver {
  id: string;
  resolve(url: URL): Promise<Resolved>;
}

export const failed = (error: string, url: URL): Resolved => ({
  canonicalUrl: url.toString(),
  contentType: '',
  body: '',
  text: '',
  error,
  title: null,
});
