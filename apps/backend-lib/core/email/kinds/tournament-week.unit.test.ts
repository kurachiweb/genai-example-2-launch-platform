import { describe, expect, test } from 'bun:test';

import { refundReasonFor } from '../../week-tournament/week-entry-rules.ts';
import {
  TOURNAMENT_WEEK_EMAIL_KINDS,
  TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
} from './tournament-week.ts';

const ENTRY_REFUND_FIELDS = {
  nickname: '山田',
  weekLabel: '2026年第37週(9/7〜9/13)',
  launchDate: '2026-09-13',
  reason: 'entitlement_lost' as const,
  billingUrl: 'https://client.example/settings/billing',
};

function entryRefundWith(key: string, value: unknown): unknown {
  return { ...ENTRY_REFUND_FIELDS, [key]: value };
}

function acceptsEntryRefund(input: unknown): boolean {
  return TOURNAMENT_WEEK_ENTRY_REFUND_KIND.inputSchema.safeParse(input).success;
}

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_DATES = [
  '',
  '2026-9-13',
  '2026/09/13',
  '2026-02-30',
  '2026-09-13T00:00:00.000Z',
  new Date('2026-09-13T00:00:00.000Z'),
  undefined,
  null,
];

const INVALID_URLS = [
  '',
  'http://client.example/settings/billing',
  'javascript:alert(1)',
  '/settings/billing',
  undefined,
];

describe('メール種別tournament-week.entry-refund', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(TOURNAMENT_WEEK_ENTRY_REFUND_KIND.name).toBe(
      'tournament-week.entry-refund',
    );
    expect(TOURNAMENT_WEEK_ENTRY_REFUND_KIND.category).toBe('transactional');
    expect(Object.isFrozen(TOURNAMENT_WEEK_ENTRY_REFUND_KIND)).toBe(true);
  });

  test('ニックネーム・週の表記・ローンチ日・理由・決済履歴のURLを受け付け、他の項目を取り除く', () => {
    const result = TOURNAMENT_WEEK_ENTRY_REFUND_KIND.inputSchema.safeParse({
      ...ENTRY_REFUND_FIELDS,
      to: 'someone@mail.example',
      amount: 500,
      purchaseId: '01JD0PR0D0000000000000000A',
    });

    expect(result).toEqual({ success: true, data: ENTRY_REFUND_FIELDS });
  });

  test.each(['entitlement_lost', 'entitlement_suspended'] as const)(
    '返金の理由%sを受け付ける',
    (reason) => {
      expect(acceptsEntryRefund(entryRefundWith('reason', reason))).toBe(true);
    },
  );

  test('枠の状態から導いた返金の理由をすべて受け付ける', () => {
    for (const status of ['forfeited', 'excluded'] as const) {
      expect(
        acceptsEntryRefund(entryRefundWith('reason', refundReasonFor(status))),
      ).toBe(true);
    }
  });

  test.each(['rejected_expired', 'forfeited', '', undefined])(
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
      TOURNAMENT_WEEK_ENTRY_REFUND_KIND.inputSchema.parse(ENTRY_REFUND_FIELDS);

    expect(TOURNAMENT_WEEK_ENTRY_REFUND_KIND.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test.each(['nickname', 'weekLabel'])(
    '文字列の項目%sが空・欠落・文字列以外なら拒否する',
    (key) => {
      for (const value of INVALID_TEXTS) {
        expect(acceptsEntryRefund(entryRefundWith(key, value))).toBe(false);
      }
    },
  );

  test.each(INVALID_DATES)(
    '実在するYYYY-MM-DDの日付でないローンチ日%pを拒否する',
    (launchDate) => {
      expect(
        acceptsEntryRefund(entryRefundWith('launchDate', launchDate)),
      ).toBe(false);
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

describe('TOURNAMENT_WEEK_EMAIL_KINDS', () => {
  test('返金の知らせの1種を凍結して持つ', () => {
    expect(TOURNAMENT_WEEK_EMAIL_KINDS).toEqual([
      TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
    ]);
    expect(Object.isFrozen(TOURNAMENT_WEEK_EMAIL_KINDS)).toBe(true);
  });
});
