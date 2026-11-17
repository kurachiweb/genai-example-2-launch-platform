import { describe, expect, test } from 'bun:test';

import {
  refundReasonFor,
  YEAR_REFUND_REASONS,
} from '../../year-tournament/year-entry-rules.ts';
import {
  TOURNAMENT_YEAR_EMAIL_KINDS,
  TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
} from './tournament-year.ts';

const ENTRY_REFUND_FIELDS = {
  nickname: '山田',
  yearLabel: '2027年',
  weekLabel: '2026年第37週(9/7〜9/13)',
  reason: 'capacity_exceeded' as const,
  billingUrl: 'https://client.example/settings/billing',
};

function entryRefundWith(key: string, value: unknown): unknown {
  return { ...ENTRY_REFUND_FIELDS, [key]: value };
}

function acceptsEntryRefund(input: unknown): boolean {
  return TOURNAMENT_YEAR_ENTRY_REFUND_KIND.inputSchema.safeParse(input).success;
}

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_URLS = [
  '',
  'http://client.example/settings/billing',
  'javascript:alert(1)',
  '/settings/billing',
  undefined,
];

describe('メール種別tournament-year.entry-refund', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(TOURNAMENT_YEAR_ENTRY_REFUND_KIND.name).toBe(
      'tournament-year.entry-refund',
    );
    expect(TOURNAMENT_YEAR_ENTRY_REFUND_KIND.category).toBe('transactional');
    expect(Object.isFrozen(TOURNAMENT_YEAR_ENTRY_REFUND_KIND)).toBe(true);
  });

  test('ニックネーム・対象年の表記・週の表記・理由・決済履歴のURLを受け付け、他の項目を取り除く', () => {
    const result = TOURNAMENT_YEAR_ENTRY_REFUND_KIND.inputSchema.safeParse({
      ...ENTRY_REFUND_FIELDS,
      to: 'someone@mail.example',
      amount: 500,
      purchaseId: '01JD0PR0D0000000000000000A',
    });

    expect(result).toEqual({ success: true, data: ENTRY_REFUND_FIELDS });
  });

  test.each([...YEAR_REFUND_REASONS])(
    '返金の理由の一覧の%sを受け付ける',
    (reason) => {
      expect(acceptsEntryRefund(entryRefundWith('reason', reason))).toBe(true);
    },
  );

  test.each([
    ['forfeited', 'deleted'],
    ['forfeited', 'withdrawn'],
    ['excluded', 'hidden_or_suspended'],
    ['excluded', 'over_capacity'],
  ] as const)(
    '枠の状態%sと終了の理由%sから導いた返金の理由を受け付ける',
    (status, closeReason) => {
      expect(
        acceptsEntryRefund(
          entryRefundWith('reason', refundReasonFor(status, closeReason)),
        ),
      ).toBe(true);
    },
  );

  test.each(['over_capacity', 'forfeited', 'rejected_expired', '', undefined])(
    '返金の理由でない値%pを拒否する',
    (reason) => {
      expect(acceptsEntryRefund(entryRefundWith('reason', reason))).toBe(false);
    },
  );

  test('ローカル環境の決済履歴のURLをhttp://localhostで受け付ける', () => {
    expect(
      acceptsEntryRefund(
        entryRefundWith('billingUrl', 'http://localhost:3000/settings/billing'),
      ),
    ).toBe(true);
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first =
      TOURNAMENT_YEAR_ENTRY_REFUND_KIND.inputSchema.parse(ENTRY_REFUND_FIELDS);

    expect(TOURNAMENT_YEAR_ENTRY_REFUND_KIND.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test.each(['nickname', 'yearLabel', 'weekLabel'])(
    '文字列の項目%sが空・欠落・文字列以外なら拒否する',
    (key) => {
      for (const value of INVALID_TEXTS) {
        expect(acceptsEntryRefund(entryRefundWith(key, value))).toBe(false);
      }
    },
  );

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらない決済履歴のURL%pを拒否する',
    (url) => {
      expect(acceptsEntryRefund(entryRefundWith('billingUrl', url))).toBe(
        false,
      );
    },
  );
});

describe('TOURNAMENT_YEAR_EMAIL_KINDS', () => {
  test('返金の知らせの1種を凍結して持つ', () => {
    expect(TOURNAMENT_YEAR_EMAIL_KINDS).toEqual([
      TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
    ]);
    expect(Object.isFrozen(TOURNAMENT_YEAR_EMAIL_KINDS)).toBe(true);
  });
});
