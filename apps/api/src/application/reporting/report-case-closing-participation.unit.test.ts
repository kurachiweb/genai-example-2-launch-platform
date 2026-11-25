import { describe, expect, test } from 'bun:test';

import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { ModerationWriteParticipation } from '../moderation/ports.ts';
import type { MeasureCaseClosing } from './report-case-closing-participation.ts';
import {
  readReportCaseClosingPayload,
  REPORT_CASE_CLOSING_PARTICIPATION,
  toReportCaseClosingParticipation,
} from './report-case-closing-participation.ts';

const CASE_ID = '01JF0000000000000000000001';

const AT = new Date('2027-04-01T03:00:00.000Z');

const AUDIT_FIELDS = Object.freeze({
  id: '01JF0000000000000000000002',
  operatorAdminId: '01JF0000000000000000000003',
  action: 'report.resolve',
  targetKind: 'report',
  targetIds: Object.freeze([CASE_ID]),
  reason: '権利侵害が確認できたため非公開にしました。',
  detail: Object.freeze({
    resolution: 'product.hide',
    mode: 'operation',
    fromStatus: 'in_progress',
  }),
  occurredAt: AT,
});

const AUDIT = AUDIT_FIELDS as unknown as PreparedAuditEntry;

const CLOSING: MeasureCaseClosing = Object.freeze({
  caseId: CASE_ID,
  to: 'resolved',
  resolution: 'product.hide',
  reason: '権利侵害が確認できたため非公開にしました。',
  posterNotice: 'none',
  at: AT,
  audit: AUDIT,
});

const participationOf = (
  payload: unknown,
  kind: string = REPORT_CASE_CLOSING_PARTICIPATION,
): ModerationWriteParticipation => ({ kind, payload });

const withPayload = (
  overrides: Readonly<Record<string, unknown>>,
): ModerationWriteParticipation =>
  participationOf({ ...CLOSING, ...overrides });

const withAudit = (
  overrides: Readonly<Record<string, unknown>>,
): ModerationWriteParticipation =>
  withPayload({ audit: { ...AUDIT_FIELDS, ...overrides } });

describe('REPORT_CASE_CLOSING_PARTICIPATION', () => {
  test('措置の書き込みの参加者の登録の名前の形式<spec名>.<名詞句>である', () => {
    expect(REPORT_CASE_CLOSING_PARTICIPATION).toBe(
      'content-reporting.report-case-closing',
    );
  });
});

describe('toReportCaseClosingParticipation', () => {
  test('本specの種類と完了の値の参加を組み立てる', () => {
    const participation = toReportCaseClosingParticipation(CLOSING);

    expect(participation).toStrictEqual({
      kind: 'content-reporting.report-case-closing',
      payload: {
        caseId: CASE_ID,
        to: 'resolved',
        resolution: 'product.hide',
        reason: '権利侵害が確認できたため非公開にしました。',
        posterNotice: 'none',
        at: AT,
        audit: AUDIT,
      },
    });
    expect(participation.payload.audit).toBe(AUDIT);
  });

  test('値は案件のID・措置・理由・日時・準備した監査ログと固定の完了の値だけで、渡された他の項目(文など)を含めない', () => {
    const closing = {
      ...CLOSING,
      statements: [{ sql: 'UPDATE report_cases SET status = ?' }],
    } as MeasureCaseClosing;

    const { payload } = toReportCaseClosingParticipation(closing);

    expect(Object.keys(payload).toSorted()).toStrictEqual(
      [
        'at',
        'audit',
        'caseId',
        'posterNotice',
        'reason',
        'resolution',
        'to',
      ].toSorted(),
    );
  });

  test('組み立てた参加と値は実行時に書き換えられない', () => {
    const participation = toReportCaseClosingParticipation(CLOSING);

    expect(Object.isFrozen(participation)).toBe(true);
    expect(Object.isFrozen(participation.payload)).toBe(true);
  });

  test.each(['product.hide', 'comment.hide', 'user.suspend'] as const)(
    '措置%sの完了を組み立て、読み取りで同じ値に戻る',
    (resolution) => {
      const participation = toReportCaseClosingParticipation({
        ...CLOSING,
        resolution,
        audit: {
          ...AUDIT_FIELDS,
          detail: { ...AUDIT_FIELDS.detail, resolution },
        } as unknown as PreparedAuditEntry,
      });

      expect(readReportCaseClosingPayload(participation)).toBe(
        participation.payload,
      );
    },
  );
});

describe('readReportCaseClosingPayload', () => {
  test('本specの種類で形の合う値をそのまま返す', () => {
    const participation = participationOf(CLOSING);

    expect(readReportCaseClosingPayload(participation)).toBe(CLOSING);
  });

  test('他の種類の参加では値を返さない', () => {
    expect(
      readReportCaseClosingPayload(
        participationOf(CLOSING, 'other-spec.case-closing'),
      ),
    ).toBeUndefined();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', CASE_ID],
    ['配列', [CLOSING]],
  ])('値が%sなら返さない', (_label, payload) => {
    expect(
      readReportCaseClosingPayload(participationOf(payload)),
    ).toBeUndefined();
  });

  test.each([
    ['措置なしの完了(resolutionがnone)', { resolution: 'none' }],
    [
      '却下(toがrejectedでresolutionがnull)',
      { to: 'rejected', resolution: null },
    ],
    ['却下の状態だけ', { to: 'rejected' }],
    ['措置の無い値', { resolution: null }],
    ['未知の措置', { resolution: 'rating.invalidate' }],
    ['投稿者への通知を依頼する値', { posterNotice: 'pending' }],
    ['投稿者への通知を送らなかった記録の値', { posterNotice: 'skipped' }],
    ['空の案件のID', { caseId: '' }],
    ['数の案件のID', { caseId: 1 }],
    ['空白だけの理由', { reason: '  \n ' }],
    ['501書記素の理由', { reason: 'あ'.repeat(501) }],
    ['理由が無い', { reason: undefined }],
    ['文字列の日時', { at: AT.toISOString() }],
    ['不正な日時', { at: new Date(Number.NaN) }],
    ['監査ログが無い', { audit: undefined }],
    ['監査ログがnull', { audit: null }],
    ['文を含む値', { statements: [] }],
  ])('%sなら返さない', (_label, overrides) => {
    expect(
      readReportCaseClosingPayload(withPayload(overrides)),
    ).toBeUndefined();
  });

  test.each([
    ['却下の操作種別', { action: 'report.reject' }],
    ['対象の種類がカテゴリ', { targetKind: 'category' }],
    ['対象が別の案件', { targetIds: ['01JF0000000000000000000009'] }],
    ['対象が2件', { targetIds: [CASE_ID, '01JF0000000000000000000009'] }],
    ['対象が無い', { targetIds: [] }],
    ['記録のIDが空', { id: '' }],
    ['操作者が無い', { operatorAdminId: undefined }],
    ['詳細が文字列でない値を持つ', { detail: { resolution: 1 } }],
    ['日時が文字列', { occurredAt: AT.toISOString() }],
    ['理由が数', { reason: 1 }],
  ])('監査ログの%sなら返さない', (_label, overrides) => {
    expect(readReportCaseClosingPayload(withAudit(overrides))).toBeUndefined();
  });

  test('監査ログの理由がnullでも形は合う', () => {
    const participation = withAudit({ reason: null });

    expect(readReportCaseClosingPayload(participation)).toBe(
      participation.payload as MeasureCaseClosing,
    );
  });
});
