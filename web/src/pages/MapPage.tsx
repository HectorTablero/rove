import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ItemDto, ReviewDto } from '@rove/shared';
import type { TFunction } from 'i18next';
import { useItems, useReviews } from '@/api/hooks';
import { ItemSheet } from '@/components/items/ItemSheet';
import { MapView } from '@/components/map/MapView';
import { useShown } from '@/lib/impressions';
import { isNative } from '@/lib/native';
import type { MapMarker } from '@/providers';
import { coverSrc } from '@/lib/cover';
import { formatPrice } from '@/lib/price';
import { useRegion } from '@/lib/region';
import { cn } from '@/lib/utils';
import { formatWhen } from '@/lib/when';

/** How many tags the hover card lists before it stops. */
const TOOLTIP_TAGS = 4;
const NOTE_SNIPPET = 90;

/* The hover card's lines, all plain text (the renderer escapes them): what it is and where it
   stands, then when, where, what it costs and its tags, then what you made of it. */
function tooltipFor(
  item: ItemDto,
  review: ReviewDto | undefined,
  t: TFunction,
  lng: string,
  currency: string,
) {
  const stars = review?.rating ? '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) : null;
  const meta = [t(`items.kind.${item.kind}`), t(`items.status.${item.status}`), stars]
    .filter(Boolean)
    .join(' · ');
  const when =
    item.kind === 'place' ? null : item.when ? formatWhen(item.when, lng) : t('items.timeUnknown');
  const where =
    item.kind === 'event'
      ? (item.venue ?? item.location?.address ?? null)
      : item.kind === 'place'
        ? item.location.address
        : null;
  const visits = review?.visits.length ?? 0;
  const note = review?.notes.trim().split('\n')[0] ?? '';
  const details = [
    when,
    where,
    formatPrice(item.price, t, lng, currency),
    item.categories.slice(0, TOOLTIP_TAGS).join(' · ') || null,
    visits > 0 ? t('map.visits', { count: visits }) : null,
    note ? `“${note.length > NOTE_SNIPPET ? `${note.slice(0, NOTE_SNIPPET)}…` : note}”` : null,
  ].filter((line): line is string => Boolean(line));
  return { meta, details, coverUrl: coverSrc(item.coverUrl) };
}

/* The home screen: every saved place as a marker, visited ones filled in. Full-bleed under the
   tab bar; the only chrome is the count in a corner, which doubles as the "is anything here"
   answer when the map is still loading tiles. */
export default function MapPage() {
  const { t, i18n } = useTranslation();
  const { data: items = [] } = useItems({ status: ['saved', 'visited'] });
  const { data: reviews = [] } = useReviews();
  const region = useRegion();
  const [selected, setSelected] = useState<string | null>(null);

  const markers = useMemo<MapMarker[]>(
    () =>
      items.flatMap((item) =>
        item.kind !== 'film' && item.location
          ? [
              {
                id: item.id,
                point: item.location.point,
                title: item.title,
                status: item.status,
                tooltip: tooltipFor(
                  item,
                  reviews.find((r) => r.itemId === item.id),
                  t,
                  i18n.language,
                  region.currency,
                ),
              },
            ]
          : [],
      ),
    [items, reviews, t, i18n.language, region.currency],
  );
  useShown(
    markers.map((m) => m.id),
    'map',
  );

  // No scrolling and no scrollbar gutter while the map is up (see index.css).
  useEffect(() => {
    document.documentElement.setAttribute('data-fullbleed', '');
    return () => document.documentElement.removeAttribute('data-fullbleed');
  }, []);

  return (
    <div
      className={cn(
        'relative h-[calc(100dvh-var(--inset-top)-5.5rem-var(--inset-bottom))]',
        !isNative && 'md:h-dvh',
      )}
    >
      <h1 className="sr-only">{t('nav.map')}</h1>
      <MapView
        className="absolute inset-0"
        markers={markers}
        selectedId={selected}
        onSelect={setSelected}
        fitToMarkers={markers.length > 0}
      />
      <div className="pointer-events-none absolute top-3 left-3 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
        {t('map.markerCount', { count: markers.length })}
      </div>
      <ItemSheet itemId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
