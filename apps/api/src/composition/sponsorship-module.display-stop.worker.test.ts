import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container, ServiceIdentifier } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../db/client.ts';
import { products } from '../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { SyncProductLifecycleEventType } from '../../lib/core/product/product-lifecycle.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import type {
  DisplayStopStore,
  DisplayStopSubject,
} from '../../lib/core/sponsorship/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  insertDisplayStops,
  productIdOf,
  readDisplayStopRows,
  T0,
  userIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import type { ProductLifecycleCommitter } from '../application/product/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import {
  AccountDisplayStopSyncHandler,
  ProductDisplayStopSyncHandler,
} from '../infrastructure/sponsorship/display-stop-sync-handlers.ts';
import {
  AT,
  LATER,
  OWNER,
  readClosureState,
  seedClosureScenario,
  TARGET_PRODUCT,
  untouchedState,
} from '../infrastructure/sponsorship/testing/closure-fixtures.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const EARLIER = new Date('2026-11-20T18:00:00.000Z');

const CONCURRENT_CHANGE = Symbol.for('test.ConcurrentVisibilityChange');

const PRODUCT: DisplayStopSubject = {
  kind: 'product',
  productId: productIdOf(TARGET_PRODUCT),
};

const USER: DisplayStopSubject = { kind: 'user', userId: userIdOf(OWNER) };

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function commitProduct(
  type: SyncProductLifecycleEventType,
  at: Date = AT,
  committer: ProductLifecycleCommitter = createContainer().get<ProductLifecycleCommitter>(
    PRODUCT_TYPES.ProductLifecycleCommitter,
  ),
) {
  return committer.commit({
    type,
    productId: productIdOf(TARGET_PRODUCT),
    at,
  });
}

function commitUser(
  kind: UserStateTransition['kind'],
  options: { readonly expectedVersion: number; readonly at?: Date },
) {
  return createContainer()
    .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .commit({
      kind,
      userId: userIdOf(OWNER),
      expectedVersion: options.expectedVersion,
      at: options.at ?? AT,
    });
}

// 登録口の処理の文を集める間に、別の確定が同じプロダクトの非公開化の状態を先に変える
function committerWithConcurrentChange(
  hiddenAt: Date | null,
): ProductLifecycleCommitter {
  const container = createContainer();
  const concurrentChange: ProductLifecycleSyncHandler = {
    statementsFor: async (_event, database) => {
      await database
        .update(products)
        .set({ hiddenAt })
        .where(eq(products.id, productIdOf(TARGET_PRODUCT)));
      return [];
    },
  };
  return createD1ProductLifecycleCommitter(
    container.get<Database>(PLATFORM_TYPES.Database),
    container.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    [
      ...PRODUCT_LIFECYCLE_SYNC_HANDLERS,
      {
        name: 'test-spec.concurrent-visibility-change',
        events: ['hidden', 'unhidden'],
        handler: CONCURRENT_CHANGE,
      },
    ],
    <T>(identifier: ServiceIdentifier<T>): T =>
      identifier === CONCURRENT_CHANGE
        ? (concurrentChange as T)
        : container.get<T>(identifier),
  );
}

interface IntervalState {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

async function readIntervals(): Promise<IntervalState[]> {
  const rows = await readDisplayStopRows();
  return rows.map(({ subjectKind, subjectId, startedAt, endedAt }) => ({
    subjectKind,
    subjectId,
    startedAt,
    endedAt,
  }));
}

function intervalOf(
  subject: DisplayStopSubject,
  startedAt: Date,
  endedAt: Date | null,
): IntervalState {
  return subject.kind === 'product'
    ? {
        subjectKind: 'product',
        subjectId: subject.productId,
        startedAt,
        endedAt,
      }
    : { subjectKind: 'user', subjectId: subject.userId, startedAt, endedAt };
}

beforeEach(seedClosureScenario);

describe('APIサーバーのスポンサー広告のモジュールの表示停止の同期の処理の束縛', () => {
  test('プロダクトの表示停止の同期の処理を、非公開化と復元を対象にプロダクトの同期の処理の登録口に1つ登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'sponsorship.product-display-stop' ||
          handler === SPONSORSHIP_TYPES.ProductDisplayStopSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.product-display-stop',
        events: ['hidden', 'unhidden'],
        handler: SPONSORSHIP_TYPES.ProductDisplayStopSyncHandler,
      },
    ]);
  });

  test('投稿者の表示停止の同期の処理を、停止と停止の解除を対象にユーザーの同期の処理の登録口に1つ登録する', () => {
    expect(
      USER_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'sponsorship.account-display-stop' ||
          handler === SPONSORSHIP_TYPES.AccountDisplayStopSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.account-display-stop',
        events: ['suspended', 'unsuspended'],
        handler: SPONSORSHIP_TYPES.AccountDisplayStopSyncHandler,
      },
    ]);
  });

  test('処理単位のコンテナから、2つの表示停止の同期の処理を実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductLifecycleSyncHandler>(
        SPONSORSHIP_TYPES.ProductDisplayStopSyncHandler,
      ),
    ).toBeInstanceOf(ProductDisplayStopSyncHandler);
    expect(
      container.get<UserLifecycleSyncHandler>(
        SPONSORSHIP_TYPES.AccountDisplayStopSyncHandler,
      ),
    ).toBeInstanceOf(AccountDisplayStopSyncHandler);
  });
});

describe('プロダクトの表示停止の同期の処理の登録', () => {
  test('非公開化の確定と同じ一括の書き込みでプロダクトの区間を確定の時刻で始め、復元の確定で終え、申込は変えない', async () => {
    await expect(commitProduct('hidden')).resolves.toMatchObject({
      kind: 'committed',
    });
    await expect(readIntervals()).resolves.toEqual([
      intervalOf(PRODUCT, AT, null),
    ]);

    await expect(commitProduct('unhidden', LATER)).resolves.toMatchObject({
      kind: 'committed',
    });
    await expect(readIntervals()).resolves.toEqual([
      intervalOf(PRODUCT, AT, LATER),
    ]);
    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });

  test('記録した区間は、掲載の終わりの精算が数える表示停止の区間として照会できる', async () => {
    await commitProduct('hidden');
    await commitProduct('unhidden', LATER);

    await expect(
      createContainer()
        .get<DisplayStopStore>(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStore)
        .listOverlapping({
          productId: productIdOf(TARGET_PRODUCT),
          userId: userIdOf(OWNER),
          from: EARLIER,
          to: new Date(LATER.getTime() + 1),
        }),
    ).resolves.toEqual([{ startedAt: AT, endedAt: LATER }]);
  });

  test('文を集める間に別の確定が先に非公開化したら、非公開化は確定せず、区間も作らない', async () => {
    await expect(
      commitProduct('hidden', AT, committerWithConcurrentChange(T0)),
    ).resolves.toEqual({ kind: 'unchanged' });

    await expect(readIntervals()).resolves.toEqual([]);
  });

  test('文を集める間に別の確定が先に復元したら、復元は確定せず、区間も終えない', async () => {
    await commitProduct('hidden');

    await expect(
      commitProduct('unhidden', LATER, committerWithConcurrentChange(null)),
    ).resolves.toEqual({ kind: 'unchanged' });

    await expect(readIntervals()).resolves.toEqual([
      intervalOf(PRODUCT, AT, null),
    ]);
  });

  test('同じプロダクトの継続中の区間があれば、非公開化を確定しても区間を重ねて作らない', async () => {
    await insertDisplayStops([
      { index: 1, subject: PRODUCT, startedAt: EARLIER },
    ]);

    await expect(commitProduct('hidden')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readIntervals()).resolves.toEqual([
      intervalOf(PRODUCT, EARLIER, null),
    ]);
  });

  test('削除では区間を記録しない', async () => {
    await commitProduct('deleted');

    await expect(readIntervals()).resolves.toEqual([]);
  });
});

describe('投稿者の表示停止の同期の処理の登録', () => {
  test('停止の確定と同じ一括の書き込みで投稿者の区間を確定の時刻で始め、停止の解除の確定で終え、申込は変えない', async () => {
    await commitUser('suspend', { expectedVersion: 0 });
    await expect(readIntervals()).resolves.toEqual([
      intervalOf(USER, AT, null),
    ]);

    await commitUser('unsuspend', { expectedVersion: 1, at: LATER });
    await expect(readIntervals()).resolves.toEqual([
      intervalOf(USER, AT, LATER),
    ]);
    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });

  test('読み取った版が古い停止は確定せず、区間も作らない', async () => {
    await expect(
      commitUser('suspend', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readIntervals()).resolves.toEqual([]);
  });

  test('読み取った版が古い停止の解除は確定せず、区間も終えない', async () => {
    await commitUser('suspend', { expectedVersion: 0 });

    await expect(
      commitUser('unsuspend', { expectedVersion: 0, at: LATER }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readIntervals()).resolves.toEqual([
      intervalOf(USER, AT, null),
    ]);
  });

  test('同じ投稿者の継続中の区間があれば、停止を確定しても区間を重ねて作らない', async () => {
    await insertDisplayStops([{ index: 1, subject: USER, startedAt: EARLIER }]);

    await commitUser('suspend', { expectedVersion: 0 });

    await expect(readIntervals()).resolves.toEqual([
      intervalOf(USER, EARLIER, null),
    ]);
  });

  test('退会では区間を記録しない', async () => {
    await commitUser('withdraw', { expectedVersion: 0 });

    await expect(readIntervals()).resolves.toEqual([]);
  });
});
