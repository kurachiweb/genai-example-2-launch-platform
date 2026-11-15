import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/product.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type { ProductLifecycleStore } from '../../../lib/core/product/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ProductMessagePublisher } from './ports.ts';
import {
  OWNED_PRODUCT_BATCH_SIZE,
  PRODUCT_ERASURE_WAIT_LIMIT_MS,
  UserProductErasureHandler,
} from './user-product-erasure-handler.ts';

const USER_ID = '01JC0USER00000000000000001';

const NOW = new Date('2026-11-20T00:00:00.000Z');

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000061',
  userId: USER_ID,
  type: 'purge_due',
  occurredAt: new Date('2026-11-19T19:21:00.000Z'),
});

function productIdOf(index: number): string {
  return `01JD0PROD${String(index).padStart(17, '0')}`;
}

function eventIdOf(index: number): string {
  return `01JD0PEVT${String(index).padStart(17, '0')}`;
}

function before(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function notUsed(): never {
  throw new Error('想定外の呼び出し');
}

type StoreCall =
  | {
      readonly operation: 'listOwnedProductIds';
      readonly userId: string;
      readonly limit: number;
    }
  | {
      readonly operation: 'purgeDueCreatedAt';
      readonly productIds: readonly string[];
    }
  | {
      readonly operation: 'createPurgeDueEvents';
      readonly productIds: readonly string[];
      readonly at: Date;
    };

// 利用者のプロダクトと、物理削除の時期の到来のイベントの作成日時をメモリ上に持つ
class FakeLifecycleStore implements ProductLifecycleStore {
  readonly calls: StoreCall[] = [];

  readonly purgeDue = new Map<string, Date>();

  #eventCount = 0;

  constructor(private readonly ownedProductIds: readonly string[]) {}

  listOwnedProductIds(userId: string, limit: number) {
    this.calls.push({ operation: 'listOwnedProductIds', userId, limit });
    return Promise.resolve(this.ownedProductIds.slice(0, limit));
  }

  purgeDueCreatedAt(productIds: readonly string[]) {
    this.calls.push({ operation: 'purgeDueCreatedAt', productIds });
    return Promise.resolve(
      new Map(
        productIds.flatMap((productId) => {
          const createdAt = this.purgeDue.get(productId);
          return createdAt === undefined ? [] : [[productId, createdAt]];
        }),
      ) as ReadonlyMap<string, Date>,
    );
  }

  createPurgeDueEvents(productIds: readonly string[], at: Date) {
    this.calls.push({ operation: 'createPurgeDueEvents', productIds, at });
    const created = productIds
      .filter((productId) => !this.purgeDue.has(productId))
      .map((productId): ProductLifecycleEvent => {
        this.#eventCount += 1;
        this.purgeDue.set(productId, at);
        return {
          id: eventIdOf(this.#eventCount),
          productId,
          ownerUserId: USER_ID,
          type: 'purge_due',
          occurredAt: at,
        };
      });
    return Promise.resolve(created as readonly ProductLifecycleEvent[]);
  }

  findEvent = notUsed;
  findOldestPending = notUsed;
  completedHandlers = notUsed;
  markHandlerCompleted = notUsed;
  markEventCompleted = notUsed;
  listStalePending = notUsed;
  markRedispatched = notUsed;
  listPurgeCandidates = notUsed;
  countOverduePurges = notUsed;
}

interface Published {
  readonly type: string;
  readonly body: unknown;
}

class FakePublisher implements ProductMessagePublisher {
  readonly published: Published[] = [];

  failuresLeft = 0;

  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
  ): Promise<string> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      return Promise.reject(new Error('キューへ送れない'));
    }
    this.published.push({ type: contract.type, body });
    return Promise.resolve(`message-${String(this.published.length)}`);
  }
}

const clock: Clock = { now: () => NOW };

function createHandler(store: FakeLifecycleStore, publisher: FakePublisher) {
  return new UserProductErasureHandler(store, publisher, clock);
}

describe('UserProductErasureHandler', () => {
  test('1回に扱うプロダクトの上限は50件で、待つ上限は10分である', () => {
    expect(OWNED_PRODUCT_BATCH_SIZE).toBe(50);
    expect(PRODUCT_ERASURE_WAIT_LIMIT_MS).toBe(10 * 60 * 1000);
  });

  test('利用者のプロダクトの行が無ければ、イベントを作らず送らずに完了を返す', async () => {
    const store = new FakeLifecycleStore([]);
    const publisher = new FakePublisher();

    expect(await createHandler(store, publisher).handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(store.calls).toStrictEqual([
      {
        operation: 'listOwnedProductIds',
        userId: USER_ID,
        limit: OWNED_PRODUCT_BATCH_SIZE,
      },
    ]);
    expect(publisher.published).toStrictEqual([]);
  });

  test('物理削除の時期の到来のイベントが無いプロダクトだけにイベントを作って送り、続きを返す', async () => {
    const store = new FakeLifecycleStore([
      productIdOf(1),
      productIdOf(2),
      productIdOf(3),
    ]);
    store.purgeDue.set(productIdOf(2), before(60_000));
    const publisher = new FakePublisher();

    expect(await createHandler(store, publisher).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(store.calls.at(-1)).toStrictEqual({
      operation: 'createPurgeDueEvents',
      productIds: [productIdOf(1), productIdOf(3)],
      at: NOW,
    });
    expect(publisher.published).toStrictEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: eventIdOf(1) },
      },
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: eventIdOf(2) },
      },
    ]);
  });

  test('全てのプロダクトにイベントがあり作成から10分未満なら、作らず送らずに続きを返す', async () => {
    const store = new FakeLifecycleStore([productIdOf(1), productIdOf(2)]);
    store.purgeDue.set(productIdOf(1), before(PRODUCT_ERASURE_WAIT_LIMIT_MS));
    store.purgeDue.set(
      productIdOf(2),
      before(PRODUCT_ERASURE_WAIT_LIMIT_MS - 1),
    );
    const publisher = new FakePublisher();

    expect(await createHandler(store, publisher).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(store.calls.map(({ operation }) => operation)).toStrictEqual([
      'listOwnedProductIds',
      'purgeDueCreatedAt',
    ]);
    expect(publisher.published).toStrictEqual([]);
  });

  test('全てのプロダクトのイベントの作成から10分を過ぎて行が残れば、例外を投げる', async () => {
    const store = new FakeLifecycleStore([productIdOf(1), productIdOf(2)]);
    store.purgeDue.set(
      productIdOf(1),
      before(PRODUCT_ERASURE_WAIT_LIMIT_MS + 60_000),
    );
    store.purgeDue.set(productIdOf(2), before(PRODUCT_ERASURE_WAIT_LIMIT_MS));
    const publisher = new FakePublisher();

    const thrown = await createHandler(store, publisher)
      .handle(EVENT)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('プロダクトの物理削除');
    expect(publisher.published).toStrictEqual([]);
  });

  test('一部のイベントが古くても、この呼び出しで作ったものがあれば続きを返す', async () => {
    const store = new FakeLifecycleStore([productIdOf(1), productIdOf(2)]);
    store.purgeDue.set(
      productIdOf(1),
      before(PRODUCT_ERASURE_WAIT_LIMIT_MS + 60_000),
    );
    const publisher = new FakePublisher();

    expect(await createHandler(store, publisher).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(publisher.published).toHaveLength(1);
  });

  test('利用者のプロダクトは上限の件数ずつ読み、上限を超える分は後の呼び出しで扱う', async () => {
    const owned = Array.from(
      { length: OWNED_PRODUCT_BATCH_SIZE + 1 },
      (_, index) => productIdOf(index + 1),
    );
    const store = new FakeLifecycleStore(owned);
    const publisher = new FakePublisher();

    await createHandler(store, publisher).handle(EVENT);

    expect(store.calls.at(-1)).toMatchObject({
      operation: 'createPurgeDueEvents',
      productIds: owned.slice(0, OWNED_PRODUCT_BATCH_SIZE),
    });
    expect(publisher.published).toHaveLength(OWNED_PRODUCT_BATCH_SIZE);
  });

  test('送信に失敗しても作ったイベントは日次の送り直しに任せ、残りを送って続きを返す', async () => {
    const store = new FakeLifecycleStore([productIdOf(1), productIdOf(2)]);
    const publisher = new FakePublisher();
    publisher.failuresLeft = 1;

    expect(await createHandler(store, publisher).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect([...store.purgeDue.keys()]).toStrictEqual([
      productIdOf(1),
      productIdOf(2),
    ]);
    expect(publisher.published).toStrictEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: eventIdOf(2) },
      },
    ]);
  });

  test('記録の読み取りの例外はそのまま投げる', async () => {
    const store = new FakeLifecycleStore([productIdOf(1)]);
    const failure = new Error('D1の障害');
    store.purgeDueCreatedAt = () => Promise.reject(failure);

    expect(
      await createHandler(store, new FakePublisher())
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
