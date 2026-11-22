import { describe, expect, test } from 'bun:test';

import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import { createModerationWriteParticipants } from '../infrastructure/moderation/moderation-write-participant.ts';
import { MODERATION_WRITE_PARTICIPANTS } from './moderation-write-participants.ts';

describe('措置の書き込みの参加者の登録口', () => {
  test('通報の案件の完了の参加者だけを登録する', () => {
    expect(MODERATION_WRITE_PARTICIPANTS).toStrictEqual([
      {
        kind: 'content-reporting.report-case-closing',
        participant: REPORTING_TYPES.ReportCaseClosingParticipant,
      },
    ]);
  });

  test('登録は<spec名>.<名詞句>の種類で重複せず、解決の部品を組み立てられる', () => {
    expect(() =>
      createModerationWriteParticipants(MODERATION_WRITE_PARTICIPANTS, () => {
        throw new Error('登録の検証だけを確かめるため、参加者は解決しない');
      }),
    ).not.toThrow();
  });
});
