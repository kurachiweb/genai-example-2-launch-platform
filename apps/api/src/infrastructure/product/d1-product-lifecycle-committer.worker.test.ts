import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  isHandleOccupied,
  resolveHandle,
} from '../../../lib/workers/handles/handle-queries.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  launchIdOf,
  productIdOf,
  readProductEventsOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import {
  captureError,
  causeMessagesOf,
  commandOf,
  createCommitter,
  EXPECTED_EVENT_ID,
  OTHER,
  OTHER_OWNER,
  OWNER,
  prepareLifecycleTables,
  TARGET,
  TODAY,
  TOMORROW,
  YESTERDAY,
} from './testing/product-lifecycle-committer-fixtures.ts';
import {
  businessAt,
  NOW,
  readAllProductRows,
  readLaunchRows,
  readPreviousHandles,
  readProductRow,
} from './testing/product-store-fixtures.ts';

beforeEach(async () => {
  await prepareLifecycleTables();
});

describe('createD1ProductLifecycleCommitter', () => {
  describe('削除', () => {
    test('版が一致すれば論理削除して版を1増やし、削除のイベントを記録して返す', async () => {
      await insertProduct(TARGET, OWNER, { version: 3 });

      const result = await createCommitter().commit(
        commandOf('deleted', { expectedVersion: 3 }),
      );

      const event = {
        id: EXPECTED_EVENT_ID,
        productId: productIdOf(TARGET),
        ownerUserId: userIdOf(OWNER),
        type: 'deleted',
        occurredAt: NOW,
      };
      expect(result).toEqual({ kind: 'committed', event });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        deletedAt: NOW,
        hiddenAt: null,
        version: 4,
        updatedAt: NOW,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([
        {
          ...event,
          status: 'pending',
          dispatchCount: 1,
          lastDispatchedAt: NOW,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
    });

    test('旧ハンドルの転送を止め、現在のハンドルは使用中のまま残し、他のプロダクトの旧ハンドルは変えない', async () => {
      await insertProduct(TARGET, OWNER, { handle: 'current-name' });
      await insertProduct(OTHER, OWNER);
      await insertProductPreviousHandle(1, TARGET, 'old-name');
      await insertProductPreviousHandle(2, OTHER, 'other-old-name');

      await createCommitter().commit(commandOf('deleted'));

      await expect(readPreviousHandles()).resolves.toEqual([
        {
          ownerId: productIdOf(TARGET),
          handle: 'old-name',
          deletedAt: NOW,
        },
        {
          ownerId: productIdOf(OTHER),
          handle: 'other-old-name',
          deletedAt: null,
        },
      ]);
      await expect(
        resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'old-name'),
      ).resolves.toEqual({ kind: 'none' });
      await expect(
        isHandleOccupied(db, PRODUCT_HANDLE_NAMESPACE, 'current-name'),
      ).resolves.toBe(true);
    });

    test('読み取った版が古いとconflictで拒否し、何も変えない', async () => {
      await insertProduct(TARGET, OWNER, { version: 2 });
      await insertProductPreviousHandle(1, TARGET, 'old-name');
      const before = await readAllProductRows();

      const result = await createCommitter().commit(
        commandOf('deleted', { expectedVersion: 1 }),
      );

      expect(result).toEqual({ kind: 'rejected', reason: 'conflict' });
      await expect(readAllProductRows()).resolves.toEqual(before);
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('版を指定しない削除は版を条件にせず確定する', async () => {
      await insertProduct(TARGET, OWNER, { version: 7 });

      const result = await createCommitter().commit({
        type: 'deleted',
        productId: productIdOf(TARGET),
        at: NOW,
      });

      expect(result).toMatchObject({ kind: 'committed' });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        deletedAt: NOW,
        version: 8,
      });
    });

    test('論理削除済み・存在しないプロダクトはnot-foundで拒否する', async () => {
      await insertProduct(TARGET, OWNER, { deletedAt: T0 });

      await expect(
        createCommitter().commit(commandOf('deleted')),
      ).resolves.toEqual({ kind: 'rejected', reason: 'not-found' });
      await expect(
        createCommitter().commit(
          commandOf('deleted', { productId: productIdOf(99) }),
        ),
      ).resolves.toEqual({ kind: 'rejected', reason: 'not-found' });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('投稿者が停止中ならaccount-unavailableで拒否し、何も変えない', async () => {
      await insertProduct(TARGET, OWNER);
      await db
        .update(users)
        .set({ status: 'suspended', suspendedAt: T0 })
        .where(eq(users.id, userIdOf(OWNER)));

      const result = await createCommitter().commit(commandOf('deleted'));

      expect(result).toEqual({
        kind: 'rejected',
        reason: 'account-unavailable',
      });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        deletedAt: null,
        version: 0,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('結果の出ていない今日のローンチがあると予選の固定でlockedとして拒否する', async () => {
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TODAY });
      await insertLaunch(1, TARGET, { launchDate: TODAY });

      const result = await createCommitter().commit(commandOf('deleted'));

      expect(result).toEqual({ kind: 'rejected', reason: 'locked' });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        deletedAt: null,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('23:45以降は翌日のローンチも予選の固定でlockedとして拒否する', async () => {
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TOMORROW });
      await insertLaunch(1, TARGET, { launchDate: TOMORROW });
      const committer = createCommitter();

      await expect(
        committer.commit(
          commandOf('deleted', { at: businessAt(TODAY, 23, 45) }),
        ),
      ).resolves.toEqual({ kind: 'rejected', reason: 'locked' });
      await expect(
        committer.commit(
          commandOf('deleted', { at: businessAt(TODAY, 23, 44) }),
        ),
      ).resolves.toMatchObject({ kind: 'committed' });
    });

    test('結果の出た今日のローンチは固定にならず削除できる', async () => {
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TODAY });
      await insertLaunch(1, TARGET, {
        launchDate: TODAY,
        outcome: 'won',
        decidedAt: NOW,
      });

      await expect(
        createCommitter().commit(commandOf('deleted')),
      ).resolves.toMatchObject({ kind: 'committed' });
    });
  });

  describe('非公開化', () => {
    test('非公開化の日時を入れて版を1増やし、明日以降の未確定のローンチだけを取消にして、今日のローンチを残す', async () => {
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TOMORROW });
      await insertLaunch(1, TARGET, {
        launchDate: YESTERDAY,
        outcome: 'lost',
        decidedAt: T0,
      });
      await insertLaunch(2, TARGET, { launchDate: TOMORROW });
      await insertProduct(OTHER, OWNER, { latestLaunchDate: TODAY });
      await insertLaunch(3, OTHER, { launchDate: TODAY });

      const committer = createCommitter();

      const result = await committer.commit(commandOf('hidden'));
      await committer.commit(
        commandOf('hidden', { productId: productIdOf(OTHER) }),
      );

      expect(result).toEqual({
        kind: 'committed',
        event: {
          id: EXPECTED_EVENT_ID,
          productId: productIdOf(TARGET),
          ownerUserId: userIdOf(OWNER),
          type: 'hidden',
          occurredAt: NOW,
        },
      });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        hiddenAt: NOW,
        deletedAt: null,
        version: 1,
        updatedAt: NOW,
      });
      await expect(readLaunchRows(TARGET)).resolves.toEqual([
        {
          id: launchIdOf(1),
          launchDate: YESTERDAY,
          outcome: 'lost',
          cancelledAt: null,
        },
        {
          id: launchIdOf(2),
          launchDate: TOMORROW,
          outcome: null,
          cancelledAt: NOW,
        },
      ]);
      await expect(readLaunchRows(OTHER)).resolves.toEqual([
        {
          id: launchIdOf(3),
          launchDate: TODAY,
          outcome: null,
          cancelledAt: null,
        },
      ]);
      const events = await readProductEventsOf(TARGET);
      expect(events.map(({ type, status }) => ({ type, status }))).toEqual([
        { type: 'hidden', status: 'pending' },
      ]);
    });

    test('23:45以降の非公開化でも翌日の未確定のローンチを取消にする', async () => {
      const at = businessAt(TODAY, 23, 45);
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TOMORROW });
      await insertLaunch(1, TARGET, { launchDate: TOMORROW });

      await expect(
        createCommitter().commit(commandOf('hidden', { at })),
      ).resolves.toMatchObject({ kind: 'committed' });
      await expect(readLaunchRows(TARGET)).resolves.toEqual([
        {
          id: launchIdOf(1),
          launchDate: TOMORROW,
          outcome: null,
          cancelledAt: at,
        },
      ]);
    });

    test('他のプロダクトの明日以降のローンチは取消にしない', async () => {
      await insertProduct(TARGET, OWNER);
      await insertProduct(OTHER, OTHER_OWNER, { latestLaunchDate: TOMORROW });
      await insertLaunch(1, OTHER, { launchDate: TOMORROW });

      await createCommitter().commit(commandOf('hidden'));

      await expect(readLaunchRows(OTHER)).resolves.toEqual([
        {
          id: launchIdOf(1),
          launchDate: TOMORROW,
          outcome: null,
          cancelledAt: null,
        },
      ]);
    });

    test('投稿者が停止中でも非公開化できる', async () => {
      await insertProduct(TARGET, OWNER);
      await db
        .update(users)
        .set({ status: 'suspended', suspendedAt: T0 })
        .where(eq(users.id, userIdOf(OWNER)));

      await expect(
        createCommitter().commit(commandOf('hidden')),
      ).resolves.toMatchObject({ kind: 'committed' });
    });

    test('既に非公開化中ならunchangedを返し、状態を変えずイベントも作らない', async () => {
      await insertProduct(TARGET, OWNER, { hiddenAt: T0, version: 5 });

      const result = await createCommitter().commit(commandOf('hidden'));

      expect(result).toEqual({ kind: 'unchanged' });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        hiddenAt: T0,
        version: 5,
        updatedAt: T0,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('論理削除済み・存在しないプロダクトはnot-foundで拒否する', async () => {
      await insertProduct(TARGET, OWNER, { deletedAt: T0 });

      await expect(
        createCommitter().commit(commandOf('hidden')),
      ).resolves.toEqual({ kind: 'rejected', reason: 'not-found' });
      await expect(
        createCommitter().commit(
          commandOf('hidden', { productId: productIdOf(99) }),
        ),
      ).resolves.toEqual({ kind: 'rejected', reason: 'not-found' });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });
  });

  describe('復元', () => {
    test('非公開化の日時を消して版を1増やし、取消にしたローンチを戻さない', async () => {
      await insertProduct(TARGET, OWNER, {
        hiddenAt: T0,
        version: 1,
        latestLaunchDate: TOMORROW,
      });
      await insertLaunch(1, TARGET, { launchDate: TOMORROW, cancelledAt: T0 });

      const result = await createCommitter().commit(commandOf('unhidden'));

      expect(result).toEqual({
        kind: 'committed',
        event: {
          id: EXPECTED_EVENT_ID,
          productId: productIdOf(TARGET),
          ownerUserId: userIdOf(OWNER),
          type: 'unhidden',
          occurredAt: NOW,
        },
      });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        hiddenAt: null,
        version: 2,
        updatedAt: NOW,
      });
      await expect(readLaunchRows(TARGET)).resolves.toEqual([
        {
          id: launchIdOf(1),
          launchDate: TOMORROW,
          outcome: null,
          cancelledAt: T0,
        },
      ]);
      const events = await readProductEventsOf(TARGET);
      expect(events.map(({ type }) => type)).toEqual(['unhidden']);
    });

    test('非公開化中でなければunchangedを返し、状態を変えずイベントも作らない', async () => {
      await insertProduct(TARGET, OWNER);

      const result = await createCommitter().commit(commandOf('unhidden'));

      expect(result).toEqual({ kind: 'unchanged' });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        version: 0,
        updatedAt: T0,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('論理削除済みのプロダクトはnot-foundで拒否する', async () => {
      await insertProduct(TARGET, OWNER, { deletedAt: T0, hiddenAt: T0 });

      await expect(
        createCommitter().commit(commandOf('unhidden')),
      ).resolves.toEqual({ kind: 'rejected', reason: 'not-found' });
    });
  });

  describe('D1の障害', () => {
    test('読み取りの障害は分類せずにそのまま投げる', async () => {
      const error = await captureError(
        createCommitter(
          [],
          new Map(),
          createDatabase(createFailingD1()),
        ).commit(commandOf('deleted')),
      );

      expect(causeMessagesOf(error)).toContain(FAILING_D1_MESSAGE);
    });
  });
});

describe('D1の状態の条件の仕組み', () => {
  // 条件を満たさなければプロダクトIDをNULLにするイベントの挿入が、どのエラーで一括の書き込みを止めるかを実際のD1で確かめる
  test('条件を満たさないイベントの挿入はNOT NULL制約の違反になり、同じ一括の書き込みの他の文も取り消される', async () => {
    await insertProduct(TARGET, OWNER, { hiddenAt: T0 });
    const productId = productIdOf(TARGET);

    const error = await captureError(
      db.batch([
        db.run(
          sql`INSERT INTO product_lifecycle_events (id, product_id, owner_user_id, type, occurred_at, last_dispatched_at, created_at, updated_at) VALUES (${EXPECTED_EVENT_ID}, CASE WHEN EXISTS (SELECT 1 FROM products WHERE id = ${productId} AND hidden_at IS NULL) THEN ${productId} ELSE NULL END, ${userIdOf(OWNER)}, 'hidden', ${NOW.getTime()}, ${NOW.getTime()}, ${NOW.getTime()}, ${NOW.getTime()})`,
        ),
        db
          .update(products)
          .set({ version: 9 })
          .where(eq(products.id, productId)),
      ]),
    );

    expect(causeMessagesOf(error)).toContainEqual(
      expect.stringContaining(
        'NOT NULL constraint failed: product_lifecycle_events.product_id',
      ),
    );
    await expect(readProductRow(TARGET)).resolves.toMatchObject({
      version: 0,
    });
    await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
  });
});
