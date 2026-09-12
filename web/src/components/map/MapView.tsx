import { MapPinOff } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { useRegion } from '@/lib/region';
import { cn } from '@/lib/utils';
import { rendererById, type MapViewProps } from '@/providers';

/* The map, whichever renderer the region names. Loads the renderer's SDK on first use and says
   plainly when this build cannot draw — a blank rectangle would look like a bug in the data. */
export function MapView(props: Omit<MapViewProps, 'center'> & { center?: MapViewProps['center'] }) {
  const { t } = useTranslation();
  const region = useRegion();
  const renderer = rendererById(region.renderer);
  const [View, setView] = useState<ComponentType<MapViewProps> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!renderer.available()) return;
    let cancelled = false;
    renderer
      .load()
      .then((loaded) => {
        if (!cancelled) setView(() => loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [renderer]);

  if (!renderer.available() || failed) {
    return (
      <div className={cn('flex items-center justify-center', props.className)}>
        <EmptyState
          icon={MapPinOff}
          title={t('map.unavailableTitle')}
          description={failed ? t('map.loadFailed') : t('map.unavailableDescription')}
        />
      </div>
    );
  }
  if (!View) {
    return (
      <div className={cn('flex items-center justify-center', props.className)}>
        <Spinner className="size-5" />
      </div>
    );
  }
  return <View {...props} center={props.center ?? region.center} />;
}
