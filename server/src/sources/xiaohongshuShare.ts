import { resolveOpenGraph } from './genericOg';
import { canonicalize, capBody, capText, cleanText, fetchPage } from './html';
import { failed, type Resolved, type Resolver } from './types';

/* A Xiaohongshu note, read from its public share page.
 *
 * The app's share sheet hands out `xhslink.com/m/…` (or `.cn`), which 302s to
 * `www.xiaohongshu.com/discovery/item/<id>?xsec_token=…`. That page renders nothing into the DOM —
 * the note lives in `window.__INITIAL_STATE__`, a JavaScript object literal (not JSON: it contains
 * `undefined`). This reads the note out of it: title, desc, tags, the author. No cookie is sent and
 * no account is involved; the risk is IP-level, and the token in the URL expires, which is exactly
 * why the note is snapshotted at share time.
 *
 * When the blob is missing — a markup change, a login wall, a deleted note — the resolver falls
 * back to the page's `<title>` and `<meta description>`, which have carried the caption for years,
 * and says so in `error` rather than pretending the fallback was the plan. */

interface NoteState {
  title?: string;
  desc?: string;
  tagList?: { name?: string }[];
  user?: { nickname?: string; nickName?: string };
  noteId?: string;
  time?: number;
}

/** Find the note object inside the page's initial state, whatever it is keyed by. */
export function readNoteState(html: string): NoteState | null {
  const start = html.indexOf('window.__INITIAL_STATE__');
  if (start === -1) return null;
  const eq = html.indexOf('=', start);
  const end = html.indexOf('</script>', eq);
  if (eq === -1 || end === -1) return null;
  const literal = html
    .slice(eq + 1, end)
    .trim()
    .replace(/;$/, '')
    .replace(/\bundefined\b/g, 'null');
  let state: unknown;
  try {
    state = JSON.parse(literal);
  } catch {
    return null;
  }
  return findNote(state, 0);
}

/* The note sits at `note.noteDetailMap[<id>].note` today and sat elsewhere before; a bounded walk
   for the first object that looks like a note is what survives the next rename. */
function findNote(value: unknown, depth: number): NoteState | null {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.desc === 'string' && ('noteId' in record || 'title' in record)) {
    return record as NoteState;
  }
  for (const child of Object.values(record)) {
    const found = findNote(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export const xiaohongshuShareResolver: Resolver = {
  id: 'xiaohongshu-share',
  async resolve(url): Promise<Resolved> {
    let page;
    try {
      page = await fetchPage(url);
    } catch {
      return failed('fetch_failed', url);
    }
    if (page.status >= 400) return failed(`http_${page.status}`, url);

    const note = readNoteState(page.text);
    if (!note) {
      // The state blob is gone or unreadable; the meta tags are the second-best answer.
      const fallback = await resolveOpenGraph(new URL(page.finalUrl));
      return { ...fallback, error: fallback.error ?? 'state_missing' };
    }

    const tags = (note.tagList ?? []).map((t) => t.name).filter(Boolean) as string[];
    const author = note.user?.nickname ?? note.user?.nickName ?? null;
    const text = capText(
      cleanText(
        [note.title, note.desc, tags.length ? `#${tags.join(' #')}` : '']
          .filter(Boolean)
          .join('\n'),
      ),
    );
    return {
      canonicalUrl: canonicalize(page.finalUrl),
      contentType: 'application/json',
      /* The note object, not the page: the page is a megabyte of JS state of which this is the
         part anyone will ever re-read. */
      body: capBody(
        JSON.stringify({
          noteId: note.noteId,
          title: note.title,
          desc: note.desc,
          tags,
          author,
          time: note.time,
        }),
      ),
      text,
      error: text ? null : 'no_text',
      title: note.title?.trim() || null,
    };
  },
};
