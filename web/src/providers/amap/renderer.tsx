import { toDatum } from '@rove/shared';
import AMapLoader from '@amap/amap-jsapi-loader';
import { useEffect, useRef, useState } from 'react';
import type { MapViewProps } from '../renderer';

/* Amap JS API 2.0, behind the MapRenderer interface.
 *
 * The key is inlined at build time (VITE_AMAP_JS_KEY) and bound to the site's domain in Amap's
 * console; its 安全密钥 stays on the server, reached through `/_AMapService` (see
 * server/src/providers/amap/jsProxy.ts) — the `serviceHost` line below is what points the SDK
 * there. Everything this draws is converted to GCJ-02 first: Amap's tiles are GCJ-02 and a WGS-84
 * point drawn on them lands on the wrong building. */

declare global {
  interface Window {
    _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string };
  }
}

/* Amap's runtime types are a large optional package; the handful of members used here are declared
   locally instead. Everything crossing this line is `unknown` to the rest of the app anyway. */
interface AMapNamespace {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => AMapMap;
  Marker: new (opts: Record<string, unknown>) => AMapMarker;
  LngLat: new (lon: number, lat: number) => unknown;
  Bounds: new (sw: unknown, ne: unknown) => unknown;
}
interface AMapMap {
  add(overlays: AMapMarker[]): void;
  remove(overlays: AMapMarker[]): void;
  setCenter(center: unknown): void;
  setZoom(zoom: number): void;
  setBounds(bounds: unknown): void;
  setFitView(overlays?: AMapMarker[], immediately?: boolean, avoid?: number[]): void;
  destroy(): void;
}
interface AMapMarker {
  on(event: string, handler: () => void): void;
  setContent(content: string): void;
  setzIndex(z: number): void;
}

const KEY = (import.meta.env.VITE_AMAP_JS_KEY as string | undefined) ?? '';

let loading: Promise<AMapNamespace> | null = null;
function loadAMap(): Promise<AMapNamespace> {
  if (!loading) {
    window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/_AMapService` };
    loading = AMapLoader.load({ key: KEY, version: '2.0', plugins: [] }) as Promise<AMapNamespace>;
  }
  return loading;
}

/* One marker glyph per status, drawn as HTML so the colour comes from the app's own palette rather
   than a PNG per theme. Visited is filled, saved is outlined, a candidate is faint. */
const markerHtml = (
  status: MapViewProps['markers'][number]['status'],
  selected: boolean,
): string => {
  const fill = status === 'visited' ? 'var(--primary)' : 'var(--background)';
  const stroke = status === 'candidate' ? 'var(--muted-foreground)' : 'var(--primary)';
  const size = selected ? 18 : 14;
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:2.5px solid ${stroke};box-shadow:0 1px 3px rgba(0,0,0,.35);transform:translate(-50%,-50%)"></div>`;
};

export function AmapView({
  markers,
  center,
  zoom = 12,
  onSelect,
  selectedId = null,
  fitToMarkers = false,
  className,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AMapMap | null>(null);
  const ns = useRef<AMapNamespace | null>(null);
  const overlays = useRef<AMapMarker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fitted = useRef(false);
  /* The map is created asynchronously, after the SDK loads. Without a state change at that point
     nothing re-renders, so the marker effect below never sees a map and a page that renders once
     (the add screen's preview) shows no marker at all. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAMap().then((AMap) => {
      if (cancelled || !container.current) return;
      ns.current = AMap;
      const c = toDatum(center, 'GCJ02');
      map.current = new AMap.Map(container.current, {
        zoom,
        center: [c.lon, c.lat],
        viewMode: '2D',
        // The SDK's own controls are drawn later if wanted; a bare map is the right default on a phone.
        mapStyle: document.documentElement.classList.contains('dark')
          ? 'amap://styles/dark'
          : 'amap://styles/normal',
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.destroy();
      map.current = null;
      overlays.current = [];
    };
    // The map is created once; center/zoom changes after mount are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const AMap = ns.current;
    const m = map.current;
    if (!AMap || !m) return;
    m.remove(overlays.current);
    overlays.current = markers.map((marker) => {
      const p = toDatum(marker.point, 'GCJ02');
      const overlay = new AMap.Marker({
        position: [p.lon, p.lat],
        content: markerHtml(marker.status, marker.id === selectedId),
        anchor: 'center',
        title: marker.title,
        extData: marker.id,
      });
      overlay.on('click', () => onSelectRef.current?.(marker.id));
      if (marker.id === selectedId) overlay.setzIndex(200);
      return overlay;
    });
    m.add(overlays.current);
    if (fitToMarkers && !fitted.current && overlays.current.length) {
      fitted.current = true;
      m.setFitView(overlays.current, true, [60, 60, 60, 60]);
    }
  });

  useEffect(() => {
    const m = map.current;
    if (!m || fitToMarkers) return;
    const c = toDatum(center, 'GCJ02');
    m.setCenter([c.lon, c.lat]);
  }, [ready, center.lon, center.lat, center.datum, fitToMarkers]);

  /* Two divs, not one: the SDK forces `position: relative` onto its container, which voids a
     caller's `absolute inset-0` and collapses the map to height 0. The caller's layout goes on the
     outer div; the SDK gets an inner one that just fills it. */
  return (
    <div className={className}>
      <div ref={container} className="size-full" />
    </div>
  );
}
