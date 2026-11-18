import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import { eventIdOf } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { productEventIdOf } from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1DisplayStopStatements } from '../../../lib/workers/sponsorship/display-stop-statements.ts';
import {
  db,
  displayStopIdOf,
  insertDisplayStops,
  productIdOf,
  readDisplayStopRows,
  userIdOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  AccountDisplayStopSyncHandler,
  ProductDisplayStopSyncHandler,
} from './display-stop-sync-handlers.ts';
import {
  AT,
  commitStatements,
  LATER,
  OWNER,
  readClosureState,
  seedClosureScenario,
  TARGET_PRODUCT,
  untouchedState,
} from './testing/closure-fixtures.ts';

const EARLIER = new Date('2026-11-20T18:00:00.000Z');

function sequentialIds(start = 100): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = displayStopIdOf(next);
      next += 1;
      return id;
    },
  };
}

function productEventOf(
  type: ProductLifecycleEventType,
  occurredAt: Date = AT,
): ProductLifecycleEvent {
  return {
    id: productEventIdOf(1),
    productId: productIdOf(TARGET_PRODUCT),
    ownerUserId: userIdOf(OWNER),
    type,
    occurredAt,
  };
}

function userEventOf(
  type: UserLifecycleEventType,
  occurredAt: Date = AT,
): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(OWNER),
    type,
    occurredAt,
  };
}

function productStatementsOf(
  event: ProductLifecycleEvent,
): Promise<readonly BatchItem<'sqlite'>[]> {
  return new ProductDisplayStopSyncHandler(
    new D1DisplayStopStatements(sequentialIds()),
  ).statementsFor(event, db);
}

function userStatementsOf(
  event: UserLifecycleEvent,
): Promise<readonly BatchItem<'sqlite'>[]> {
  return new AccountDisplayStopSyncHandler(
    new D1DisplayStopStatements(sequentialIds()),
  ).statementsFor(event, db);
}

function intervalOf(
  subject: { readonly kind: 'product' | 'user'; readonly id: string },
  startedAt: Date,
  endedAt: Date | null,
  options: { readonly index?: number; readonly updatedAt?: Date } = {},
) {
  return {
    id: displayStopIdOf(options.index ?? 100),
    subjectKind: subject.kind,
    subjectId: subject.id,
    startedAt,
    endedAt,
    createdAt: startedAt,
    updatedAt: options.updatedAt ?? endedAt ?? startedAt,
  };
}

const PRODUCT_SUBJECT = Object.freeze({
  kind: 'product',
  id: productIdOf(TARGET_PRODUCT),
} as const);

const USER_SUBJECT = Object.freeze({
  kind: 'user',
  id: userIdOf(OWNER),
} as const);

beforeEach(seedClosureScenario);

describe('ProductDisplayStopSyncHandler', () => {
  describe('statementsFor', () => {
    test('非公開化では、プロダクトの区間を始める1文を返し、返すまでは書き込まない', async () => {
      const statements = await productStatementsOf(productEventOf('hidden'));

      expect(statements).toHaveLength(1);
      await expect(readDisplayStopRows()).resolves.toEqual([]);
    });

    test('非公開化の文を実行すると、イベントの確定の時刻で始まるプロダクトの継続中の区間を作り、申込は変えない', async () => {
      await commitStatements(
        await productStatementsOf(productEventOf('hidden')),
      );

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(PRODUCT_SUBJECT, AT, null),
      ]);
      await expect(readClosureState()).resolves.toEqual(untouchedState());
    });

    test('復元の文を実行すると、プロダクトの継続中の区間をイベントの確定の時刻で終える', async () => {
      await commitStatements(
        await productStatementsOf(productEventOf('hidden')),
      );

      const statements = await productStatementsOf(
        productEventOf('unhidden', LATER),
      );
      expect(statements).toHaveLength(1);
      await commitStatements(statements);

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(PRODUCT_SUBJECT, AT, LATER),
      ]);
    });

    test('同じプロダクトの継続中の区間があれば、非公開化の文を実行しても区間を重ねて作らない', async () => {
      await insertDisplayStops([
        {
          index: 1,
          subject: { kind: 'product', productId: productIdOf(TARGET_PRODUCT) },
          startedAt: EARLIER,
        },
      ]);

      await commitStatements(
        await productStatementsOf(productEventOf('hidden')),
      );

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(PRODUCT_SUBJECT, EARLIER, null, { index: 1 }),
      ]);
    });

    test('投稿者の停止の区間は、プロダクトの非公開化と復元で始まりも終わりもしない', async () => {
      await insertDisplayStops([
        {
          index: 1,
          subject: { kind: 'user', userId: userIdOf(OWNER) },
          startedAt: EARLIER,
        },
      ]);

      await commitStatements(
        await productStatementsOf(productEventOf('hidden')),
      );
      await commitStatements(
        await productStatementsOf(productEventOf('unhidden', LATER)),
      );

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(USER_SUBJECT, EARLIER, null, { index: 1 }),
        intervalOf(PRODUCT_SUBJECT, AT, LATER),
      ]);
    });

    test.each(['deleted', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(
          productStatementsOf(productEventOf(type)),
        ).resolves.toEqual([]);
      },
    );
  });
});

describe('AccountDisplayStopSyncHandler', () => {
  describe('statementsFor', () => {
    test('停止では、投稿者の区間を始める1文を返し、返すまでは書き込まない', async () => {
      const statements = await userStatementsOf(userEventOf('suspended'));

      expect(statements).toHaveLength(1);
      await expect(readDisplayStopRows()).resolves.toEqual([]);
    });

    test('停止の文を実行すると、イベントの確定の時刻で始まる投稿者の継続中の区間を作り、申込は変えない', async () => {
      await commitStatements(await userStatementsOf(userEventOf('suspended')));

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(USER_SUBJECT, AT, null),
      ]);
      await expect(readClosureState()).resolves.toEqual(untouchedState());
    });

    test('停止の解除の文を実行すると、投稿者の継続中の区間をイベントの確定の時刻で終える', async () => {
      await commitStatements(await userStatementsOf(userEventOf('suspended')));

      const statements = await userStatementsOf(
        userEventOf('unsuspended', LATER),
      );
      expect(statements).toHaveLength(1);
      await commitStatements(statements);

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(USER_SUBJECT, AT, LATER),
      ]);
    });

    test('同じ投稿者の継続中の区間があれば、停止の文を実行しても区間を重ねて作らない', async () => {
      await insertDisplayStops([
        {
          index: 1,
          subject: { kind: 'user', userId: userIdOf(OWNER) },
          startedAt: EARLIER,
        },
      ]);

      await commitStatements(await userStatementsOf(userEventOf('suspended')));

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(USER_SUBJECT, EARLIER, null, { index: 1 }),
      ]);
    });

    test('プロダクトの非公開化の区間は、投稿者の停止と停止の解除で始まりも終わりもしない', async () => {
      await insertDisplayStops([
        {
          index: 1,
          subject: { kind: 'product', productId: productIdOf(TARGET_PRODUCT) },
          startedAt: EARLIER,
        },
      ]);

      await commitStatements(await userStatementsOf(userEventOf('suspended')));
      await commitStatements(
        await userStatementsOf(userEventOf('unsuspended', LATER)),
      );

      await expect(readDisplayStopRows()).resolves.toEqual([
        intervalOf(PRODUCT_SUBJECT, EARLIER, null, { index: 1 }),
        intervalOf(USER_SUBJECT, AT, LATER),
      ]);
    });

    test.each(['withdrawn', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(userStatementsOf(userEventOf(type))).resolves.toEqual([]);
      },
    );
  });
});
