import { model, Schema } from 'mongoose';

/* One row per poll of one source for one account — the record the status screen and the
   "source is down" rule read. Bounded by a TTL: a run from three months ago explains nothing. */
const sourceRunSchema = new Schema({
  userId: { type: String, required: true },
  sourceId: { type: String, required: true },
  at: { type: Date, required: true, default: Date.now },
  ok: { type: Boolean, required: true },
  /** Entries the feed returned. */
  found: { type: Number, required: true, default: 0 },
  /** Candidates created — entries not already known. */
  created: { type: Number, required: true, default: 0 },
  error: { type: String, default: null },
  durationMs: { type: Number, required: true, default: 0 },
  /** What set the run off, so a manual poll and the schedule can be told apart. */
  trigger: { type: String, required: true, default: 'schedule' },
});

sourceRunSchema.index({ userId: 1, sourceId: 1, at: -1 });
sourceRunSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const SourceRun = model('SourceRun', sourceRunSchema);
