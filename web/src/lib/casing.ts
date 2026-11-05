/* Casing for machine-translated text. Chinese has no case, so a translation out of it arrives in
 * whatever case the engine chose — often all lowercase — and nothing in the source says what the
 * name's real casing is. So the case is chosen by what the text is for, and the language:
 *
 *   - a title (film, event, place) in English: title case, the way English writes names of works;
 *   - a title in Spanish or Italian, and any tag: sentence case — the convention for titles there,
 *     and for the app's own labels everywhere;
 *   - a language without case (Japanese, Chinese, Korean): left alone.
 *
 * Only ever raises a letter or lowers a small word that is plain lowercase or plain capitalised;
 * a word with capitals inside it (IMAX, iPhone, McDonald's, 3D) is the engine knowing better and is
 * kept as it came. */

export type Casing = 'title' | 'sentence';

const CASED = new Set(['en', 'es', 'it', 'fr', 'pt', 'de']);

/** English words a title keeps lowercase unless they open or close it (Chicago, roughly). */
const SMALL = new Set(
  'a an the and but or nor for so yet as at by in of off on per to up via vs from into onto with'.split(
    ' ',
  ),
);

/** A word with an uppercase letter past its first: an acronym or a brand, kept as it is. */
const hasInnerCapital = (word: string) => /\p{Lu}/u.test(word.slice(1));

const capitalize = (word: string, lng: string) =>
  word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(lng));

function titleCaseWord(word: string, edge: boolean, lng: string): string {
  if (hasInnerCapital(word)) return word;
  const bare = word.toLocaleLowerCase(lng).replace(/^\P{L}+|\P{L}+$/gu, '');
  if (!edge && SMALL.has(bare)) return word.toLocaleLowerCase(lng);
  // Each part of a hyphenated word: Spider-Man, Half-Life.
  return word
    .split('-')
    .map((part) => capitalize(part, lng))
    .join('-');
}

/** English title case. A colon or dash starts a new run, so its first word is capitalised too. */
function titleCase(text: string, lng: string): string {
  const tokens = text.split(/(\s+)/);
  const words = tokens.map((token, i) => ({ token, i })).filter(({ token }) => token.trim());
  return words
    .reduce((out, { token, i }, n) => {
      const previous = n > 0 ? words[n - 1].token : '';
      const edge = n === 0 || n === words.length - 1 || /[:—–-]$/.test(previous) || token === '-';
      out[i] = titleCaseWord(token, edge, lng);
      return out;
    }, tokens.slice())
    .join('');
}

export function applyCase(text: string, lng: string, casing: Casing): string {
  if (!CASED.has(lng)) return text;
  if (casing === 'title' && lng === 'en') return titleCase(text, lng);
  // Sentence case: the first letter up, the rest as the engine wrote it (it gets proper nouns).
  return capitalize(text, lng);
}
