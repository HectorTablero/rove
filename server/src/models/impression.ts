import { IMPRESSION_ACTIONS, IMPRESSION_SURFACES } from '@rove/shared';
import { model, Schema } from 'mongoose';
import { syncedIndexes } from './synced';

/* "This item was shown here, and this is what happened." Cheap rows, logged from the first day, so
   the ranking that arrives later has skips to learn from and not only ratings. */
const impressionSchema = new Schema(
  {
    userId: { type: String, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    surface: { type: String, required: true, enum: IMPRESSION_SURFACES },
    at: { type: Date, required: true },
    action: { type: String, enum: [...IMPRESSION_ACTIONS, null], default: null },
  },
  { timestamps: true },
);

syncedIndexes(impressionSchema);
impressionSchema.index({ userId: 1, itemId: 1, at: -1 });

export const Impression = model('Impression', impressionSchema);
