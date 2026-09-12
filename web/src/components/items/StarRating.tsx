import { RATING_MAX, RATING_MIN } from '@rove/shared';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/* Five stars, as a radio group: arrow keys move, and each star has a name a screen reader can say.
   Tapping the current rating clears it — a rating is optional, and "no opinion yet" has to be
   reachable without a separate control. */
export function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const stars = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);
  return (
    <div role="radiogroup" aria-label={t('items.rating')} className="flex items-center gap-1">
      {stars.map((star) => {
        const filled = value !== null && star <= value;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={t('items.stars', { count: star })}
            disabled={disabled}
            onClick={() => onChange(value === star ? null : star)}
            className={cn(
              'rounded-full p-1 transition-colors disabled:opacity-50',
              filled ? 'text-amber-500' : 'text-muted-foreground/50 hover:text-muted-foreground',
            )}
          >
            <Star className="size-5" fill={filled ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
}
