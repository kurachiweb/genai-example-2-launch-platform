import { beforeEach, describe, expect, test } from 'vitest';

import type { UserLifecycleEventType } from '../../../lib/core/identity/user-lifecycle.ts';
import { D1ReportErasureStore } from '../../../lib/workers/reporting/d1-report-erasure-store.ts';
import {
  clearReportingState,
  db,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  readReports,
  reporterIdOf,
  seed,
  T0,
} from '../../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { ReporterWithdrawalSyncHandler } from './reporter-withdrawal-sync-handler.ts';

const AT = new Date(T0.getTime() + 60_000);

const handler = (): ReporterWithdrawalSyncHandler =>
  new ReporterWithdrawalSyncHandler(new D1ReportErasureStore(db));

function eventOf(type: UserLifecycleEventType) {
  return {
    id: '01JE0EVNT00000000000000001',
    userId: reporterIdOf(1),
    type,
    occurredAt: AT,
  } as const;
}

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1]);
  await seed([openProductCaseOf(1)], [memberReportOf(1, 1, 1)]);
});

describe('ReporterWithdrawalSyncHandler', () => {
  test('退会のイベントでは、利用者の通報を退会の日時で論理削除する文を1つ返す', async () => {
    const statements = await handler().statementsFor(eventOf('withdrawn'));
    const [first, ...rest] = statements;
    if (first === undefined) {
      throw new Error('論理削除の文が返されていません');
    }
    await db.batch([first, ...rest]);

    expect(statements).toHaveLength(1);
    expect((await readReports()).map(({ deletedAt }) => deletedAt)).toEqual([
      AT,
    ]);
  });

  test.each(['suspended', 'unsuspended'] as const)(
    '%sのイベントでは文を返さない',
    async (type) => {
      await expect(handler().statementsFor(eventOf(type))).resolves.toEqual([]);
    },
  );
});
