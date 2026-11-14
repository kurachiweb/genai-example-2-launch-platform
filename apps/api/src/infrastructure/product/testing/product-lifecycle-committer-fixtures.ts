import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../../db/client.ts';
import { productLifecycleHandlerRuns } from '../../../../db/schema/product/product-lifecycle-handler-runs.ts';
import type { ProductLifecycleEvent } from '../../../../lib/core/product/product-lifecycle.ts';
import {
  clearProductTables,
  createSequentialProductEventIds,
  db,
  insertUser,
  productEventIdOf,
  productIdOf,
  T0,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';
import type {
  ProductLifecycleCommand,
  ProductLifecycleCommitter,
} from '../../../application/product/ports.ts';
import { createD1ProductLifecycleCommitter } from '../d1-product-lifecycle-committer.ts';
import type {
  ProductLifecycleSyncHandler,
  ProductLifecycleSyncRegistration,
} from '../product-lifecycle-sync-handler.ts';
import { NOW } from './product-store-fixtures.ts';

export const OWNER = 1;

export const OTHER_OWNER = 2;

export const TARGET = 1;

export const OTHER = 2;

export const FIRST_EVENT_INDEX = 1000;

export const EXPECTED_EVENT_ID = productEventIdOf(FIRST_EVENT_INDEX);

// NOWの業務日付は2026-11-10
export const TODAY = '2026-11-10';

export const YESTERDAY = '2026-11-09';

export const TOMORROW = '2026-11-11';

export interface HandlerCall {
  readonly name: string;
  readonly event: ProductLifecycleEvent;
  readonly db: Database;
}

// 呼び出しを記録し、イベントの記録への外部キーを持つ完了の記録を1行加える文を返す偽の同期の処理
export function recordingHandler(
  name: string,
  calls: HandlerCall[],
  runId: (event: ProductLifecycleEvent) => string,
): ProductLifecycleSyncHandler {
  return {
    statementsFor: (event, database) => {
      calls.push({ name, event, db: database });
      const statements: BatchItem<'sqlite'>[] = [
        database.insert(productLifecycleHandlerRuns).values({
          id: runId(event),
          eventId: event.id,
          handlerName: name,
          completedAt: event.occurredAt,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        }),
      ];
      return Promise.resolve(statements);
    },
  };
}

export function resolverOf(
  handlers: ReadonlyMap<symbol, ProductLifecycleSyncHandler>,
): <T>(identifier: ServiceIdentifier<T>) => T {
  return <T>(identifier: ServiceIdentifier<T>): T => {
    const handler = handlers.get(identifier as symbol);
    if (handler === undefined) {
      throw new Error(`未登録の識別子: ${String(identifier)}`);
    }
    return handler as T;
  };
}

export function createCommitter(
  registrations: readonly ProductLifecycleSyncRegistration[] = [],
  handlers: ReadonlyMap<symbol, ProductLifecycleSyncHandler> = new Map(),
  database: Database = db,
): ProductLifecycleCommitter {
  return createD1ProductLifecycleCommitter(
    database,
    createSequentialProductEventIds(FIRST_EVENT_INDEX),
    registrations,
    resolverOf(handlers),
  );
}

export function commandOf(
  type: ProductLifecycleCommand['type'],
  overrides: Partial<ProductLifecycleCommand> = {},
): ProductLifecycleCommand {
  return {
    type,
    productId: productIdOf(TARGET),
    ...(type === 'deleted' ? { expectedVersion: 0 } : {}),
    at: NOW,
    ...overrides,
  };
}

export function causeMessagesOf(error: unknown): string[] {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages;
}

export async function captureError(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗を期待しましたが成功しました');
}

export async function prepareLifecycleTables(): Promise<void> {
  await clearProductTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(OTHER_OWNER, { emailVerifiedAt: T0 });
}
