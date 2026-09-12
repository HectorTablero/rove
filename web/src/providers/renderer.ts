import type { GeoPoint, ItemStatus } from '@rove/shared';
import type { ComponentType } from 'react';

/* The map renderer interface — the one provider surface that needs a DOM, so it lives in the web
   app. Five things, and nothing that would let an Amap-shaped assumption out: markers are
   described by a datum-tagged point and a status, selection reports an item id, and the renderer
   converts to its own datum internally (the only place a web file may call `toDatum`). */

export interface MapMarker {
  id: string;
  point: GeoPoint;
  title: string;
  status: ItemStatus;
}

export interface MapViewProps {
  markers: MapMarker[];
  /** Where to look before the user's location is known. */
  center: GeoPoint;
  /** Zoom level in the web-mercator sense (roughly 3 world … 18 street). */
  zoom?: number;
  /** A marker was tapped. */
  onSelect?: (id: string) => void;
  /** Which marker to draw as selected, if any. */
  selectedId?: string | null;
  /** Fit the view to every marker on first render, rather than to `center`. */
  fitToMarkers?: boolean;
  className?: string;
}

export interface MapRenderer {
  id: string;
  /** Whether this build can draw at all — a renderer needing a key says no without one. */
  available(): boolean;
  /** Loaded lazily: the SDK is hundreds of kilobytes and only the map screens need it. */
  load(): Promise<ComponentType<MapViewProps>>;
}
