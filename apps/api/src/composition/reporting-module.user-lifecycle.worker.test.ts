import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearReportingState,
  daysBefore,
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
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ReporterWithdrawalSyncHandler } from '../infrastructure/reporting/reporter-withdrawal-sync-handler.ts';
import { MODULES } from './modules.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const REPORTER = 1;

const OTHER_REPORTER = 2;

const AT = new Date(T0.getTime() + 60_000);

const LATER = new Date(T0.getTime() + 120_000);

const EARLIER_DELETION = daysBefore(1);

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
    MODULES,
  );
}

async function commit(
  kind: UserStateTransition['kind'],
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
): Promise<void> {
  await createContainer()
    .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .commit({
      kind,
      userId: reporterIdOf(REPORTER),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? AT,
    });
}

async function readDeletion(): Promise<
  Record<string, { deletedAt: Date | null; updatedAt: Date }>
> {
  const rows = await readReports();
  return Object.fromEntries(
    rows.map(({ id, deletedAt, updatedAt }) => [id, { deletedAt, updatedAt }]),
  );
}

const UNTOUCHED = { deletedAt: null, updatedAt: T0 };

const INITIAL = {
  [reportIdOf(1)]: UNTOUCHED,
  [reportIdOf(2)]: UNTOUCHED,
  [reportIdOf(3)]: { deletedAt: EARLIER_DELETION, updatedAt: EARLIER_DELETION },
  [reportIdOf(4)]: UNTOUCHED,
  [reportIdOf(5)]: UNTOUCHED,
};

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([REPORTER, OTHER_REPORTER]);
  await seed(
    [openProductCaseOf(1), openProductCaseOf(2)],
    [
      memberReportOf(1, 1, REPORTER),
      memberReportOf(2, 2, REPORTER),
      memberReportOf(3, 2, REPORTER, {
        deletedAt: EARLIER_DELETION,
        updatedAt: EARLIER_DELETION,
      }),
      memberReportOf(4, 1, OTHER_REPORTER),
      guestReportOf(5, 1),
    ],
  );
});

describe('APIサーバーの通報のモジュールのユーザーの同期の処理の束縛', () => {
  test('退会の同期の処理を、退会だけを対象にユーザーの同期の処理の登録口に1つ登録する', () => {
    expect(
      USER_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'content-reporting.reporter-withdrawal' ||
          handler === REPORTING_TYPES.ReporterWithdrawalSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'content-reporting.reporter-withdrawal',
        events: ['withdrawn'],
        handler: REPORTING_TYPES.ReporterWithdrawalSyncHandler,
      },
    ]);
  });

  test('処理単位のコンテナから、退会の同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        REPORTING_TYPES.ReporterWithdrawalSyncHandler,
      ),
    ).toBeInstanceOf(ReporterWithdrawalSyncHandler);
  });
});

describe('本物の退会の確定を通した通報の論理削除', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者の論理削除していない通報を退会の日時で論理削除し、他の利用者と未ログインの通報は変えない', async () => {
    await commit('withdraw');

    await expect(readDeletion()).resolves.toStrictEqual({
      ...INITIAL,
      [reportIdOf(1)]: { deletedAt: AT, updatedAt: AT },
      [reportIdOf(2)]: { deletedAt: AT, updatedAt: AT },
    });
  });

  test('読み取った版が古い退会は確定せず、通報の論理削除も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readDeletion()).resolves.toStrictEqual(INITIAL);
  });

  test('停止と停止の解除では、通報を論理削除しない', async () => {
    await commit('suspend');
    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readDeletion()).resolves.toStrictEqual(INITIAL);
  });

  test('停止中の利用者の退会でも、論理削除していない通報を論理削除する', async () => {
    await commit('suspend');

    await commit('withdraw', { expectedVersion: 1, at: LATER });

    await expect(readDeletion()).resolves.toStrictEqual({
      ...INITIAL,
      [reportIdOf(1)]: { deletedAt: LATER, updatedAt: LATER },
      [reportIdOf(2)]: { deletedAt: LATER, updatedAt: LATER },
    });
  });
});
