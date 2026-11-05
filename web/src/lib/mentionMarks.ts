import type { MentionDto } from '@rove/shared';

/* The caption cut into runs for colour-coding what the extractor found: each place's name, and
   the location parts it quoted for that place, in that place's colour.
 *
 * Every occurrence is marked, not only the one in the evidence: a post that names a café in its
 * title and again in its body should show both. Names win over location parts where they overlap,
 * earlier mentions over later ones. A name that cannot be found as written (normalisation, a
 * model quoting a slightly different form) falls back to marking its evidence. */

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

  const paint = (needle: string, index: number, as: MarkRole) => {
    let found = false;
    for (let at = text.indexOf(needle); needle && at !== -1; at = text.indexOf(needle, at + 1)) {
      found = true;
      for (let i = at; i < at + needle.length; i++) {
        if (owner[i] !== -1) continue;
        owner[i] = index;
        role[i] = as;
      }
    }
    return found;
  };

  mentions.forEach((mention, index) => {
    if (!paint(mention.nameText, index, 'name')) paint(mention.evidence, index, 'name');
  });
  mentions.forEach((mention, index) => {
    for (const part of mention.addressText?.split(' ') ?? []) {
      if (part.length >= MIN_PART_LENGTH) paint(part, index, 'place');
    }
  });

  const runs: MarkRun[] = [];
  for (let i = 0; i < text.length; i++) {
    const mention = owner[i] === -1 ? null : owner[i];
    const last = runs.at(-1);
    if (last && last.mention === mention && last.role === role[i]) last.text += text[i];
    else runs.push({ text: text[i], mention, role: role[i] });
  }
  return runs;
}
