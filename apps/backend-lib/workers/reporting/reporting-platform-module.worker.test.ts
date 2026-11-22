import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { REPORTING_PLATFORM_TYPES } from '../../core/reporting/identifiers.ts';
import type {
  ReportErasureStore,
  ReportExport,
} from '../../core/reporting/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { PRODUCT_PLATFORM_MODULE } from '../product/product-platform-module.ts';
import { PROFILE_PLATFORM_MODULE } from '../profile/profile-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1ReportErasureStore } from './d1-report-erasure-store.ts';
import { D1ReportExport } from './d1-report-export.ts';
import type { ReportErasureStatements } from './report-erasure-statements.ts';
import { REPORTING_PLATFORM_MODULE } from './reporting-platform-module.ts';
import {
  clearReportingState,
  db,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  readCaseIds,
  readReports,
  reporterIdOf,
  seed,
  T0,
} from './testing/report-erasure-fixtures.ts';

const BOUND_IDENTIFIERS = Object.values(REPORTING_PLATFORM_TYPES);

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      REPORTING_PLATFORM_MODULE,
      PROFILE_PLATFORM_MODULE,
      PRODUCT_PLATFORM_MODULE,
    ],
  );
}

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1]);
});

describe('REPORTING_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      REPORTING_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(REPORTING_PLATFORM_MODULE.name).toBe('reporting-platform');
    expect('routes' in REPORTING_PLATFORM_MODULE).toBe(false);
  });

  test('削除のストアと退会の論理削除の文をD1の実装に解決し、処理単位のD1で読み書きする', async () => {
    const container = createContainer();
    const statements = container.get<ReportErasureStatements>(
      REPORTING_PLATFORM_TYPES.ReportErasureStatements,
    );
    const store = container.get<ReportErasureStore>(
      REPORTING_PLATFORM_TYPES.ReportErasureStore,
    );
    await seed([openProductCaseOf(1)], [memberReportOf(1, 1, 1)]);

    await db.batch([
      statements.logicalDeleteByReporterStatement(reporterIdOf(1), T0),
    ]);
    const [deleted] = await readReports();
    await store.eraseByReporter(reporterIdOf(1), 500);
    await store.eraseEmptyCases(500);

    expect(statements).toBeInstanceOf(D1ReportErasureStore);
    expect(store).toBeInstanceOf(D1ReportErasureStore);
    expect(deleted?.deletedAt).toEqual(T0);
    expect(await readReports()).toEqual([]);
    expect(await readCaseIds()).toEqual([]);
  });

  test('データエクスポートの照会をD1の実装に解決し、上流の利用者とプロダクトの束縛で対象の参照を求める', async () => {
    const container = createContainer('queue');
    const reportExport = container.get<ReportExport>(
      REPORTING_PLATFORM_TYPES.ReportExport,
    );
    await seed(
      [
        openProductCaseOf(1, {
          targetKind: 'user',
          targetId: reporterIdOf(1),
          targetOwnerUserId: reporterIdOf(1),
          productId: null,
        }),
        openProductCaseOf(2),
      ],
      [memberReportOf(1, 1, 1), memberReportOf(2, 2, 1)],
    );

    const page = await reportExport.listPage({
      userId: reporterIdOf(1),
      limit: 20,
    });

    expect(reportExport).toBeInstanceOf(D1ReportExport);
    expect(page.records.map((record) => record.targetRef)).toEqual([
      'reporter1',
      null,
    ]);
    expect(page.nextAfter).toBeNull();
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した3つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(BOUND_IDENTIFIERS).toHaveLength(3);
      for (const identifier of BOUND_IDENTIFIERS) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of BOUND_IDENTIFIERS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });
});
