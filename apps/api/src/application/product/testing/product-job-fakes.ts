import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { MessageContract } from '../../../../lib/core/messaging/message-contract.ts';
import type {
  ProductLifecycleStore,
  StoredProductLifecycleEvent,
} from '../../../../lib/core/product/ports.ts';
import type { ProductLifecycleEvent } from '../../../../lib/core/product/product-lifecycle.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import type {
  ProductIncident,
  ProductIncidentReporter,
  ProductMessagePublisher,
} from '../ports.ts';

export const DAILY_CRON = '21 12 * * *';

export function jobContextAt(scheduledTime: Date): ScheduledJobContext {
  return {
    scheduledTime,
    cron: DAILY_CRON,
    business: toBusinessDateTime(scheduledTime),
  };
}

export function ulidOf(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(26 - prefix.length, '0')}`;
}

// 使わないメソッドを呼んだら失敗させ、ジョブが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

export interface PublishedJobMessage {
  readonly type: string;
  readonly body: unknown;
}

export interface JobPublisherFakeOptions {
  // trueを返した本文の送信を失敗させる
  readonly failWhen?: (body: unknown) => boolean;
}

export function createJobPublisherFake(options: JobPublisherFakeOptions = {}) {
  const published: PublishedJobMessage[] = [];
  const attempted: unknown[] = [];
  const publisher: ProductMessagePublisher = {
    publish<TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
    ) {
      attempted.push(body);
      if (options.failWhen?.(body) === true) {
        return Promise.reject(new Error('送信に失敗しました'));
      }
      published.push({ type: contract.type, body });
      return Promise.resolve(`message-${String(published.length)}`);
    },
  };
  return { publisher, published, attempted };
}

export function createIncidentReporterFake() {
  const incidents: ProductIncident[] = [];
  const reporter: ProductIncidentReporter = {
    report(incident) {
      incidents.push(incident);
    },
  };
  return { reporter, incidents };
}

export interface DeletedProduct {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly deletedAt: Date;
  readonly purgeStarted?: boolean;
}

export interface ProductLifecycleStoreFakeOptions {
  readonly deleted?: readonly DeletedProduct[];
  readonly pending?: readonly StoredProductLifecycleEvent[];
  readonly listPurgeCandidatesError?: Error;
  readonly countOverduePurgesError?: Error;
}

export interface ProductLifecycleStoreCalls {
  readonly purgeCandidateQueries: { deletedBefore: Date; limit: number }[];
  readonly purgeDueCreations: { productIds: readonly string[]; at: Date }[];
  readonly overdueQueries: Date[];
  readonly stalePendingQueries: { dispatchedBefore: Date; limit: number }[];
  readonly redispatchMarks: { eventIds: readonly string[]; at: Date }[];
}

// 実装と同じく、期限は「より前」で比べ、物理削除の時期の到来のイベントはプロダクトごとに1件だけ作る
export function createProductLifecycleStoreFake(
  options: ProductLifecycleStoreFakeOptions = {},
) {
  const deleted = (options.deleted ?? []).map((product) => ({
    ...product,
    purgeStarted: product.purgeStarted ?? false,
  }));
  const pending = options.pending ?? [];
  const calls: ProductLifecycleStoreCalls = {
    purgeCandidateQueries: [],
    purgeDueCreations: [],
    overdueQueries: [],
    stalePendingQueries: [],
    redispatchMarks: [],
  };
  let createdCount = 0;

  const store = partialFake<ProductLifecycleStore>({
    listPurgeCandidates(deletedBefore, limit) {
      calls.purgeCandidateQueries.push({ deletedBefore, limit });
      if (options.listPurgeCandidatesError !== undefined) {
        return Promise.reject(options.listPurgeCandidatesError);
      }
      return Promise.resolve(
        deleted
          .filter(
            (product) =>
              !product.purgeStarted &&
              product.deletedAt.getTime() < deletedBefore.getTime(),
          )
          .toSorted(
            (left, right) =>
              left.deletedAt.getTime() - right.deletedAt.getTime(),
          )
          .slice(0, limit)
          .map((product) => product.productId),
      );
    },
    createPurgeDueEvents(productIds, at) {
      calls.purgeDueCreations.push({ productIds, at });
      const created: ProductLifecycleEvent[] = [];
      for (const productId of productIds) {
        const product = deleted.find(
          (candidate) => candidate.productId === productId,
        );
        if (product === undefined || product.purgeStarted) {
          continue;
        }
        product.purgeStarted = true;
        createdCount += 1;
        created.push({
          id: ulidOf('01JD0PURGE', createdCount),
          productId,
          ownerUserId: product.ownerUserId,
          type: 'purge_due',
          occurredAt: at,
        });
      }
      return Promise.resolve(created);
    },
    countOverduePurges(deletedBefore) {
      calls.overdueQueries.push(deletedBefore);
      if (options.countOverduePurgesError !== undefined) {
        return Promise.reject(options.countOverduePurgesError);
      }
      return Promise.resolve(
        deleted.filter(
          (product) => product.deletedAt.getTime() < deletedBefore.getTime(),
        ).length,
      );
    },
    listStalePending(dispatchedBefore, limit) {
      calls.stalePendingQueries.push({ dispatchedBefore, limit });
      return Promise.resolve(
        pending
          .filter(
            (event) =>
              event.status === 'pending' &&
              event.lastDispatchedAt.getTime() < dispatchedBefore.getTime(),
          )
          .toSorted(
            (left, right) =>
              left.lastDispatchedAt.getTime() -
              right.lastDispatchedAt.getTime(),
          )
          .slice(0, limit),
      );
    },
    markRedispatched(eventIds, at) {
      calls.redispatchMarks.push({ eventIds, at });
      return Promise.resolve();
    },
  });
  return { store, calls, deleted };
}

export function deletedProductOf(
  index: number,
  deletedAt: Date,
  overrides: Partial<DeletedProduct> = {},
): DeletedProduct {
  return {
    productId: ulidOf('01JD0PROD', index),
    ownerUserId: ulidOf('01JC0USER', index),
    deletedAt,
    ...overrides,
  };
}

export function pendingProductEventOf(
  index: number,
  overrides: Partial<StoredProductLifecycleEvent> = {},
): StoredProductLifecycleEvent {
  return {
    id: ulidOf('01JD0EVENT', index),
    productId: ulidOf('01JD0PROD', index),
    ownerUserId: ulidOf('01JC0USER', index),
    type: 'deleted',
    occurredAt: new Date('2026-11-01T00:00:00.000Z'),
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createJobLogCapture() {
  const records: LogRecord[] = [];
  return {
    records,
    start(): void {
      records.length = 0;
      configureSync({
        reset: true,
        sinks: { memory: (record) => records.push(record) },
        loggers: [
          { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
          { category: ['api'], lowestLevel: 'debug', sinks: ['memory'] },
        ],
      });
    },
    stop(): void {
      resetSync();
    },
    messages(): string[] {
      return records.map((record) => record.rawMessage as string);
    },
    find(message: string): LogRecord | undefined {
      return records.find((record) => record.rawMessage === message);
    },
  };
}
