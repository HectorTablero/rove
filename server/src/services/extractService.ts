import type { MentionDto } from '@rove/shared';
import { MAX_MENTIONS_PER_SNAPSHOT, mentionSchema } from '@rove/shared';
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

const SYSTEM = `You read a social-media post about places to visit and list the specific places it names, so each can be found on a map.
Rules:
- A place is a named venue: a restaurant, café, bar, shop, park, hike, viewpoint, exhibition space. Not a city, district or street on its own.
- "nameText": the venue's name exactly as the post writes it, in the post's own language and script. Do not translate, expand or correct it. For a chain or brand, include the branch when the post names one, as written (e.g. "喜茶(海上世界店)").
- "evidence": a verbatim, contiguous quote from the post that contains the name, copied character for character.
- "addressText": where the place is, split into its parts from the largest area to the smallest, separated by single spaces: province, city, district, town or village, area, street and number, building or mall, floor or unit. Chinese often runs these together without commas or in reverse order: "平山村桃园深圳广东" is "广东 深圳 平山村 桃园"; "南山区蛇口海上世界广场B1" is "南山区 蛇口 海上世界广场 B1". Copy every part exactly from the post and never add a part the post does not state. null if the post gives no location.
- "searchText": what to type into a map search (高德/Amap) to find this exact place rather than another branch of the same brand or another place with a similar name: the name followed by the most specific location parts the post gives (mall or building, street, area, district), separated by single spaces, e.g. "星巴克 海上世界" or "Bionic Brew 蛇口". A brand's flagship, themed or limited store must be told apart from its ordinary branches this way. Every part copied exactly from the post; if the post gives nothing beyond the name, the name alone.
- If the post names no specific place, return an empty list.
Answer with JSON only: {"mentions":[{"nameText":"…","addressText":"…","searchText":"…","evidence":"…"}]}`;

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

/** The one place model output becomes app data — and only after the evidence check. */
export function validateMentions(mentions: MentionDto[], text: string): MentionDto[] {
  const source = text.normalize('NFC');
  const kept: MentionDto[] = [];
  const seen = new Set<string>();
  for (const proposed of mentions) {
    let mention = proposed;
    const evidence = mention.evidence.normalize('NFC');
    if (!source.includes(evidence)) continue;
    // The name has to be in its own evidence too, or the evidence is decoration.
    if (!evidence.includes(mention.nameText.normalize('NFC'))) continue;
    mention = {
      ...mention,
      addressText: quotedParts(mention.addressText, source),
      searchText: quotedParts(mention.searchText, source),
    };
    const key = mention.nameText.normalize('NFKC').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...mention, evidence });
    if (kept.length >= MAX_MENTIONS_PER_SNAPSHOT) break;
  }
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
