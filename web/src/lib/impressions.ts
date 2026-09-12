import type { ImpressionAction, ImpressionSurface } from '@rove/shared';
import { useEffect } from 'react';
import { logImpression } from '@/db/mutations';

/* Impressions, without flooding the store.
 *
 * "Shown" is one row per item per surface per app launch. A list re-rendering forty times as the
 * user types a search is one impression per item, not forty — the question ranking will ask is
 * "was this seen and passed over", and a session is the honest unit for that. Actions (open,
 * navigate, save, dismiss) are logged every time, because each one is a real decision. */

const shown = new Set<string>();

export function recordShown(itemId: string, surface: ImpressionSurface): void {
  const key = `${surface}:${itemId}`;
  if (shown.has(key)) return;
  shown.add(key);
  void logImpression({ itemId, surface });
}

export function recordAction(
  itemId: string,
  surface: ImpressionSurface,
  action: ImpressionAction,
): void {
  void logImpression({ itemId, surface, action });
}

/** Marks every id in the list as shown on this surface, once per launch. */
export function useShown(ids: readonly string[], surface: ImpressionSurface): void {
  const key = ids.join('\n');
  useEffect(() => {
    for (const id of ids) recordShown(id, surface);
    // `key` stands in for the array's contents; a fresh array of the same ids must not re-log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, surface]);
}

/** Test seam: forget what has been shown this launch. */
export const resetShown = (): void => shown.clear();
