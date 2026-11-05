import type { TFunction } from 'i18next';

/* Prices as the feeds print them — `39.0元起`, `220.0元`, `¥56起`, `¥298`, `380-1680`, `免费` —
   shown one way: the currency symbol first, no stray `.0`, a range with an en dash, and "from" in
   the reader's language. Stored text is never rewritten; this is display only, and anything it
   cannot read is shown exactly as printed. */

export interface ParsedPrice {
  free: boolean;
  min: number | null;
  max: number | null;
  /** "起" / "以上" / "from": the lowest tier, more above it. */
  from: boolean;
}

const NUMBER = /\d+(?:\.\d+)?/g;
/** A number the text marks as money: `¥56`, `220.0元`, `1688 元`. */
const PRICED = /[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/g;
/** Nothing but prices: numbers, currency marks, separators, "from". A tier list is this. */
const ONLY_PRICES = /^[\d.\s¥￥元/、,，|~～起-]+$/;

export function parsePrice(raw: string): ParsedPrice | null {
  const text = raw.normalize('NFKC').trim();
  if (/免费|free/i.test(text)) return { free: true, min: null, max: null, from: false };
  // Only prices this region writes: yuan, ¥ or a bare number. Another currency stays as printed.
  if (/[$€£]|usd|eur|hkd/i.test(text)) return null;
  /* A text of nothing but prices is a tier list however long (`1688元　1388元　…　588元`,
     `80/120/180元`): its cheapest to its dearest. In a sentence, only the numbers marked as money
     count, so a stray count (`学生票 50元（限2人）`) is not read as a price; and a sentence with no
     marks is a price only as one or two bare numbers (`298`, `380-1680`). */
  const all = (text.match(NUMBER) ?? []).map(Number);
  const priced = [...text.matchAll(PRICED)].map((m) => Number(m[1] ?? m[2]));
  const numbers = ONLY_PRICES.test(text) ? all : priced.length ? priced : all;
  if (numbers.length === 0 || (numbers === all && !ONLY_PRICES.test(text) && all.length > 2))
    return null;
  const from = /起|以上|from|\+$/i.test(text);
  const [min, max] =
    numbers.length >= 2 ? [Math.min(...numbers), Math.max(...numbers)] : [numbers[0], null];
  return { free: false, min, max: max === min ? null : max, from };
}

export function formatPrice(
  raw: string | null,
  t: TFunction,
  lng: string,
  currency: string,
): string | null {
  if (!raw) return null;
  const price = parsePrice(raw);
  if (!price) return raw;
  if (price.free) return t('price.free');
  const money = new Intl.NumberFormat(lng, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const amount =
    price.max !== null
      ? `${money.format(price.min!)}–${new Intl.NumberFormat(lng, { maximumFractionDigits: 2 }).format(price.max)}`
      : money.format(price.min!);
  return price.from ? t('price.from', { price: amount }) : amount;
}
