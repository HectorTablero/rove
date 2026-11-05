import type { MentionDto } from '@rove/shared';

/* The caption cut into runs for colour-coding what the extractor found: each place's name, and
   the location parts it quoted for that place, in that place's colour.
 *
 * Every occurrence is marked, not only the one in the evidence: a post that names a café in its
 * title and again in its body should show both. Names win over location parts, and a longer name
 * over a shorter one inside it: 盐田云海广场 keeps its whole span rather than losing 云海广场 to a
 * second mention of that name. An occurrence overlapping text already marked is skipped whole,
 * never cut into fragments. A name that cannot be found as written (normalisation, a model quoting
 * a slightly different form) falls back to marking its evidence. */

export type MarkRole = 'name' | 'place';

export interface MarkRun {
  text: string;
  /** Index into the mentions array, for the colour; null for plain text. */
  mention: number | null;
  role: MarkRole | null;
}

/** Location parts shorter than this match too much to be worth marking ("B1", "店"). */
const MIN_PART_LENGTH = 2;

export function markMentions(text: string, mentions: MentionDto[]): MarkRun[] {
  const owner = new Array<number>(text.length).fill(-1);
  const role = new Array<MarkRole | null>(text.length).fill(null);

  /** Marks every free occurrence; true when the needle is in the text at all. */
  const paint = (needle: string, index: number, as: MarkRole) => {
    let found = false;
    for (let at = text.indexOf(needle); needle && at !== -1; at = text.indexOf(needle, at + 1)) {
      found = true;
      const end = at + needle.length;
      if (owner.slice(at, end).some((o) => o !== -1)) continue;
      owner.fill(index, at, end);
      role.fill(as, at, end);
    }
    return found;
  };

  // Longest first, each keeping its own index (and so its colour).
  const longestFirst = <T>(items: T[], length: (item: T) => number) =>
    items.map((item, index) => ({ item, index })).sort((a, b) => length(b.item) - length(a.item));

  for (const { item, index } of longestFirst(mentions, (m) => m.nameText.length)) {
    if (!paint(item.nameText, index, 'name')) paint(item.evidence, index, 'name');
  }
  const parts = mentions.flatMap((mention, index) =>
    (mention.addressText?.split(' ') ?? [])
      .filter((part) => part.length >= MIN_PART_LENGTH)
      .map((part) => ({ part, index })),
  );
  for (const { item } of longestFirst(parts, (p) => p.part.length)) {
    paint(item.part, item.index, 'place');
  }

  const runs: MarkRun[] = [];
  for (let i = 0; i < text.length; i++) {
    const mention = owner[i] === -1 ? null : owner[i];
    const last = runs.at(-1);
    if (last && last.mention === mention && last.role === role[i]) last.text += text[i];
    else runs.push({ text: text[i], mention, role: role[i] });
  }
  return runs;
}
