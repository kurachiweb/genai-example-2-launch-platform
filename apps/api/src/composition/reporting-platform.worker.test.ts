import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { REPORTING_PLATFORM_TYPES } from '../../lib/core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../lib/core/reporting/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ReportErasureStore } from '../../lib/workers/reporting/d1-report-erasure-store.ts';
import type { ReportErasureStatements } from '../../lib/workers/reporting/report-erasure-statements.ts';
import {
  clearReportingState,
  db,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  readReports,
  reportIdOf,
  reporterIdOf,
  seed,
  T0,
} from '../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
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
    MODULES,
  );
}

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1]);
});

test('モジュールの一覧に通報の削除の共通の束縛を1回だけ含む', () => {
  const names = MODULES.map(({ name }) => name);

  expect(names.filter((name) => name === 'reporting-platform')).toHaveLength(1);
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーの通報の削除の共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから退会の論理削除の文と削除のストアをD1の実装に解決し、文で論理削除した通報をストアで消せる', async () => {
      const container = createContainer(kind);
      const statements = container.get<ReportErasureStatements>(
        REPORTING_PLATFORM_TYPES.ReportErasureStatements,
      );
      const store = container.get<ReportErasureStore>(
        REPORTING_PLATFORM_TYPES.ReportErasureStore,
      );
      await seed(
        [openProductCaseOf(1)],
        [memberReportOf(1, 1, 1), guestReportOf(2, 1)],
      );

      await db.batch([
        statements.logicalDeleteByReporterStatement(reporterIdOf(1), T0),
      ]);
      const deletedAt = (await readReports()).map((row) => row.deletedAt);
      await expect(
        store.eraseByReporter(reporterIdOf(1), 500),
      ).resolves.toEqual({ remaining: false });

      expect(statements).toBeInstanceOf(D1ReportErasureStore);
      expect(store).toBeInstanceOf(D1ReportErasureStore);
      expect(deletedAt).toEqual([T0, null]);
      expect((await readReports()).map((row) => row.id)).toEqual([
        reportIdOf(2),
      ]);
    });
  },
);
