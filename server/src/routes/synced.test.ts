import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  duplicateKeyError,
  modelDouble,
  objectId,
  oid,
  query,
  resetModels,
} from '../test/mongooseDouble';
import { OTHER_USER_ID, postJson, routeApp, USER_ID } from '../test/routeApp';

/* The factory every synced collection is built from, exercised once with a toy collection.
 *
 * What is under test is the *tolerance rules* — the ones the client's outbox relies on being exactly
 * so. A replayed create must 409 so the queue moves on; a patch to a row that is gone must 404 so
 * the queue treats it as already applied; and a create must retract any tombstone naming its id, or
 * undo would un-undo itself on every other device. None of that is visible from a status code
 * alone, which is why the deletion model is a spy. */

const Widget = modelDouble();
const deletion = vi.hoisted(() => ({
  recordDeletions: vi.fn(async () => {}),
  clearDeletions: vi.fn(async () => {}),
}));

vi.mock('../models/deletion', () => deletion);

const { syncedCollectionRouter } = await import('./synced');

interface LeanWidget {
  _id: Types.ObjectId;
  name: string;
  createdAt?: Date;
}

const router = syncedCollectionRouter({
  coll: 'item',
  model: Widget as unknown as Model<unknown>,
  createSchema: z.object({
    id: z
      .string()
      .regex(/^[0-9a-f]{24}$/)
      .optional(),
    createdAt: z.iso.datetime().optional(),
    name: z.string().min(1),
  }),
  updateSchema: z.object({ name: z.string().min(1).optional() }),
  toDto: (lean: LeanWidget) => ({ id: lean._id.toString(), name: lean.name }),
  code: 'widget',
});

const app = routeApp('/widgets', router);
const asOther = routeApp('/widgets', router, OTHER_USER_ID);

const stored = (fields: Partial<LeanWidget> & { name: string }) => ({
  toObject: () => ({ _id: objectId('w1'), ...fields }),
});

beforeEach(() => {
  resetModels(Widget);
  deletion.recordDeletions.mockClear();
  deletion.clearDeletions.mockClear();
  Widget.create.mockImplementation(
    async (...args: unknown[]) => stored(args[0] as { name: string }) as unknown as unknown[],
  );
});

describe('POST', () => {
  it('stores under the client’s id and the caller’s userId, and answers 201', async () => {
    const res = await postJson(app, '/widgets', { id: oid('w1'), name: 'Tea' });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: oid('w1'), name: 'Tea' });
    expect(Widget.create).toHaveBeenCalledWith(
      expect.objectContaining({ _id: objectId('w1'), userId: USER_ID, name: 'Tea' }),
    );
  });

  it('keeps the client’s createdAt but never its updatedAt', async () => {
    await postJson(app, '/widgets', { name: 'Tea', createdAt: '2026-01-01T00:00:00.000Z' });

    const doc = Widget.create.mock.calls[0][0] as Record<string, unknown>;
    // The client's timestamp, so an offline create keeps its place in time when replayed.
    expect(doc.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    // Mongoose stamps this: it is the sync cursor, and must say when the server saw the row.
    expect('updatedAt' in doc).toBe(false);
  });

  it('retracts a tombstone naming the id, so undo converges on every device', async () => {
    await postJson(app, '/widgets', { id: oid('w1'), name: 'Tea' });

    expect(deletion.clearDeletions).toHaveBeenCalledWith(USER_ID, 'item', [objectId('w1')]);
  });

  it('answers a replayed create with 409, which the outbox treats as already applied', async () => {
    Widget.create.mockRejectedValue(duplicateKeyError('_id'));

    const res = await postJson(app, '/widgets', { id: oid('w1'), name: 'Tea' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'widget.duplicate' });
  });

  it('refuses a body the schema rejects before touching the model', async () => {
    const res = await postJson(app, '/widgets', { name: '' });

    expect(res.status).toBe(400);
    expect(Widget.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id', () => {
  it('updates only the caller’s own row and answers the stored view', async () => {
    Widget.findOneAndUpdate.mockReturnValue(query({ _id: objectId('w1'), name: 'Oolong' }));

    const res = await postJson(app, `/widgets/${oid('w1')}`, { name: 'Oolong' }, 'PATCH');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: oid('w1'), name: 'Oolong' });
    expect(Widget.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: objectId('w1'), userId: USER_ID },
      { $set: { name: 'Oolong' } },
      { returnDocument: 'after' },
    );
  });

  it('is 404 for a row the caller does not own, indistinguishable from one that is gone', async () => {
    const res = await postJson(asOther, `/widgets/${oid('w1')}`, { name: 'Oolong' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'widget.not_found' });
    expect(Widget.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_USER_ID }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('is 404 for an id that is not an ObjectId, without querying', async () => {
    const res = await postJson(app, '/widgets/not-an-id', { name: 'x' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(Widget.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /:id', () => {
  it('deletes the caller’s own row, records a tombstone, and answers 204', async () => {
    Widget.findOneAndDelete.mockReturnValue(query({ _id: objectId('w1'), name: 'Tea' }));

    const res = await app.request(`/widgets/${oid('w1')}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(Widget.findOneAndDelete).toHaveBeenCalledWith({ _id: objectId('w1'), userId: USER_ID });
    expect(deletion.recordDeletions).toHaveBeenCalledWith(USER_ID, 'item', [objectId('w1')]);
  });

  it('is 404 when there is nothing to delete, and records no tombstone', async () => {
    const res = await app.request(`/widgets/${oid('w1')}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    // A tombstone for a row that never existed would tell other devices to delete something
    // they may legitimately hold under that id.
    expect(deletion.recordDeletions).not.toHaveBeenCalled();
  });
});
