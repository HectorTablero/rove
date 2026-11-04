import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { ItemSheet } from '@/components/items/ItemSheet';
import { MapView } from '@/components/map/MapView';
import { useShown } from '@/lib/impressions';
import { isNative } from '@/lib/native';
import type { MapMarker } from '@/providers';
import { cn } from '@/lib/utils';

/* The home screen: every saved place as a marker, visited ones filled in. Full-bleed under the
   tab bar; the only chrome is the count in a corner, which doubles as the "is anything here"
   answer when the map is still loading tiles. */
export default function MapPage() {
  const { t } = useTranslation();
  const { data: items = [] } = useItems({ status: ['saved', 'visited'] });
  const [selected, setSelected] = useState<string | null>(null);

  const markers = useMemo<MapMarker[]>(
    () =>
      items.flatMap((item) =>
        item.kind !== 'film' && item.location
          ? [{ id: item.id, point: item.location.point, title: item.title, status: item.status }]
          : [],
      ),
    [items],
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
