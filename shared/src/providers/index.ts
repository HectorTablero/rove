import type { Navigation } from '../region';

/* The one datum conversion, re-exported for renderers; only a provider may call it (see the
   boundary test). */
export { toDatum } from './datum';
import { amapNavigation } from './amap/navigation';

/* The navigation registry — the one provider surface that is pure and therefore lives in shared,
   where both the web app (the Navigate button) and the server (a digest's links, later) can reach
   it. Geocoders are registered in the server and renderers in the web app, each by the same id a
   RegionDescriptor names. */
export const NAVIGATIONS: readonly Navigation[] = [amapNavigation];

export function navigationById(id: string): Navigation {
  const navigation = NAVIGATIONS.find((n) => n.id === id);
  if (!navigation) throw new Error(`unknown navigation provider "${id}"`);
  return navigation;
}
