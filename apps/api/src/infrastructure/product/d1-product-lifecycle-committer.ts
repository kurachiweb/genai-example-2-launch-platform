import { and, eq, gt, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../../db/schema/product/product-lifecycle-events.ts';
import { products } from '../../../db/schema/product/products.ts';
import { createLifecycleRegistry } from '../../../lib/core/identity/user-lifecycle.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { qualifierLockThresholdDate } from '../../../lib/core/product/launch-status.ts';
import type {
  ProductLifecycleEvent,
  SyncProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { previousHandleSoftDelete } from '../../../lib/workers/handles/previous-handle-statements.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import type {
  ProductLifecycleCommand,
  ProductLifecycleCommitResult,
  ProductLifecycleCommitter,
} from '../../application/product/ports.ts';
import type {
  ProductLifecycleSyncHandler,
  ProductLifecycleSyncRegistration,
} from './product-lifecycle-sync-handler.ts';
import { PRODUCT_SAVE_GUARDS as guards } from './product-save-guards.ts';

const PRODUCT_LIFECYCLE_SYNC_HANDLER_LABEL =
  'プロダクトライフサイクルの同期の処理';

// 状態の条件を満たさないイベントの挿入だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: product_lifecycle_events.product_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const GUARD_VIOLATION_PATTERN =
  /NOT NULL constraint failed: product_lifecycle_events\.product_id(?::|$)/u;

type SyncProductLifecycleEvent = ProductLifecycleEvent & {
  readonly type: SyncProductLifecycleEventType;
};

interface ProductStateRow {
  readonly ownerUserId: string;
  readonly deletedAt: Date | null;
  readonly hiddenAt: Date | null;
}

type ProductStateChange = Pick<
  typeof products.$inferInsert,
  'deletedAt' | 'hiddenAt'
>;

const STATE_CHANGE_BY_TYPE = Object.freeze({
  deleted: (at: Date) => ({ deletedAt: at }),
  hidden: (at: Date) => ({ hiddenAt: at }),
  unhidden: () => ({ hiddenAt: null }),
} satisfies Record<
  SyncProductLifecycleEventType,
  (at: Date) => ProductStateChange
>);

function isGuardViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (GUARD_VIOLATION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function isTrue(value: unknown): boolean {
  return Number(value) === 1;
}

function stateCondition(command: ProductLifecycleCommand): SQL | undefined {
  switch (command.type) {
    case 'deleted':
      return and(
        command.expectedVersion === undefined
          ? undefined
          : guards.versionMatches(command.expectedVersion),
        guards.notDeleted(),
        guards.ownerWritable(products.userId),
        guards.qualifierUnlocked(qualifierLockThresholdDate(command.at)),
      );
    case 'hidden':
      return and(guards.notDeleted(), guards.notHidden());
    case 'unhidden':
      return and(guards.notDeleted(), isNotNull(products.hiddenAt));
  }
}

// 確定の前に既に同じ状態なら、イベントを作らずにunchangedとする
function alreadyApplied(
  type: SyncProductLifecycleEventType,
  hiddenAt: Date | null,
): boolean {
  switch (type) {
    case 'deleted':
      return false;
    case 'hidden':
      return hiddenAt !== null;
    case 'unhidden':
      return hiddenAt === null;
  }
}

export function createD1ProductLifecycleCommitter(
  db: Database,
  ids: IdGenerator,
  registrations: readonly ProductLifecycleSyncRegistration[],
  resolve: <T>(identifier: ServiceIdentifier<T>) => T,
): ProductLifecycleCommitter {
  // 同期の処理は順を持たないため、登録の順を順として名前・種類の検証と種類ごとの並びを共有する
  const registry = createLifecycleRegistry(
    registrations.map((registration, order) => ({ ...registration, order })),
    { handlerLabel: PRODUCT_LIFECYCLE_SYNC_HANDLER_LABEL },
  );

  async function readState(
    productId: string,
  ): Promise<ProductStateRow | undefined> {
    const [row] = await db
      .select({
        ownerUserId: products.userId,
        deletedAt: products.deletedAt,
        hiddenAt: products.hiddenAt,
      })
      .from(products)
      .where(eq(products.id, productId));
    return row;
  }

  // 条件を満たさないとプロダクトIDがNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される
  function guardedEventInsert(
    event: SyncProductLifecycleEvent,
    command: ProductLifecycleCommand,
  ) {
    const condition = and(
      eq(products.id, event.productId),
      stateCondition(command),
    );
    return db.insert(productLifecycleEvents).values({
      id: event.id,
      productId: sql`CASE WHEN EXISTS (SELECT 1 FROM ${products} WHERE ${condition}) THEN ${event.productId} ELSE NULL END`,
      ownerUserId: event.ownerUserId,
      type: event.type,
      occurredAt: event.occurredAt,
      lastDispatchedAt: event.occurredAt,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    });
  }

  function stateUpdate(event: SyncProductLifecycleEvent) {
    return db
      .update(products)
      .set({
        ...STATE_CHANGE_BY_TYPE[event.type](event.occurredAt),
        version: sql`${products.version} + 1`,
        updatedAt: event.occurredAt,
      })
      .where(eq(products.id, event.productId));
  }

  function ownStatements(
    event: SyncProductLifecycleEvent,
  ): BatchItem<'sqlite'>[] {
    switch (event.type) {
      case 'deleted':
        return [
          previousHandleSoftDelete(db, PRODUCT_HANDLE_NAMESPACE, {
            ownerId: event.productId,
            now: event.occurredAt,
          }),
        ];
      case 'hidden':
        return [
          db
            .update(productLaunches)
            .set({ cancelledAt: event.occurredAt, updatedAt: event.occurredAt })
            .where(
              and(
                eq(productLaunches.productId, event.productId),
                isNull(productLaunches.outcome),
                isNull(productLaunches.cancelledAt),
                gt(
                  productLaunches.launchDate,
                  toBusinessDateTime(event.occurredAt).date,
                ),
              ),
            ),
        ];
      case 'unhidden':
        return [];
    }
  }

  async function syncStatements(
    event: SyncProductLifecycleEvent,
  ): Promise<BatchItem<'sqlite'>[]> {
    const statements = await Promise.all(
      registry
        .handlersFor(event.type)
        .map(({ handler }) =>
          resolve<ProductLifecycleSyncHandler>(handler).statementsFor(
            event,
            db,
          ),
        ),
    );
    return statements.flat();
  }

  // 取り消された一括の書き込みは何も残さないため、読み直した状態で理由を分ける。分けられなければundefined
  async function classifyAbort(
    command: ProductLifecycleCommand,
  ): Promise<ProductLifecycleCommitResult | undefined> {
    const [row] = await db
      .select({
        deletedAt: products.deletedAt,
        hiddenAt: products.hiddenAt,
        version: products.version,
        ownerWritable:
          sql<boolean>`${guards.ownerWritable(products.userId)}`.mapWith(
            isTrue,
          ),
        unlocked:
          sql<boolean>`${guards.qualifierUnlocked(qualifierLockThresholdDate(command.at))}`.mapWith(
            isTrue,
          ),
      })
      .from(products)
      .where(eq(products.id, command.productId));
    if (row === undefined || row.deletedAt !== null) {
      return { kind: 'rejected', reason: 'not-found' };
    }
    if (command.type !== 'deleted') {
      return alreadyApplied(command.type, row.hiddenAt)
        ? { kind: 'unchanged' }
        : undefined;
    }
    if (!row.ownerWritable) {
      return { kind: 'rejected', reason: 'account-unavailable' };
    }
    if (
      command.expectedVersion !== undefined &&
      row.version !== command.expectedVersion
    ) {
      return { kind: 'rejected', reason: 'conflict' };
    }
    if (!row.unlocked) {
      return { kind: 'rejected', reason: 'locked' };
    }
    return undefined;
  }

  return {
    async commit(command) {
      const state = await readState(command.productId);
      if (state === undefined || state.deletedAt !== null) {
        return { kind: 'rejected', reason: 'not-found' };
      }
      if (alreadyApplied(command.type, state.hiddenAt)) {
        return { kind: 'unchanged' };
      }
      const event: SyncProductLifecycleEvent = {
        id: ids.generate(),
        productId: command.productId,
        ownerUserId: state.ownerUserId,
        type: command.type,
        occurredAt: command.at,
      };
      const handlerStatements = await syncStatements(event);
      try {
        await db.batch([
          guardedEventInsert(event, command),
          stateUpdate(event),
          ...ownStatements(event),
          ...handlerStatements,
        ]);
      } catch (error) {
        if (!isGuardViolation(error)) {
          throw error;
        }
        const result = await classifyAbort(command);
        if (result === undefined) {
          throw error;
        }
        return result;
      }
      return { kind: 'committed', event };
    },
  };
}
