import { model, Schema } from 'mongoose';
import { syncedIndexes } from './synced';

/* Private, and the only irreplaceable rows: an item can be re-derived from its snapshots, a rating
   cannot. Kept apart from the item on purpose, so the two can be exported, backed up and one day
   shared on different terms. */
const reviewSchema = new Schema(
  {
    userId: { type: String, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    rating: { type: Number, default: null },
    notes: { type: String, default: '' },
    visits: { type: [Date], default: [] },
  },
  { timestamps: true },
);

syncedIndexes(reviewSchema);
/* One review per item per user. Unique so that two devices creating "the review for this place"
   offline collide on the index and converge through the client's ordinary 409-on-create path,
   instead of leaving two rows whose ratings disagree. */
reviewSchema.index({ userId: 1, itemId: 1 }, { unique: true });

export const Review = model('Review', reviewSchema);
