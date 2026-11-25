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
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  caseIdOf,
  clearReportingState,
  commentIdOf,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  productIdOf,
  readCases,
  readReportIds,
  reportIdOf,
  reporterIdOf,
  seed,
} from '../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { EVENT_REPORTING_TYPES } from '../application/reporting/event-reporting-types.ts';
import { ProductReportErasureHandler } from '../application/reporting/product-report-erasure-handler.ts';
import { UserReportErasureHandler } from '../application/reporting/user-report-erasure-handler.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const SUBJECT_USER = reporterIdOf(1);

const OTHER_REPORTER = reporterIdOf(2);

const PURGE_DUE_AT = new Date('2026-12-20T03:00:00.000Z');

const USER_PURGE_EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JQ0EVT000000000000000181',
  userId: SUBJECT_USER,
  type: 'purge_due',
  occurredAt: PURGE_DUE_AT,
});

const PRODUCT_PURGE_EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JQ0PEV000000000000000181',
  productId: productIdOf(1),
  ownerUserId: OTHER_REPORTER,
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

async function readCaseTargets() {
  return (await readCases()).map((row) => ({
    id: row.id,
    targetId: row.targetId,
    targetOwnerUserId: row.targetOwnerUserId,
    productId: row.productId,
    detached: row.targetDetachedAt !== null,
    status: row.status,
  }));
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1, 2]);
});

describe('イベントサーバーの通報の物理削除の束縛(EVENT_REPORTING_MODULE)', () => {
  test('モジュールの一覧に共通の束縛の後で1回だけ含まれる', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'event-reporting')).toHaveLength(1);
    expect(names.indexOf('event-reporting')).toBeGreaterThan(
      names.indexOf('reporting-platform'),
    );
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、2つの処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_REPORTING_TYPES.UserReportErasureHandler,
        ),
      ).toBeInstanceOf(UserReportErasureHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_REPORTING_TYPES.ProductReportErasureHandler,
        ),
      ).toBeInstanceOf(ProductReportErasureHandler);
    },
  );
});

describe('ユーザーの物理削除の時期の通報の削除(content-reporting.user-report-erasure)', () => {
  test('申出者の通報を消し、投稿者の案件の対象への参照を消して案件と通報を残し、通報が無くなった案件を消す。他の申出者の通報と案件は残り、同じイベントの呼び直しでも完了を返す', async () => {
    await seed(
      [
        openProductCaseOf(1),
        openProductCaseOf(2, { targetOwnerUserId: SUBJECT_USER }),
        openProductCaseOf(3),
      ],
      [memberReportOf(1, 1, 1), guestReportOf(2, 2), memberReportOf(3, 3, 2)],
    );
    const handler = createContainer('queue').get<UserLifecycleAsyncHandler>(
      EVENT_REPORTING_TYPES.UserReportErasureHandler,
    );

    await expect(handler.handle(USER_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    const expectedCases = [
      {
        id: caseIdOf(2),
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        detached: true,
        status: 'open',
      },
      {
        id: caseIdOf(3),
        targetId: productIdOf(3),
        targetOwnerUserId: openProductCaseOf(3).targetOwnerUserId,
        productId: productIdOf(3),
        detached: false,
        status: 'open',
      },
    ];
    expect(await readCaseTargets()).toEqual(expectedCases);
    expect(await readReportIds()).toEqual([reportIdOf(2), reportIdOf(3)]);

    await expect(handler.handle(USER_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readCaseTargets()).toEqual(expectedCases);
    expect(await readReportIds()).toEqual([reportIdOf(2), reportIdOf(3)]);
  });
});

describe('プロダクトの物理削除の時期の参照の消去(content-reporting.product-report-erasure)', () => {
  test('プロダクトとそのコメントの案件の対象への参照だけを消し、案件と通報を残す。他のプロダクトの案件は残り、同じイベントの呼び直しでも完了を返す', async () => {
    await seed(
      [
        openProductCaseOf(1),
        openProductCaseOf(2, {
          targetKind: 'comment',
          targetId: commentIdOf(2),
          productId: productIdOf(1),
        }),
        openProductCaseOf(3),
      ],
      [memberReportOf(1, 1, 1), guestReportOf(2, 2), memberReportOf(3, 3, 2)],
    );
    const handler = createContainer('queue').get<ProductLifecycleAsyncHandler>(
      EVENT_REPORTING_TYPES.ProductReportErasureHandler,
    );

    await expect(handler.handle(PRODUCT_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    const detachedOf = (index: number) => ({
      id: caseIdOf(index),
      targetId: null,
      targetOwnerUserId: null,
      productId: null,
      detached: true,
      status: 'open',
    });
    const expectedCases = [
      detachedOf(1),
      detachedOf(2),
      {
        id: caseIdOf(3),
        targetId: productIdOf(3),
        targetOwnerUserId: openProductCaseOf(3).targetOwnerUserId,
        productId: productIdOf(3),
        detached: false,
        status: 'open',
      },
    ];
    expect(await readCaseTargets()).toEqual(expectedCases);
    expect(await readReportIds()).toEqual([
      reportIdOf(1),
      reportIdOf(2),
      reportIdOf(3),
    ]);

    await expect(handler.handle(PRODUCT_PURGE_EVENT)).resolves.toEqual({
      kind: 'done',
    });
    expect(await readCaseTargets()).toEqual(expectedCases);
  });
});
