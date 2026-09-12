import { model, Schema } from 'mongoose';
import { syncedIndexes } from './synced';

const mentionSchema = new Schema(
  {
    nameText: { type: String, required: true },
    addressText: { type: String, default: null },
    evidence: { type: String, required: true },
  },
  { _id: false },
);

const extractionSchema = new Schema(
  {
    model: { type: String, required: true },
    at: { type: Date, required: true },
    mentions: { type: [mentionSchema], default: [] },
  },
  { _id: false },
);

/* The raw payload a source produced for one URL. `body` is bounded at the edge
   (MAX_SNAPSHOT_BODY_BYTES in the shared schema) rather than here — Mongoose has no byte cap, and
   a 16 MB document limit is not the number anyone wants to find out about in production. */
const snapshotSchema = new Schema(
  {
    userId: { type: String, required: true },
    sourceId: { type: String, required: true },
    url: { type: String, required: true },
    canonicalUrl: { type: String, default: null },
    fetchedAt: { type: Date, required: true },
    contentType: { type: String, default: '' },
    body: { type: String, default: '' },
    text: { type: String, default: '' },
    error: { type: String, default: null },
    extraction: { type: extractionSchema, default: null },
  },
  { timestamps: true },
);

syncedIndexes(snapshotSchema);
// Sharing the same link twice should find the first snapshot rather than fetch again.
snapshotSchema.index({ userId: 1, url: 1 });

export const Snapshot = model('Snapshot', snapshotSchema);
