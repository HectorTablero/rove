import type { MentionDto } from '@rove/shared';
import { MAX_MENTION_ALIASES, MAX_MENTIONS_PER_SNAPSHOT, mentionSchema } from '@rove/shared';
import { z } from 'zod';
import { HttpError } from '../errors';
import { chatCompletion } from '../lib/aiChatClient';
import { trackEvent } from '../lib/telemetry';
import { getLlmConfig } from './settingsService';

/* Extraction: messy caption in, candidate place mentions out.
 *
 * The model is asked for *mentions*, each with the verbatim span it was read from, and the span is
 * checked here against the text. A mention whose evidence is not a substring of the source is
 * dropped before anyone sees it. That is the structural half of "the LLM never originates a fact":
 * the model can propose, and it can only propose things that are literally in the post. Addresses
 * and coordinates come from the geocoder afterwards, never from here. */

const SYSTEM = `You read a social-media post about places to visit and list the specific places it names, so each can be found on a map. Answer with JSON only.

# What is a place
A named venue: a restaurant, café, bar, shop, park, hike, viewpoint, temple, exhibition space. Not a city, district, street, metro station or bus line on its own. Each place appears once in the answer, however many names the post gives it.

# Names
A place's names are only its names, each copied exactly as the post writes it: never a phrase or sentence around a name ("also known as …", "a hike to …"), never with brackets, punctuation or emoji. Collect every name the post gives the same place:
- a translation or romanisation: "Yunhai Park" and 云海公园;
- a shorter or longer form: 云海广场 and 盐田云海广场;
- a name with its other form in brackets beside it, which is very common in posts mixing languages: "Meishajian (梅沙尖)" gives two names, Meishajian and 梅沙尖.
Of these, the main name ("nameText") is the one a map search (高德/Amap) finds the place by most surely: a Chinese name over a translation, and the most specific form (carrying its district or branch) over a shorter one. Every other name goes in "aliases". For a chain, the main name includes the branch when the post gives one, as written: "喜茶(海上世界店)".

# Fields
- "nameText": the main name.
- "aliases": the other names, each a bare name as above. [] only if the post gives the place no other name.
- "evidence": one verbatim, contiguous quote from the post containing the main name, copied character for character.
- "addressText": where the place is, its parts from the largest area to the smallest, separated by single spaces (province, city, district, town or village, area, street and number, building or mall, floor or unit). Chinese often runs these together or in reverse: "南山区蛇口海上世界广场B1" is "南山区 蛇口 海上世界广场 B1". Every part copied exactly from the post; never add one. null if the post gives no location.
- "searchText": what to type into the map search to find this exact place and not another branch or a similar name: the main name, then the most specific location parts the post gives, separated by single spaces ("星巴克 海上世界"). The main name alone if the post gives nothing more.

# Steps
1. Find every place the post names.
2. For each, gather all its names from the whole post, including names in brackets beside another name.
3. Choose the main name; the rest are aliases. Check that no alias is a phrase, carries brackets, or repeats the main name.
4. Fill the remaining fields.
If the post names no specific place, answer {"mentions":[]}.

# Example
Post:
Spent Sunday at Lianhua Hill (莲花山公园), the park locals just call 莲花山.
📍莲花山公园：福田区红荔路6030号
After, coffee at Bionic Brew in 蛇口.

Answer:
{"mentions":[
{"nameText":"莲花山公园","aliases":["Lianhua Hill","莲花山"],"addressText":"福田区 红荔路6030号","searchText":"莲花山公园 福田区","evidence":"Spent Sunday at Lianhua Hill (莲花山公园)"},
{"nameText":"Bionic Brew","aliases":[],"addressText":"蛇口","searchText":"Bionic Brew 蛇口","evidence":"coffee at Bionic Brew in 蛇口"}
]}`;

/* The parts of a composed field (an address split into components, a search query), each of which
   must be quoted from the post: the model may reorder and separate what the post says, never add
   to it. */
const PART_SEPARATORS = /[\s,，、;；|/]+/u;
function quotedParts(composed: string | null, source: string): string | null {
  if (!composed) return null;
  const parts = composed.normalize('NFC').split(PART_SEPARATORS).filter(Boolean);
  if (!parts.length || !parts.every((part) => source.includes(part))) return null;
  return parts.join(' ');
}

const responseSchema = z.object({
  mentions: z.array(mentionSchema).max(MAX_MENTIONS_PER_SNAPSHOT * 2),
});

const nameKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase();

/**
 * The one place model output becomes app data — and only after the evidence check.
 *
 * Aliases are held to the same rule as names: one that is not in the text is dropped. A place the
 * model listed twice anyway — once as itself, once among another's aliases — is folded into the
 * one that named it as an alias, its own name becoming an alias there, so the post's synonyms
 * come out as one place.
 */
export function validateMentions(mentions: MentionDto[], text: string): MentionDto[] {
  const source = text.normalize('NFC');
  const valid: MentionDto[] = [];
  for (const proposed of mentions) {
    const evidence = proposed.evidence.normalize('NFC');
    if (!source.includes(evidence)) continue;
    // The name has to be in its own evidence too, or the evidence is decoration.
    if (!evidence.includes(proposed.nameText.normalize('NFC'))) continue;
    const aliases = (proposed.aliases ?? [])
      .map((alias) => alias.normalize('NFC'))
      .filter((alias) => source.includes(alias) && nameKey(alias) !== nameKey(proposed.nameText));
    valid.push({
      ...proposed,
      addressText: quotedParts(proposed.addressText, source),
      searchText: quotedParts(proposed.searchText, source),
      aliases: [...new Set(aliases)],
      evidence,
    });
  }

  /* Mentions sharing any name — one's name among another's aliases, or one alias in both — are
     one place. Grouped transitively; the earliest of a group is the one kept, and its name stays
     the main one, the rest joining its aliases. */
  const group = valid.map((_, index) => index);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  const claimedBy = new Map<string, number>();
  valid.forEach((mention, index) => {
    for (const name of [mention.nameText, ...mention.aliases!]) {
      const other = claimedBy.get(nameKey(name));
      if (other === undefined) claimedBy.set(nameKey(name), index);
      else {
        const [low, high] = [root(other), root(index)].sort((x, y) => x - y);
        group[high] = low;
      }
    }
  });
  const kept: MentionDto[] = [];
  const keptAt = new Map<number, MentionDto>();
  valid.forEach((mention, index) => {
    const target = keptAt.get(root(index));
    if (target) {
      const names = [mention.nameText, ...mention.aliases!].filter(
        (name) => nameKey(name) !== nameKey(target.nameText),
      );
      target.aliases = [
        ...new Map([...target.aliases!, ...names].map((n) => [nameKey(n), n])).values(),
      ];
      target.addressText ??= mention.addressText;
      target.searchText ??= mention.searchText;
      return;
    }
    if (kept.length >= MAX_MENTIONS_PER_SNAPSHOT) return;
    const copy = { ...mention, aliases: [...mention.aliases!] };
    keptAt.set(index, copy);
    kept.push(copy);
  });
  for (const mention of kept) mention.aliases = mention.aliases!.slice(0, MAX_MENTION_ALIASES);
  return kept;
}

/** Pull the JSON out of a reply that may wrap it in a code fence or prose. */
function parseReply(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new HttpError(502, 'extract.bad_reply');
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new HttpError(502, 'extract.bad_reply');
    }
  }
}

export async function extractMentions(
  userId: string,
  text: string,
): Promise<{ model: string; mentions: MentionDto[] }> {
  const llm = await getLlmConfig(userId);
  if (!llm.baseUrl || !llm.model) throw new HttpError(503, 'extract.not_configured');

  const startedAt = performance.now();
  const completion = await chatCompletion(llm.baseUrl, llm.apiKey, {
    model: llm.model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ],
    temperature: 0,
    max_tokens: 2000,
    /* Asked for, not relied on: vLLM, Groq and OpenRouter honour it, a bare llama.cpp may not, and
       parseReply copes either way. */
    response_format: { type: 'json_object' },
  } as Parameters<typeof chatCompletion>[2]);

  const raw = completion.choices[0]?.message.content ?? '';
  const parsed = responseSchema.safeParse(parseReply(raw));
  if (!parsed.success) throw new HttpError(502, 'extract.bad_reply');
  const mentions = validateMentions(parsed.data.mentions, text);
  trackEvent('extract', {
    model: llm.model,
    proposed: parsed.data.mentions.length,
    kept: mentions.length,
    duration_ms: Math.round(performance.now() - startedAt),
  });
  return { model: llm.model, mentions };
}
