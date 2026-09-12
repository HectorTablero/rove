import { model, Schema } from 'mongoose';

/* Cached geocoder answers, keyed by the exact query.
 *
 * Not per user: a query is a place name, not a person's data, and the answer is the same for
 * everyone in the region. Kept indefinitely — a POI's coordinates do not move, and the provider's
 * search pool (5,000 calls a month on Amap's personal tier) is the scarce resource this exists to
 * protect. A stale entry costs a slightly old district name; a cache miss costs a call. */
const geocodeCacheSchema = new Schema(
  {
    provider: { type: String, required: true },
    regionId: { type: String, required: true },
    /** The query after `foldQuery` — what the provider was actually asked. */
    query: { type: String, required: true },
    candidates: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

geocodeCacheSchema.index({ provider: 1, regionId: 1, query: 1 }, { unique: true });

export const GeocodeCache = model('GeocodeCache', geocodeCacheSchema);

/* One row per provider per calendar month, incremented atomically on every paid call.
   The counter is the only thing standing between a runaway retry loop and a bill. */
const providerUsageSchema = new Schema({
  provider: { type: String, required: true },
  month: { type: String, required: true },
  calls: { type: Number, required: true, default: 0 },
});

providerUsageSchema.index({ provider: 1, month: 1 }, { unique: true });

export const ProviderUsage = model('ProviderUsage', providerUsageSchema);

export const currentMonth = (now = new Date()): string => now.toISOString().slice(0, 7);
