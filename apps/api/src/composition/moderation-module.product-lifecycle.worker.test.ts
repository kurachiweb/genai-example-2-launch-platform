import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  type Container,
  ContainerModule,
  type ServiceIdentifier,
} from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { ModerationAction } from '../../common-lib/moderation/moderation-actions.ts';
import type { Database } from '../../db/client.ts';
import { productLifecycleEvents } from '../../db/schema/product/product-lifecycle-events.ts';
import { products } from '../../db/schema/product/products.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import type { AuditLogRecorder } from '../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { AppError } from '../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearEngagementTables } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  moderationIdOf,
  OPERATOR_ADMIN_ID,
  readModerationRows,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import {
  after,
  db,
  insertProduct,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type { PendingModerationRecord } from '../application/moderation/pending-moderation-record.ts';
import type { ModerationWriteParticipation } from '../application/moderation/ports.ts';
import type { ProductVisibilityControl } from '../application/product/product-visibility-control.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import {
  createModerationWriteParticipants,
  type ModerationWriteParticipants,
} from '../infrastructure/moderation/moderation-write-participant.ts';
import {
  clearModerationWrites,
  createTestParticipant,
  type ParticipantNotePayload,
  readModerationAuditLogs,
  readParticipantNotes,
  TEST_PARTICIPANT,
  TEST_PARTICIPANT_KIND,
} from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { resolverOf } from './container-resolver.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const OWNER = 1;
const PRODUCT = 1;
const AT = after(60_000);
const REASON = '規約に反する名称のため';
const CONCURRENT_CHANGE = Symbol.for('test.ConcurrentModerationVisibility');

type ProductLifecycleEvent = 'hidden' | 'unhidden';

let participant = createTestParticipant();

// テストの中だけで参加者を登録し、空の初版の登録口の代わりに使う
const testParticipantModule = {
  bindings: new ContainerModule(({ bind, rebind }) => {
    bind(TEST_PARTICIPANT).toDynamicValue(() => participant);
    rebind<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    )
      .toDynamicValue((context) =>
        createModerationWriteParticipants(
          [{ kind: TEST_PARTICIPANT_KIND, participant: TEST_PARTICIPANT }],
          resolverOf(context),
        ),
      )
      .inSingletonScope();
  }),
};

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
    [...MODULES, testParticipantModule],
  );
}

function setPending(
  container: Container,
  action: ModerationAction,
  lifecycleEvent: ProductLifecycleEvent,
  participation?: ModerationWriteParticipation<ParticipantNotePayload>,
): void {
  const audit = container
    .get<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    .prepare({
      operatorAdminId: OPERATOR_ADMIN_ID,
      action,
      targetIds: [productIdOf(PRODUCT)],
      reason: REASON,
      occurredAt: AT,
    });
  container
    .get<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
    .set({
      record: {
        id: moderationIdOf(1),
        action,
        targetId: productIdOf(PRODUCT),
        subjectUserId: userIdOf(OWNER),
        productId: productIdOf(PRODUCT),
        operatorAdminId: OPERATOR_ADMIN_ID,
        reason: REASON,
        noticeStatus: action === 'product.hide' ? 'pending' : 'none',
      },
      lifecycleEvent,
      audit,
      participation,
    });
}

function controlOf(container: Container): ProductVisibilityControl {
  return container.get<ProductVisibilityControl>(
    PRODUCT_TYPES.ProductVisibilityControl,
  );
}

async function readHiddenAt(): Promise<Date | null | undefined> {
  const [row] = await db
    .select({ hiddenAt: products.hiddenAt })
    .from(products)
    .where(eq(products.id, productIdOf(PRODUCT)));
  return row?.hiddenAt;
}

async function readEvents() {
  return db
    .select({
      id: productLifecycleEvents.id,
      type: productLifecycleEvents.type,
    })
    .from(productLifecycleEvents)
    .where(eq(productLifecycleEvents.productId, productIdOf(PRODUCT)));
}

async function expectNothingWritten(): Promise<void> {
  expect(await readEvents()).toStrictEqual([]);
  expect(await readModerationRows()).toStrictEqual([]);
  expect(await readModerationAuditLogs()).toStrictEqual([]);
  expect(await readParticipantNotes()).toStrictEqual([]);
}

const OPERATIONS = [
  {
    name: '非公開化',
    action: 'product.hide',
    lifecycleEvent: 'hidden',
    initial: null,
    changed: AT,
    run: (container: Container) =>
      controlOf(container).hide(productIdOf(PRODUCT), AT),
    noticeStatus: 'pending',
  },
  {
    name: '復元',
    action: 'product.unhide',
    lifecycleEvent: 'unhidden',
    initial: T0,
    changed: null,
    run: (container: Container) =>
      controlOf(container).unhide(productIdOf(PRODUCT), AT),
    noticeStatus: 'none',
  },
] as const;

beforeEach(async () => {
  participant = createTestParticipant();
  await clearModerationWrites();
  await clearEngagementTables();
  await insertUser(OWNER);
});

describe.each(OPERATIONS)(
  '本物のプロダクトの$nameの確定を通した措置の記録',
  ({ action, lifecycleEvent, initial, changed, run, noticeStatus }) => {
    test('保留中の措置がある要求では、記録(イベントのIDと日時)と監査ログを状態の変更と同じ一括の書き込みで確定する', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: initial });
      const container = createContainer();
      setPending(container, action, lifecycleEvent);

      await expect(run(container)).resolves.toBe('changed');

      const events = await readEvents();
      expect(events.map(({ type }) => type)).toStrictEqual([lifecycleEvent]);
      expect(await readHiddenAt()).toStrictEqual(changed);
      expect(await readModerationRows()).toStrictEqual([
        expect.objectContaining({
          id: moderationIdOf(1),
          action,
          targetKind: 'product',
          targetId: productIdOf(PRODUCT),
          subjectUserId: userIdOf(OWNER),
          productId: productIdOf(PRODUCT),
          reason: REASON,
          lifecycleEventId: events[0]?.id,
          occurredAt: AT,
          noticeStatus,
        }),
      ]);
      expect(await readModerationAuditLogs()).toStrictEqual([
        expect.objectContaining({
          action,
          targetKind: 'product',
          reason: REASON,
          targets: [{ targetKind: 'product', targetId: productIdOf(PRODUCT) }],
        }),
      ]);
    });

    test('参加の値があれば、参加者の文も同じ一括の書き込みで確定し、文脈の措置のIDは記録のIDと一致する', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: initial });
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: TEST_PARTICIPANT_KIND,
        payload: { note: '通報の対応' },
      });

      await run(container);

      expect(participant.received).toStrictEqual([
        [
          { note: '通報の対応' },
          {
            actionId: moderationIdOf(1),
            action,
            targetId: productIdOf(PRODUCT),
            occurredAt: AT,
          },
        ],
      ]);
      expect(await readParticipantNotes()).toStrictEqual([
        { reason: '通報の対応', detail: { actionId: moderationIdOf(1) } },
      ]);
    });

    test('参加者の文がNOT NULL制約に違反すると、プロダクトの状態・イベント・記録・監査ログを含む全体を取り消す', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: initial });
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: TEST_PARTICIPANT_KIND,
        payload: { note: '通報の対応', violate: true },
      });

      await expect(run(container)).rejects.toThrow(
        /NOT NULL constraint failed: admin_audit_logs\.action/u,
      );

      expect(await readHiddenAt()).toStrictEqual(initial);
      await expectNothingWritten();
    });

    test('登録の無い種類の参加はAppErrorでない内部のエラーになり、何も書かない', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: initial });
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: 'test-spec.unregistered',
        payload: { note: '通報の対応' },
      });

      const failure = run(container);

      await expect(failure).rejects.toThrow(
        '措置の書き込みの参加者に登録の無い種類です: "test-spec.unregistered"',
      );
      await expect(failure).rejects.not.toBeInstanceOf(AppError);
      expect(await readHiddenAt()).toStrictEqual(initial);
      await expectNothingWritten();
    });

    test('既に同じ状態ならunchangedで、保留中の措置を取り出さず何も残さない', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: changed });
      const container = createContainer();
      setPending(container, action, lifecycleEvent);

      await expect(run(container)).resolves.toBe('unchanged');

      expect(
        container
          .get<PendingModerationRecord>(
            MODERATION_TYPES.PendingModerationRecord,
          )
          .wasTaken(),
      ).toBe(false);
      await expectNothingWritten();
    });

    test('文を集める間に別の操作が同じ状態へ変えると確定は取り消され、記録も監査ログも残さない', async () => {
      await insertProduct(PRODUCT, OWNER, { hiddenAt: initial });
      const container = createContainer();
      setPending(container, action, lifecycleEvent);
      const concurrentChange: ProductLifecycleSyncHandler = {
        statementsFor: async (_event, database) => {
          await database
            .update(products)
            .set({ hiddenAt: changed })
            .where(eq(products.id, productIdOf(PRODUCT)));
          return [];
        },
      };
      const committer = createD1ProductLifecycleCommitter(
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

      await expect(
        committer.commit({
          type: lifecycleEvent,
          productId: productIdOf(PRODUCT),
          at: AT,
        }),
      ).resolves.toStrictEqual({ kind: 'unchanged' });

      await expectNothingWritten();
    });
  },
);
