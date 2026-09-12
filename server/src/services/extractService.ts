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

const SYSTEM = `You read a social-media post about places to visit and list the specific places it names.
Rules:
- A place is a named venue: a restaurant, café, bar, shop, park, hike, viewpoint, exhibition space. Not a city, district or street on its own.
- Copy names exactly as written in the post, in the post's own language and script. Do not translate, expand or correct them.
- "evidence" must be a verbatim, contiguous quote from the post that contains the name. Copy it character for character.
- "addressText" is a verbatim quote of any address or location hint for that place, or null.
- If the post names no specific place, return an empty list.
Answer with JSON only: {"mentions":[{"nameText":"…","addressText":null,"evidence":"…"}]}`;

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
    if (mention.addressText && !source.includes(mention.addressText.normalize('NFC'))) {
      mention = { ...mention, addressText: null };
    }
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
