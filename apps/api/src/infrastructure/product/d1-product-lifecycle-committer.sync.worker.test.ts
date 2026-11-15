import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { products } from '../../../db/schema/product/products.ts';
import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  productIdOf,
  readProductEventsOf,
  readProductHandlerRuns,
  T0,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import type {
  ProductLifecycleSyncHandler,
  ProductLifecycleSyncRegistration,
} from './product-lifecycle-sync-handler.ts';
import {
  captureError,
  causeMessagesOf,
  commandOf,
  createCommitter,
  EXPECTED_EVENT_ID,
  type HandlerCall,
  OWNER,
  prepareLifecycleTables,
  recordingHandler,
  TARGET,
  TOMORROW,
} from './testing/product-lifecycle-committer-fixtures.ts';
import {
  NOW,
  readAllProductRows,
  readProductRow,
} from './testing/product-store-fixtures.ts';

beforeEach(async () => {
  await prepareLifecycleTables();
});

describe('createD1ProductLifecycleCommitterの同期の処理', () => {
  describe('同期の処理', () => {
    const DELETION_HANDLER = Symbol.for('test.DeletionHandler');
    const VISIBILITY_HANDLER = Symbol.for('test.VisibilityHandler');
    const ANY_HANDLER = Symbol.for('test.AnyHandler');

    const REGISTRATIONS: readonly ProductLifecycleSyncRegistration[] = [
      {
        name: 'test-spec.deletion',
        events: ['deleted'],
        handler: DELETION_HANDLER,
      },
      {
        name: 'test-spec.visibility',
        events: ['hidden', 'unhidden'],
        handler: VISIBILITY_HANDLER,
      },
      {
        name: 'test-spec.any',
        events: ['deleted', 'hidden', 'unhidden'],
        handler: ANY_HANDLER,
      },
    ];

    function handlersOf(
      calls: HandlerCall[],
    ): ReadonlyMap<symbol, ProductLifecycleSyncHandler> {
      return new Map([
        [
          DELETION_HANDLER,
          recordingHandler('test-spec.deletion', calls, (event) =>
            event.id.replace('PEVT', 'RUNA'),
          ),
        ],
        [
          VISIBILITY_HANDLER,
          recordingHandler('test-spec.visibility', calls, (event) =>
            event.id.replace('PEVT', 'RUNB'),
          ),
        ],
        [
          ANY_HANDLER,
          recordingHandler('test-spec.any', calls, (event) =>
            event.id.replace('PEVT', 'RUNC'),
          ),
        ],
      ]);
    }

    test('種類に登録された処理だけを登録の順に呼び、返した文を同じ一括の書き込みで確定する', async () => {
      await insertProduct(TARGET, OWNER);
      const calls: HandlerCall[] = [];

      const result = await createCommitter(
        REGISTRATIONS,
        handlersOf(calls),
      ).commit(commandOf('deleted'));

      expect(calls.map(({ name }) => name)).toEqual([
        'test-spec.deletion',
        'test-spec.any',
      ]);
      for (const call of calls) {
        expect({ kind: 'committed', event: call.event }).toEqual(result);
        expect(call.db).toBe(db);
      }
      await expect(readProductHandlerRuns()).resolves.toEqual([
        {
          id: EXPECTED_EVENT_ID.replace('PEVT', 'RUNC'),
          eventId: EXPECTED_EVENT_ID,
          handlerName: 'test-spec.any',
          completedAt: NOW,
        },
        {
          id: EXPECTED_EVENT_ID.replace('PEVT', 'RUNA'),
          eventId: EXPECTED_EVENT_ID,
          handlerName: 'test-spec.deletion',
          completedAt: NOW,
        },
      ]);
    });

    test('非公開化では非公開化に登録された処理を呼ぶ', async () => {
      await insertProduct(TARGET, OWNER);
      const calls: HandlerCall[] = [];

      await createCommitter(REGISTRATIONS, handlersOf(calls)).commit(
        commandOf('hidden'),
      );

      expect(calls.map(({ name }) => name)).toEqual([
        'test-spec.visibility',
        'test-spec.any',
      ]);
      const runs = await readProductHandlerRuns();
      expect(runs.map(({ handlerName }) => handlerName)).toEqual([
        'test-spec.any',
        'test-spec.visibility',
      ]);
    });

    test('既に同じ状態でunchangedのときは処理を呼ばない', async () => {
      await insertProduct(TARGET, OWNER, { hiddenAt: T0 });
      const calls: HandlerCall[] = [];

      await createCommitter(REGISTRATIONS, handlersOf(calls)).commit(
        commandOf('hidden'),
      );

      expect(calls).toEqual([]);
      await expect(readProductHandlerRuns()).resolves.toEqual([]);
    });

    test('状態の条件が成り立たないと、状態・本specの文・処理の文・イベントのすべてを取り消す', async () => {
      await insertProduct(TARGET, OWNER, { version: 2 });
      await insertProductPreviousHandle(1, TARGET, 'old-name');
      const before = await readAllProductRows();
      const calls: HandlerCall[] = [];

      const result = await createCommitter(
        REGISTRATIONS,
        handlersOf(calls),
      ).commit(commandOf('deleted', { expectedVersion: 1 }));

      expect(result).toEqual({ kind: 'rejected', reason: 'conflict' });
      expect(calls).toHaveLength(2);
      await expect(readAllProductRows()).resolves.toEqual(before);
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
      await expect(readProductHandlerRuns()).resolves.toEqual([]);
    });

    test('処理の文を集める間に同じ状態へ変わった非公開化はunchangedを返し、イベントを作らない', async () => {
      await insertProduct(TARGET, OWNER);
      const concurrentHide: ProductLifecycleSyncHandler = {
        statementsFor: async (_event, database) => {
          await database
            .update(products)
            .set({ hiddenAt: T0 })
            .where(eq(products.id, productIdOf(TARGET)));
          return [];
        },
      };

      const result = await createCommitter(
        [
          {
            name: 'test-spec.concurrent-hide',
            events: ['hidden'],
            handler: VISIBILITY_HANDLER,
          },
        ],
        new Map([[VISIBILITY_HANDLER, concurrentHide]]),
      ).commit(commandOf('hidden'));

      expect(result).toEqual({ kind: 'unchanged' });
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        hiddenAt: T0,
        version: 0,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('処理の文が制約に違反したら、分類せずにそのまま投げて全体を取り消す', async () => {
      await insertProduct(TARGET, OWNER, { latestLaunchDate: TOMORROW });
      await insertLaunch(1, TARGET, { launchDate: TOMORROW });
      const before = await readAllProductRows();
      const duplicateRunId = (event: ProductLifecycleEvent) =>
        event.id.replace('PEVT', 'DUPL');
      const calls: HandlerCall[] = [];
      const handlers = new Map([
        [
          VISIBILITY_HANDLER,
          recordingHandler('test-spec.visibility', calls, duplicateRunId),
        ],
        [ANY_HANDLER, recordingHandler('test-spec.any', calls, duplicateRunId)],
      ]);

      const error = await captureError(
        createCommitter(REGISTRATIONS, handlers).commit(commandOf('hidden')),
      );

      expect(causeMessagesOf(error)).toContainEqual(
        expect.stringContaining(
          'UNIQUE constraint failed: product_lifecycle_handler_runs.id',
        ),
      );
      await expect(readAllProductRows()).resolves.toEqual(before);
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
      await expect(readProductHandlerRuns()).resolves.toEqual([]);
    });

    test('処理が文の組み立てで失敗したら、何も書き込まずにそのまま投げる', async () => {
      await insertProduct(TARGET, OWNER);
      const failure = new Error('同期の処理の読み取りの失敗');
      const handlers = new Map<symbol, ProductLifecycleSyncHandler>([
        [DELETION_HANDLER, { statementsFor: () => Promise.reject(failure) }],
        [
          ANY_HANDLER,
          recordingHandler('test-spec.any', [], (event) =>
            event.id.replace('PEVT', 'RUNC'),
          ),
        ],
      ]);

      const error = await captureError(
        createCommitter(REGISTRATIONS, handlers).commit(commandOf('deleted')),
      );

      expect(error).toBe(failure);
      await expect(readProductRow(TARGET)).resolves.toMatchObject({
        deletedAt: null,
        version: 0,
      });
      await expect(readProductEventsOf(TARGET)).resolves.toEqual([]);
    });
  });

  describe('登録の検証', () => {
    const HANDLER = Symbol.for('test.Handler');

    test('名前が<spec名>.<名詞句>の形でない登録を作成時に拒否する', () => {
      expect(() =>
        createCommitter([
          { name: 'deletion', events: ['deleted'], handler: HANDLER },
        ]),
      ).toThrow(LifecycleRegistrationError);
    });

    test('名前が重複した登録を作成時に拒否する', () => {
      expect(() =>
        createCommitter([
          { name: 'test-spec.handler', events: ['deleted'], handler: HANDLER },
          { name: 'test-spec.handler', events: ['hidden'], handler: HANDLER },
        ]),
      ).toThrow(LifecycleRegistrationError);
    });

    test('同じ種類を重ねて挙げた登録を作成時に拒否する', () => {
      expect(() =>
        createCommitter([
          {
            name: 'test-spec.handler',
            events: ['hidden', 'hidden'],
            handler: HANDLER,
          },
        ]),
      ).toThrow(LifecycleRegistrationError);
    });
  });
});
