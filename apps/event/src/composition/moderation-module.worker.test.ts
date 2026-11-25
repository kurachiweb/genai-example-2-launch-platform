import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type {
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../lib/core/identity/user-lifecycle.ts';
import type { NewModerationRecord } from '../../lib/core/moderation/ports.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ModerationRecordStore } from '../../lib/workers/moderation/d1-moderation-record-store.ts';
import {
  clearModerationRecords,
  db,
  moderatedProductIdOf,
  moderatedUserIdOf,
  newRecordOf,
  readModerationIds,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { AccountRecordErasureHandler } from '../application/moderation/account-record-erasure-handler.ts';
import { EVENT_MODERATION_TYPES } from '../application/moderation/event-moderation-types.ts';
import { ProductRecordErasureHandler } from '../application/moderation/product-record-erasure-handler.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

// 1回の処理の上限(500件)を1件だけ超える記録の数
const RECORDS_OVER_BATCH = 501;

const OTHER_RECORD = 9000;

const SUBJECT_USER = moderatedUserIdOf(1);

const OTHER_USER = moderatedUserIdOf(2);

const PRODUCT = moderatedProductIdOf(1);

const OTHER_PRODUCT = moderatedProductIdOf(2);

const PURGE_DUE_AT = new Date('2026-12-20T03:00:00.000Z');

const USER_PURGE_EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JQ0EVT000000000000000191',
  userId: SUBJECT_USER,
  type: 'purge_due',
  occurredAt: PURGE_DUE_AT,
});

const PRODUCT_PURGE_EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JQ0PEV000000000000000191',
  productId: PRODUCT,
  ownerUserId: OTHER_USER,
  type: 'purge_due',
  occurredAt: PURGE_DUE_AT,
});

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

async function insertRecords(
  records: readonly NewModerationRecord[],
): Promise<void> {
  const statements = new D1ModerationRecordStore(db);
  const [first, ...rest] = records.map((record) =>
    statements.insertStatement(record),
  );
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

function productHideRecordOf(
  index: number,
  productId: string,
): NewModerationRecord {
  return newRecordOf(index, {
    action: 'product.hide',
    targetId: productId,
    subjectUserId: OTHER_USER,
    productId,
  });
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(clearModerationRecords);

describe('イベントサーバーの措置の記録の削除の束縛(EVENT_MODERATION_MODULE)', () => {
  test('モジュールの一覧に共通の束縛の後で1回だけ含まれる', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'event-moderation')).toHaveLength(1);
    expect(names.indexOf('event-moderation')).toBeGreaterThan(
      names.indexOf('moderation-platform'),
    );
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、2つの処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_MODERATION_TYPES.AccountRecordErasureHandler,
        ),
      ).toBeInstanceOf(AccountRecordErasureHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_MODERATION_TYPES.ProductRecordErasureHandler,
        ),
      ).toBeInstanceOf(ProductRecordErasureHandler);
    },
  );
});

describe('利用者の物理削除による措置の記録の削除(ugc-moderation.account-record-erasure)', () => {
  test('利用者に関わる記録を500件ずつ消して続きを返し、消し切ったら完了を返す。他の利用者の記録は残り、同じイベントの呼び直しでも完了を返す', async () => {
    const own = Array.from({ length: RECORDS_OVER_BATCH }, (_, index) =>
      newRecordOf(index + 1, { subjectUserId: SUBJECT_USER }),
    );
    const other = newRecordOf(OTHER_RECORD, { subjectUserId: OTHER_USER });
    await insertRecords([...own, other]);
    const handler = createContainer('queue').get<UserLifecycleAsyncHandler>(
      EVENT_MODERATION_TYPES.AccountRecordErasureHandler,
    );

    await expect(handler.handle(USER_PURGE_EVENT)).resolves.toEqual({
      kind: 'continue',
    });
    expect(await readModerationIds()).toHaveLength(2);
    await expect(handler.handle(USER_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readModerationIds()).toStrictEqual([other.id]);
    await expect(handler.handle(USER_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readModerationIds()).toStrictEqual([other.id]);
  });
});

describe('プロダクトの物理削除による措置の記録の削除(ugc-moderation.product-record-erasure)', () => {
  test('プロダクトに関わる記録を500件ずつ消して続きを返し、消し切ったら完了を返す。他のプロダクトの記録は残り、同じイベントの呼び直しでも完了を返す', async () => {
    const own = Array.from({ length: RECORDS_OVER_BATCH }, (_, index) =>
      productHideRecordOf(index + 1, PRODUCT),
    );
    const other = productHideRecordOf(OTHER_RECORD, OTHER_PRODUCT);
    await insertRecords([...own, other]);
    const handler = createContainer('queue').get<ProductLifecycleAsyncHandler>(
      EVENT_MODERATION_TYPES.ProductRecordErasureHandler,
    );

    await expect(handler.handle(PRODUCT_PURGE_EVENT)).resolves.toEqual({
      kind: 'continue',
    });
    expect(await readModerationIds()).toHaveLength(2);
    await expect(handler.handle(PRODUCT_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readModerationIds()).toStrictEqual([other.id]);
    await expect(handler.handle(PRODUCT_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readModerationIds()).toStrictEqual([other.id]);
  });
});
