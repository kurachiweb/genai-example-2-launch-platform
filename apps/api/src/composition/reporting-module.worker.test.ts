import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { D1ModerationRecordStore } from '../../lib/workers/moderation/d1-moderation-record-store.ts';
import { newRecordOf } from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import { toReportCaseClosingParticipation } from '../application/reporting/report-case-closing-participation.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import type { ModerationWriteParticipants } from '../infrastructure/moderation/moderation-write-participant.ts';
import { D1ReportCaseStatements } from '../infrastructure/reporting/d1-report-case-statements.ts';
import { D1ReportCaseStore } from '../infrastructure/reporting/d1-report-case-store.ts';
import { D1ReportCaseWriter } from '../infrastructure/reporting/d1-report-case-writer.ts';
import { D1ReportCategoryStore } from '../infrastructure/reporting/d1-report-category-store.ts';
import { D1ReportNoticeStore } from '../infrastructure/reporting/d1-report-notice-store.ts';
import { D1ReportSubmissionStore } from '../infrastructure/reporting/d1-report-submission-store.ts';
import { ReportCaseClosingParticipant } from '../infrastructure/reporting/report-case-closing-participant.ts';
import { ReporterWithdrawalSyncHandler } from '../infrastructure/reporting/reporter-withdrawal-sync-handler.ts';
import {
  AT,
  clearReportCaseWrites,
  db,
  measureClosingOf,
  openCaseOf,
  productIdOf,
  readCase,
  seed,
} from '../infrastructure/reporting/testing/report-case-write-fixtures.ts';
import { MODERATION_MODULE } from './moderation-module.ts';
import { MODERATION_WRITE_PARTICIPANTS } from './moderation-write-participants.ts';
import { MODULES } from './modules.ts';
import { REPORTING_MODULE } from './reporting-module.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['ReportSubmissionStore', D1ReportSubmissionStore],
  ['ReportCaseStore', D1ReportCaseStore],
  ['ReportCategoryStore', D1ReportCategoryStore],
  ['ReportCaseStatements', D1ReportCaseStatements],
  ['ReportCaseWriter', D1ReportCaseWriter],
  ['ReportCaseClosingParticipant', ReportCaseClosingParticipant],
  ['ReportNoticeStore', D1ReportNoticeStore],
  ['ReporterWithdrawalSyncHandler', ReporterWithdrawalSyncHandler],
] as const;

const MODERATION_RECORD_ID = '01JF0MACT00000000000000007';

function createContainer(
  kind: (typeof INVOCATION_KINDS)[number] = 'fetch',
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
    MODULES,
  );
}

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('APIサーバーのモジュールの一覧への通報の束縛の登録', () => {
  test('apiの通報のモジュールを、措置のモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(REPORTING_MODULE.name).toBe('reporting');
    expect(names.filter((name) => name === 'reporting')).toHaveLength(1);
    expect(MODULES.indexOf(REPORTING_MODULE)).toBeGreaterThan(
      MODULES.indexOf(MODERATION_MODULE),
    );
  });

  test('措置の書き込みの参加者の登録口に、案件の完了の参加者を1つ登録する', () => {
    expect(
      MODERATION_WRITE_PARTICIPANTS.filter(
        ({ kind, participant }) =>
          kind === 'content-reporting.report-case-closing' ||
          participant === REPORTING_TYPES.ReportCaseClosingParticipant,
      ),
    ).toStrictEqual([
      {
        kind: 'content-reporting.report-case-closing',
        participant: REPORTING_TYPES.ReportCaseClosingParticipant,
      },
    ]);
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーの通報のストアと同期の処理の束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      '処理単位のコンテナから%sを実装に解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get<unknown>(REPORTING_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);

describe('措置の書き込みの参加者の解決', () => {
  test('措置の参加の部品が案件の完了の参加者を解決し、措置の記録と同じ一括の書き込みで案件を措置による対応済にして措置の記録のIDを残す', async () => {
    await seed([openCaseOf(1)]);
    const participants = createContainer().get<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    );

    const statements = await participants.statementsFor(
      toReportCaseClosingParticipation(measureClosingOf(1)),
      {
        actionId: MODERATION_RECORD_ID,
        action: 'product.hide',
        targetId: productIdOf(1),
        occurredAt: AT,
      },
    );
    await db.batch([
      new D1ModerationRecordStore(db).insertStatement(
        newRecordOf(1, {
          id: MODERATION_RECORD_ID,
          action: 'product.hide',
          targetId: productIdOf(1),
          productId: productIdOf(1),
          occurredAt: AT,
        }),
      ),
      ...statements,
    ]);

    await expect(readCase(1)).resolves.toMatchObject({
      status: 'resolved',
      closedAt: AT,
      resolution: 'product.hide',
      resolutionActionId: MODERATION_RECORD_ID,
    });
  });
});
