import type { SyncCollection } from '@rove/shared';
import { objectIdSchema } from '@rove/shared';
import { Hono } from 'hono';
import { Types, type Model } from 'mongoose';
import type { ZodType } from 'zod';
import { conflict, isDuplicateKey, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { clearDeletions, recordDeletions } from '../models/deletion';

/**
 * The three writes every synced collection accepts, built once.
 *
 * The client is local-first: it reads exclusively from its own Dexie store and reconciles through
 * GET /sync, so the API only has to accept the writes its outbox replays — a create, a patch and a
 * delete, each carrying the caller's own id. Four collections wanting the same three handlers with
 * the same tolerance rules is the reason this is a factory: the rules are subtle, and four copies of
 * them would drift.
 *
 * Those rules, and why each exists:
 *
 * - **A create carries its own id.** The client generates it so an offline create keeps its
 *   identity when it syncs; the server stores it under that `_id`. A create whose id already exists
 *   is a *replayed* create (the first attempt succeeded but the response was lost) and answers 409 —
 *   which the client's outbox treats as "already applied" and moves on. That is `isDuplicateKey(err,
 *   '_id')`. A collision on any *other* unique index (a review for an item that already has one) is
 *   a real conflict and answers the same 409; the client resolves both the same way, by dropping
 *   the phantom and letting the pull hand it the winner.
 * - **A create retracts a tombstone.** Undo re-creates a deleted row under its original id. A
 *   tombstone still naming that id would tell every other device to delete it again on their next
 *   pull, so it is cleared here. See `clearDeletions`.
 * - **A patch or delete of a missing row is 404**, which the outbox tolerates: asking for a state
 *   the server is already in is not a loss.
 * - **Every filter carries `userId`.** There is no id in any body that could name another user's
 *   row; the session decides whose collection this is.
 */
export interface SyncedCollectionOptions<TCreate, TUpdate, TLean, TDto> {
  coll: SyncCollection;
  model: Model<unknown>;
  createSchema: ZodType<TCreate>;
  updateSchema: ZodType<TUpdate>;
  toDto: (lean: TLean) => TDto;
  /** The i18n key prefix for this collection's errors, e.g. `item` → `item.not_found`. */
  code: string;
  /**
   * Turn validated input into the fields to store. The default stores the input as-is; a collection
   * whose wire shape differs from its storage shape (ISO strings that become Dates on a subdocument
   * Mongoose does not cast for) supplies its own.
   */
  toStored?: (input: TCreate | TUpdate) => Record<string, unknown>;
}

export function syncedCollectionRouter<
  TCreate extends { id?: string; createdAt?: string },
  TUpdate extends object,
  TLean,
  TDto,
>(options: SyncedCollectionOptions<TCreate, TUpdate, TLean, TDto>): Hono<AppEnv> {
  const { coll, model, createSchema, updateSchema, toDto, code } = options;
  const toStored =
    options.toStored ?? ((input: TCreate | TUpdate) => input as Record<string, unknown>);

  return new Hono<AppEnv>()
    .post('/', jsonValidator(createSchema), async (c) => {
      const userId = c.get('userId');
      const { id, createdAt, ...input } = c.req.valid('json') as TCreate;
      const _id = id ? new Types.ObjectId(id) : new Types.ObjectId();
      try {
        const created = await model.create({
          ...toStored(input as TCreate),
          _id,
          userId,
          /* The client's own timestamp, so an offline create keeps its place in time when it is
             replayed a day later. `updatedAt` is left to Mongoose: it is the sync cursor, and it
             must say when the *server* saw the row, not when the phone did. */
          ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
        });
        await clearDeletions(userId, coll, [_id]);
        return c.json(toDto(created.toObject() as TLean), 201);
      } catch (err) {
        if (isDuplicateKey(err)) throw conflict(`${code}.duplicate`);
        throw err;
      }
    })
    .patch('/:id', jsonValidator(updateSchema), async (c) => {
      const userId = c.get('userId');
      const id = objectIdSchema.safeParse(c.req.param('id'));
      if (!id.success) throw notFound(`${code}.not_found`);
      const input = c.req.valid('json') as TUpdate;
      const updated = await model
        .findOneAndUpdate(
          { _id: new Types.ObjectId(id.data), userId },
          { $set: toStored(input) },
          { returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw notFound(`${code}.not_found`);
      return c.json(toDto(updated as TLean));
    })
    .delete('/:id', async (c) => {
      const userId = c.get('userId');
      const id = objectIdSchema.safeParse(c.req.param('id'));
      if (!id.success) throw notFound(`${code}.not_found`);
      const _id = new Types.ObjectId(id.data);
      const deleted = await model.findOneAndDelete({ _id, userId }).lean();
      if (!deleted) throw notFound(`${code}.not_found`);
      await recordDeletions(userId, coll, [_id]);
      return c.body(null, 204);
    });
}
