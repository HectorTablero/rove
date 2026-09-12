import type { RegionDescriptor } from '../region';
import { shenzhen } from './shenzhen';

/* The region registry: a static list, tagged rather than discovered.
 *
 * Deliberately not a filesystem scan. A registry that finds regions by globbing a directory fails
 * silently — a mis-named file is simply a region that does not exist — while a list here fails at
 * the type level the moment someone forgets to add to it. Adding a region is one import and one
 * entry, and the compiler lists every switch that has to grow with it. */
export const REGIONS: readonly RegionDescriptor[] = [shenzhen];

export function regionById(id: string): RegionDescriptor {
  const region = REGIONS.find((r) => r.id === id);
  if (!region) throw new Error(`unknown region "${id}"`);
  return region;
}
