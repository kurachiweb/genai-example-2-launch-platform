import { describe, expect, test } from 'bun:test';

import { AUDIT_REASON_MAX } from '../admin/admin-input-rules.ts';
import { INQUIRY_STATUSES } from '../inquiry/inquiry-status.ts';
import { MODERATION_ACTIONS } from '../moderation/moderation-actions.ts';
import {
  canChangeStatusManually,
  checkInquiryMessage,
  checkReportAdminReason,
  INQUIRY_MESSAGE_MAX,
  INQUIRY_RESPONSE_DAYS,
  isClosedStatus,
  manualStatusChangeKind,
  measureFor,
  REPORT_ADMIN_REASON_MAX,
  REPORT_CASE_STATUSES,
  REPORT_LIST_EXCERPT_MAX,
  REPORT_LIST_PAGE_SIZE,
  REPORT_NOTICE_EXCERPT_MAX,
  REPORT_RESOLUTIONS,
  type ManualStatusChangeKind,
  type ReportAdminAction,
  type ReportCaseStatus,
} from './report-case-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const surround = (value: string): string => ` \u3000\t${value}\r\n\u3000 `;

const REQUIRED_REASON_ACTIONS: readonly ReportAdminAction[] = [
  'status-close',
  'status-reopen',
  'resolve',
  'reject',
];

const OPTIONAL_REASON_ACTIONS: readonly ReportAdminAction[] = [
  'status-progress',
  'inquire',
];

const ALL_ADMIN_ACTIONS = [
  ...REQUIRED_REASON_ACTIONS,
  ...OPTIONAL_REASON_ACTIONS,
];

const EMPTY_REASONS = [
  ['未指定', undefined],
  ['空文字列', ''],
  ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
] as const;

const WITHIN_ADMIN_LIMIT = [
  ['半角英字', 'a'.repeat(500)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(500)],
  ['結合文字の濁点', COMBINED_KANA.repeat(500)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(500))],
] as const;

const OVER_ADMIN_LIMIT = [
  ['半角英字', 'a'.repeat(501)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(501)],
  ['結合文字の濁点', COMBINED_KANA.repeat(501)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(501))],
] as const;

const STATUS_PAIRS = REPORT_CASE_STATUSES.flatMap((from) =>
  REPORT_CASE_STATUSES.map((to) => [from, to] as const),
);

const EXPECTED_KINDS: Readonly<
  Record<
    ReportCaseStatus,
    Readonly<Record<ReportCaseStatus, ManualStatusChangeKind>>
  >
> = {
  open: {
    open: 'progress',
    in_progress: 'progress',
    resolved: 'close',
    rejected: 'close',
  },
  in_progress: {
    open: 'progress',
    in_progress: 'progress',
    resolved: 'close',
    rejected: 'close',
  },
  resolved: {
    open: 'reopen',
    in_progress: 'reopen',
    resolved: 'close',
    rejected: 'close',
  },
  rejected: {
    open: 'reopen',
    in_progress: 'reopen',
    resolved: 'close',
    rejected: 'close',
  },
};

describe('対応ステータス', () => {
  test('未対応・対応中・対応済・却下の順に4状態を定める', () => {
    expect(REPORT_CASE_STATUSES).toEqual([
      'open',
      'in_progress',
      'resolved',
      'rejected',
    ]);
    expect(Object.isFrozen(REPORT_CASE_STATUSES)).toBe(true);
  });

  test('値と順がinquiry-chatの問い合わせの対応ステータスと一致する', () => {
    expect([...REPORT_CASE_STATUSES]).toEqual([...INQUIRY_STATUSES]);
  });

  test('対応済と却下だけを完了とする', () => {
    expect(REPORT_CASE_STATUSES.filter(isClosedStatus)).toEqual([
      'resolved',
      'rejected',
    ]);
  });
});

describe('手での状態の変更', () => {
  test.each(STATUS_PAIRS)('%sから%sへの変更の可否', (from, to) => {
    expect(canChangeStatusManually(from, to)).toBe(from !== to);
  });

  test.each(STATUS_PAIRS)('%sから%sへの変更の種類', (from, to) => {
    expect(manualStatusChangeKind(from, to)).toBe(EXPECTED_KINDS[from][to]);
  });
});

describe('対象の種類ごとの措置', () => {
  test('プロダクトとコメントは非公開化、ユーザーは停止', () => {
    expect(measureFor('product')).toBe('product.hide');
    expect(measureFor('comment')).toBe('comment.hide');
    expect(measureFor('user')).toBe('user.suspend');
  });

  test('措置の種類は3つの措置と措置なし', () => {
    expect(REPORT_RESOLUTIONS).toEqual([
      'product.hide',
      'comment.hide',
      'user.suspend',
      'none',
    ]);
    expect(Object.isFrozen(REPORT_RESOLUTIONS)).toBe(true);
  });

  test('措置はugc-moderationの措置の種類である', () => {
    for (const resolution of REPORT_RESOLUTIONS) {
      if (resolution !== 'none') {
        expect(MODERATION_ACTIONS).toContain(resolution);
      }
    }
  });
});

describe('管理者の理由', () => {
  test('上限は監査ログの理由の上限と同じ500書記素', () => {
    expect(REPORT_ADMIN_REASON_MAX).toBe(AUDIT_REASON_MAX);
    expect(REPORT_ADMIN_REASON_MAX).toBe(500);
  });

  describe.each(REQUIRED_REASON_ACTIONS)('%sでは必須', (action) => {
    test.each(EMPTY_REASONS)('%sは拒む', (_, reason) => {
      expect(checkReportAdminReason(action, reason)).toBe('required');
    });
  });

  describe.each(OPTIONAL_REASON_ACTIONS)('%sでは任意', (action) => {
    test.each(EMPTY_REASONS)('%sを受け付ける', (_, reason) => {
      expect(checkReportAdminReason(action, reason)).toBe('ok');
    });
  });

  describe.each(ALL_ADMIN_ACTIONS)('%sの上限', (action) => {
    test.each(WITHIN_ADMIN_LIMIT)('%sの上限までは受け付ける', (_, reason) => {
      expect(checkReportAdminReason(action, reason)).toBe('ok');
    });

    test.each(OVER_ADMIN_LIMIT)('%sの上限を超えると拒む', (_, reason) => {
      expect(checkReportAdminReason(action, reason)).toBe('too-long');
    });
  });
});

describe('権利侵害の照会', () => {
  test('内容の上限は1,000書記素で、回答の期限は7日', () => {
    expect(INQUIRY_MESSAGE_MAX).toBe(1000);
    expect(INQUIRY_RESPONSE_DAYS).toBe(7);
  });

  test.each([
    ['空文字列', ''],
    ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
  ] as const)('内容が%sなら空として拒む', (_, message) => {
    expect(checkInquiryMessage(message)).toBe('empty');
  });

  test.each([
    ['半角英字', 'a'.repeat(1000)],
    ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(1000)],
    ['結合文字の濁点', COMBINED_KANA.repeat(1000)],
    ['前後の空白を除いた半角英字', surround('a'.repeat(1000))],
  ] as const)('内容が%sで上限までは受け付ける', (_, message) => {
    expect(checkInquiryMessage(message)).toBe('ok');
  });

  test.each([
    ['半角英字', 'a'.repeat(1001)],
    ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(1001)],
    ['結合文字の濁点', COMBINED_KANA.repeat(1001)],
  ] as const)('内容が%sで上限を超えると拒む', (_, message) => {
    expect(checkInquiryMessage(message)).toBe('too-long');
  });
});

describe('一覧と通知の件数', () => {
  test('一覧は50件、一覧の抜粋は200文字、通知の抜粋は100書記素', () => {
    expect(REPORT_LIST_PAGE_SIZE).toBe(50);
    expect(REPORT_LIST_EXCERPT_MAX).toBe(200);
    expect(REPORT_NOTICE_EXCERPT_MAX).toBe(100);
  });
});
