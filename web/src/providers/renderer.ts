import type { GeoPoint, ItemKind, ItemStatus } from '@rove/shared';
import type { ComponentType } from 'react';

/* The map renderer interface — the one provider surface that needs a DOM, so it lives in the web
   app. Five things, and nothing that would let an Amap-shaped assumption out: markers are
   described by a datum-tagged point and a status, selection reports an item id, and the renderer
   converts to its own datum internally (the only place a web file may call `toDatum`). */

export interface MapTooltip {
  kind: ItemKind;
  kindLabel: string;
  /** Shown as a chip for 'candidate' (new) and 'visited'; nothing for plain saved. */
  statusLabel: string | null;
  rating: number | null;
  ratingLabel: string | null;
  when: string | null;
  where: string | null;
  price: string | null;
  tags: string[];
  visits: string | null;
  note: string | null;
  coverUrl: string | null;
}

export interface MapMarker {
  id: string;
  point: GeoPoint;
  title: string;
  status: ItemStatus;
  /** For the hover card on devices with a mouse. Every string is plain text, already in the
      reader's language; the renderer escapes it and decides the markup. */
  tooltip?: MapTooltip;
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
