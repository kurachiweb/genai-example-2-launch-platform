import { describe, expect, test } from 'bun:test';

import {
  formatUltrasMonthlyAmount,
  ULTRAS_CANCELLATION_NOTE,
  ULTRAS_ENTRY_FEE_NOT_REFUNDED_NOTE,
  ULTRAS_NO_PRORATED_REFUND_NOTE,
  ultrasAutoRenewalNoteOf,
  ultrasCheckoutNotesOf,
} from './checkout-notes.ts';

describe('formatUltrasMonthlyAmount', () => {
  test('セント単位の金額を通貨の記号付きのドルにし、税込の旨を続ける', () => {
    expect(formatUltrasMonthlyAmount(999)).toBe('$9.99(税込)');
  });

  test('千の位は3桁区切りにする', () => {
    expect(formatUltrasMonthlyAmount(123_450)).toBe('$1,234.50(税込)');
  });

  test('端数の無い金額も小数点以下2桁で表す', () => {
    expect(formatUltrasMonthlyAmount(1000)).toBe('$10.00(税込)');
  });
});

describe('ultrasAutoRenewalNoteOf', () => {
  test('毎月の請求額を差し込んだ自動更新の文にする', () => {
    expect(ultrasAutoRenewalNoteOf(999)).toBe(
      'Ultrasプランは毎月自動で更新され、毎月の更新日に$9.99(税込)を自動でお支払いいただきます。',
    );
  });
});

describe('固定の購入の条件の文', () => {
  test('解約の方法と特典の継続の文は文言規則と一致する', () => {
    expect(ULTRAS_CANCELLATION_NOTE).toBe(
      '解約はプラン管理画面からいつでも行え、解約した後も課金期間の末日まで特典が続きます。',
    );
  });

  test('日割りの返金が無い文は文言規則と一致する', () => {
    expect(ULTRAS_NO_PRORATED_REFUND_NOTE).toBe(
      '課金期間の途中で解約しても、日割りの返金はありません。',
    );
  });

  test('支払い済みの参加費を返金しない文は文言規則と一致する', () => {
    expect(ULTRAS_ENTRY_FEE_NOT_REFUNDED_NOTE).toBe(
      '支払い済みのトーナメント参加費は返金されません。',
    );
  });
});

describe('ultrasCheckoutNotesOf', () => {
  test('自動更新・解約・日割りの返金なし・参加費の返金なしの順に4つの文を返す', () => {
    expect(ultrasCheckoutNotesOf(999)).toEqual([
      'Ultrasプランは毎月自動で更新され、毎月の更新日に$9.99(税込)を自動でお支払いいただきます。',
      '解約はプラン管理画面からいつでも行え、解約した後も課金期間の末日まで特典が続きます。',
      '課金期間の途中で解約しても、日割りの返金はありません。',
      '支払い済みのトーナメント参加費は返金されません。',
    ]);
  });

  test('最終確認画面が文言を鍵にして描けるよう、4つの文は互いに異なる', () => {
    const notes = ultrasCheckoutNotesOf(999);

    expect(new Set(notes).size).toBe(notes.length);
  });

  test('返す一覧は変更できない', () => {
    expect(Object.isFrozen(ultrasCheckoutNotesOf(999))).toBe(true);
  });
});
