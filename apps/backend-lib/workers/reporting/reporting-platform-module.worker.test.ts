import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { REPORTING_PLATFORM_TYPES } from '../../core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../core/reporting/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1ReportErasureStore } from './d1-report-erasure-store.ts';
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
    [REPORTING_PLATFORM_MODULE],
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

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した2つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(BOUND_IDENTIFIERS).toHaveLength(2);
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
