import type { MapRenderer } from './renderer';

/* The web app's provider registry: map renderers by id, loaded lazily. Core reaches a renderer
   only through here, by the id the region names. */

export type { MapMarker, MapRenderer, MapViewProps } from './renderer';

const amapRenderer: MapRenderer = {
  id: 'amap',
  available: () => Boolean(import.meta.env.VITE_AMAP_JS_KEY),
  load: () => import('./amap/renderer').then((m) => m.AmapView),
};

export const RENDERERS: readonly MapRenderer[] = [amapRenderer];

export function rendererById(id: string): MapRenderer {
  const renderer = RENDERERS.find((r) => r.id === id);
  if (!renderer) throw new Error(`unknown map renderer "${id}"`);
  return renderer;
}
