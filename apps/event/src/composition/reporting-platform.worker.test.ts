import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { REPORTING_PLATFORM_TYPES } from '../../lib/core/reporting/identifiers.ts';
import type {
  ReportErasureStore,
  ReportExport,
} from '../../lib/core/reporting/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ReportErasureStore } from '../../lib/workers/reporting/d1-report-erasure-store.ts';
import { D1ReportExport } from '../../lib/workers/reporting/d1-report-export.ts';
import type { ReportErasureStatements } from '../../lib/workers/reporting/report-erasure-statements.ts';
import {
  clearReportingState,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  ownerIdOf,
  readCases,
  readReports,
  reporterIdOf,
  seed,
  T0,
} from '../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

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

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1]);
});

test('モジュールの一覧に通報の削除の共通の束縛を1回だけ含む', () => {
  const names = MODULES.map(({ name }) => name);

  expect(names.filter((name) => name === 'reporting-platform')).toHaveLength(1);
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーの通報の削除の共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから削除のストアと文の契約をD1の実装に解決し、物理削除の時期の削除と参照の消去を行える', async () => {
      const container = createContainer(kind);
      const store = container.get<ReportErasureStore>(
        REPORTING_PLATFORM_TYPES.ReportErasureStore,
      );
      await seed(
        [openProductCaseOf(1), openProductCaseOf(2)],
        [memberReportOf(1, 1, 1), guestReportOf(2, 2)],
      );

      await expect(
        store.eraseByReporter(reporterIdOf(1), 500),
      ).resolves.toEqual({ remaining: false });
      await expect(
        store.detachCasesByOwner(ownerIdOf(2), T0, 500),
      ).resolves.toEqual({ remaining: false });
      await expect(store.eraseEmptyCases(500)).resolves.toBe(1);

      expect(store).toBeInstanceOf(D1ReportErasureStore);
      expect(
        container.get<ReportErasureStatements>(
          REPORTING_PLATFORM_TYPES.ReportErasureStatements,
        ),
      ).toBeInstanceOf(D1ReportErasureStore);
      expect(
        (await readCases()).map((row) => ({
          targetId: row.targetId,
          targetDetachedAt: row.targetDetachedAt,
        })),
      ).toEqual([{ targetId: null, targetDetachedAt: T0 }]);
      expect((await readReports()).map((row) => row.caseId)).toHaveLength(1);
    });

    test('処理単位のコンテナからデータエクスポートの通報の照会をD1の実装に解決し、利用者の通報を対象の参照とともに読める', async () => {
      const container = createContainer(kind);
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
        [memberReportOf(1, 1, 1), memberReportOf(2, 2, 1), guestReportOf(3, 2)],
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
  },
);
