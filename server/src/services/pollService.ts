import {
  MAX_POLL_ITEMS_PER_RUN,
  regionById,
  sourceById,
  SOURCE_DOWN_AFTER_RUNS,
} from '@rove/shared';
import { Types } from 'mongoose';
import { HttpError } from '../errors';
import { captureError, trackEvent, userHash } from '../lib/telemetry';
import { Item } from '../models/item';
import { Snapshot } from '../models/snapshot';
import { SourceRun } from '../models/sourceRun';
import { UserSettings } from '../models/userSettings';
import { fetchFeed, pollerById } from '../sources';
import { getSettings } from './settingsService';

/* Polling: feed → candidates, per account, per source, each run isolated.
 *
 * A candidate is an Item with `status: 'candidate'` plus the Snapshot it came from, written here
 * on the server; the client pulls them like any other row. Dedupe is by link: an entry whose URL
 * is already on any item — saved, dismissed or still a candidate — is not created again, which is
 * what keeps a dismissed event dismissed across sixty runs.
 *
 * Every failure is recorded as a run and never thrown past one source: a broken Damai route must
 * not stop Douban from being read in the same pass. */

export interface RunSummary {
  sourceId: string;
  ok: boolean;
  found: number;
  created: number;
  error: string | null;
}

export async function pollSource(
  userId: string,
  sourceId: string,
  trigger: 'schedule' | 'manual' = 'schedule',
): Promise<RunSummary> {
  const startedAt = performance.now();
  const now = new Date();
  let found = 0;
  let created = 0;
  let error: string | null = null;
  try {
    const settings = await getSettings(userId);
    const region = regionById(settings.regionId);
    const source = sourceById(sourceId);
    if (!source.polls) throw new HttpError(400, 'poll.not_pollable');
    if (source.regionIds !== '*' && !source.regionIds.includes(region.id)) {
      throw new HttpError(400, 'poll.wrong_region');
    }
    const poller = pollerById(sourceId);
    const entries = await fetchFeed(poller.route(region));
    found = entries.length;

    for (const entry of entries.slice(0, MAX_POLL_ITEMS_PER_RUN)) {
      const draft = poller.map(entry, region, now);
      if (!draft) continue;
      const known = await Item.exists({ userId, sourceUrls: draft.link });
      if (known) continue;

      const snapshot = await Snapshot.create({
        userId,
        sourceId,
        url: draft.link,
        canonicalUrl: draft.link,
        fetchedAt: now,
        contentType: 'application/rss+xml',
        body: JSON.stringify(draft.entry),
        text: draft.text,
        error: null,
        extraction: null,
      });
      await Item.create({
        userId,
        regionId: region.id,
        kind: draft.kind,
        title: draft.title,
        altTitles: [],
        categories: [],
        status: 'candidate',
        snapshotIds: [snapshot._id as Types.ObjectId],
        sourceUrls: [draft.link],
        expiresAt: new Date(draft.expiresAt),
        location: null,
        when: draft.when
          ? {
              start: new Date(draft.when.start),
              end: draft.when.end ? new Date(draft.when.end) : null,
              tz: draft.when.tz,
              allDay: draft.when.allDay,
            }
          : null,
        venue: draft.kind === 'event' ? draft.venue : null,
      });
      created++;
    }
  } catch (err) {
    error = err instanceof HttpError ? err.code : 'poll.exception';
    if (!(err instanceof HttpError)) captureError(err, { scope: 'poll', source: sourceId });
  }

  const ok = error === null;
  const durationMs = Math.round(performance.now() - startedAt);
  await SourceRun.create({
    userId,
    sourceId,
    at: now,
    ok,
    found,
    created,
    error,
    durationMs,
    trigger,
  });
  /* Never sampled: a poll is at most a handful of rows a day per account, and "found 0" is the
     row that matters — it is what the source-down banner is built from. */
  trackEvent('poll_run', {
    user: userHash(userId),
    source: sourceId,
    ok,
    found,
    created,
    error: error ?? undefined,
    duration_ms: durationMs,
    trigger,
  });
  return { sourceId, ok, found, created, error };
}

/** Every enabled source of one account, in sequence so one feed's slowness never overlaps itself. */
export async function pollUser(userId: string, trigger: 'schedule' | 'manual' = 'schedule') {
  const { pollSources } = await getSettings(userId);
  const results: RunSummary[] = [];
  for (const sourceId of pollSources) results.push(await pollSource(userId, sourceId, trigger));
  return results;
}

/** Every account that has switched a source on. The scheduler's entry point. */
export async function pollAll(): Promise<void> {
  const users = await UserSettings.find(
    { pollSources: { $exists: true, $ne: [] } },
    'userId',
  ).lean();
  for (const { userId } of users) {
    try {
      await pollUser(userId);
    } catch (err) {
      captureError(err, { scope: 'pollAll', user: userHash(userId) });
    }
  }
}

export interface SourceStatus {
  sourceId: string;
  /** Two failed or empty runs in a row: the banner condition. */
  down: boolean;
  lastRun: {
    at: string;
    ok: boolean;
    found: number;
    created: number;
    error: string | null;
    trigger: string;
  } | null;
}

/** The last runs of every source this account polls, and whether each looks down. */
export async function sourceStatuses(userId: string): Promise<SourceStatus[]> {
  const { pollSources } = await getSettings(userId);
  return Promise.all(
    pollSources.map(async (sourceId) => {
      const runs = await SourceRun.find({ userId, sourceId })
        .sort({ at: -1 })
        .limit(SOURCE_DOWN_AFTER_RUNS)
        .lean();
      const last = runs[0];
      return {
        sourceId,
        down:
          runs.length >= SOURCE_DOWN_AFTER_RUNS && runs.every((run) => !run.ok || run.found === 0),
        lastRun: last
          ? {
              at: last.at.toISOString(),
              ok: last.ok,
              found: last.found,
              created: last.created,
              error: last.error ?? null,
              trigger: last.trigger,
            }
          : null,
      };
    }),
  );
}

/** Candidates nobody acted on and that expired more than a month ago: gone, with tombstones. */
export async function sweepExpiredCandidates(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const stale = await Item.find(
    { status: 'candidate', expiresAt: { $lt: cutoff } },
    '_id userId',
  ).lean();
  if (!stale.length) return 0;
  const { recordDeletions } = await import('../models/deletion');
  const byUser = new Map<string, Types.ObjectId[]>();
  for (const row of stale as { _id: Types.ObjectId; userId: string }[]) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row._id]);
  }
  for (const [userId, ids] of byUser) {
    await Item.deleteMany({ userId, _id: { $in: ids } });
    await recordDeletions(userId, 'item', ids);
  }
  trackEvent('candidates_swept', { count: stale.length });
  return stale.length;
}
