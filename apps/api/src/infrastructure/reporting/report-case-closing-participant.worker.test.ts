import { beforeEach, describe, expect, test } from 'vitest';

import { REPORT_RESOLVE_ACTION } from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import { moderationActions } from '../../../db/schema/moderation/moderation-actions.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { D1ModerationRecordStore } from '../../../lib/workers/moderation/d1-moderation-record-store.ts';
import { newRecordOf } from '../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type { ModerationWriteParticipation } from '../../application/moderation/ports.ts';
import {
  REPORT_CASE_CLOSING_PARTICIPATION,
  toReportCaseClosingParticipation,
} from '../../application/reporting/report-case-closing-participation.ts';
import type { ModerationWriteContext } from '../moderation/moderation-write-participant.ts';
import { D1ReportCaseStatements } from './d1-report-case-statements.ts';
import { ReportCaseClosingParticipant } from './report-case-closing-participant.ts';
import {
  AT,
  clearReportCaseWrites,
  db,
  guestReportOf,
  insertReporter,
  measureClosingOf,
  memberReportOf,
  openCaseOf,
  productIdOf,
  readAudits,
  readCase,
  readCaseIds,
  readNoticeStatuses,
  REASON,
  rejectedColumns,
  reportIdOf,
  seed,
} from './testing/report-case-write-fixtures.ts';

const MODERATION_RECORD_ID = '01JF0MACT00000000000000009';

const contextOf = (): ModerationWriteContext => ({
  actionId: MODERATION_RECORD_ID,
  action: 'product.hide',
  targetId: productIdOf(1),
  occurredAt: AT,
});

const participant = (): ReportCaseClosingParticipant =>
  new ReportCaseClosingParticipant(new D1ReportCaseStatements(db));

// 上流が措置の記録の文の後に参加者の文を並べて確定する形を写す
const upstreamStatement = () =>
  new D1ModerationRecordStore(db).insertStatement(
    newRecordOf(1, {
      id: MODERATION_RECORD_ID,
      action: 'product.hide',
      targetId: productIdOf(1),
      productId: productIdOf(1),
      occurredAt: AT,
    }),
  );

async function commitWithUpstream(
  participation: ModerationWriteParticipation,
): Promise<void> {
  const statements = await participant().statementsFor(
    participation,
    contextOf(),
  );
  await db.batch([upstreamStatement(), ...statements]);
}

async function readModerationIds(): Promise<string[]> {
  const rows = await db
    .select({ id: moderationActions.id })
    .from(moderationActions);
  return rows.map(({ id }) => id);
}

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('ReportCaseClosingParticipant', () => {
  test.each<[string, ModerationWriteParticipation]>([
    ['種類の違い', { kind: 'other-spec.note', payload: measureClosingOf(1) }],
    [
      '措置なしの対応済の形',
      {
        kind: REPORT_CASE_CLOSING_PARTICIPATION,
        payload: { ...measureClosingOf(1), resolution: 'none' },
      },
    ],
    [
      '却下の形',
      {
        kind: REPORT_CASE_CLOSING_PARTICIPATION,
        payload: {
          ...measureClosingOf(1),
          to: 'rejected',
          resolution: null,
          posterNotice: 'pending',
        },
      },
    ],
  ])('%sでは内部エラーを投げる', async (_label, participation) => {
    const result = participant().statementsFor(participation, contextOf());

    await expect(result).rejects.toThrow(Error);
    await expect(result).rejects.not.toBeInstanceOf(AppError);
  });

  test('参加の値とcontext.actionIdから措置の記録のIDを入れた完了の文を返し、上流の文と一体で確定する', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, { status: 'in_progress' })],
      [memberReportOf(1, 1, 1), guestReportOf(2, 1, { contactEmail: null })],
    );

    await commitWithUpstream(
      toReportCaseClosingParticipation(measureClosingOf(1)),
    );

    expect(await readCase(1)).toMatchObject({
      status: 'resolved',
      closedAt: AT,
      resolution: 'product.hide',
      resolutionActionId: MODERATION_RECORD_ID,
      closingReason: REASON,
      posterNoticeStatus: 'none',
    });
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'pending',
      [reportIdOf(2)]: 'none',
    });
    expect(await readModerationIds()).toEqual([MODERATION_RECORD_ID]);
    expect((await readAudits()).map(({ action }) => action)).toEqual([
      REPORT_RESOLVE_ACTION.name,
    ]);
  });

  test('案件を読まずに文を返し、物理削除された案件では上流の文ごと何も残さない', async () => {
    const statements = await participant().statementsFor(
      toReportCaseClosingParticipation(measureClosingOf(1)),
      contextOf(),
    );

    await expect(
      db.batch([upstreamStatement(), ...statements]),
    ).rejects.toThrow(/NOT NULL constraint failed: report_cases\.target_kind/u);
    expect(await readCaseIds()).toEqual([]);
    expect(await readModerationIds()).toEqual([]);
    expect(await readAudits()).toEqual([]);
  });

  test('完了済みの案件では文の確定が上流の文ごと何も残さない', async () => {
    await seed(
      [openCaseOf(1, rejectedColumns())],
      [guestReportOf(1, 1, { outcomeNoticeStatus: 'requested' })],
    );
    const before = await readCase(1);

    await expect(
      commitWithUpstream(toReportCaseClosingParticipation(measureClosingOf(1))),
    ).rejects.toThrow(/NOT NULL constraint failed: report_cases\.status/u);
    expect(await readCase(1)).toEqual(before);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
    });
    expect(await readModerationIds()).toEqual([]);
    expect(await readAudits()).toEqual([]);
  });
});
