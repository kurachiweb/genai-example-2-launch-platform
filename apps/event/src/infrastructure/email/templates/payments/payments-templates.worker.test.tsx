import { describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_TEXT } from '../../../../../common-lib/payments/checkout-consent.ts';
import { REFUND_POLICY_SUMMARY } from '../../../../../common-lib/payments/refund-policy-summary.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  PAYMENTS_AUTOMATIC_REFUND_KIND,
  PAYMENTS_PURCHASE_CONFIRMATION_KIND,
} from '../../../../../lib/core/email/kinds/payments.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { AUTOMATIC_REFUND_TEMPLATE } from './automatic-refund-template.ts';
import { PAYMENT_EMAIL_TEMPLATES } from './index.ts';
import { PURCHASE_CONFIRMATION_TEMPLATE } from './purchase-confirmation-template.ts';

const NICKNAME = '山田 はなこ';

const PAYMENT_HISTORY_URL = 'https://client.example/settings/billing';

const ACTION_LABEL = '決済履歴を見る';

const ULTRAS_NOTES = [
  '毎月自動で更新され、更新のたびに$12.00 USD(税込)を請求します。',
  '設定のプランの画面から、いつでも解約できます。',
];

const CONFIRMATION_INPUT = {
  nickname: NICKNAME,
  itemName: 'Ultrasプラン',
  quantityLabel: '1か月',
  amount: 123_450,
  purchasedAt: '2026-11-02T07:40:00.000Z',
  serviceTiming: '購入の確定後すぐ',
  additionalNotes: ULTRAS_NOTES,
  consentedAt: '2026-11-02T07:38:00.000Z',
  consentText: CHECKOUT_CONSENT_TEXT,
  paymentHistoryUrl: PAYMENT_HISTORY_URL,
};

const REFUND_INPUT = {
  nickname: NICKNAME,
  itemName: 'Weekトーナメント参加費',
  quantityLabel: '1件',
  amount: 900,
  reason: 'late' as const,
  purchasedAt: '2026-11-02T07:40:00.000Z',
  refundedAt: '2026-11-03T08:05:00.000Z',
  paymentHistoryUrl: PAYMENT_HISTORY_URL,
};

const CONFIRMATION_SUBJECT = '購入が完了しました';

const REFUND_SUBJECT = 'お支払いを返金しました';

const NOTES_HEADING = '購入の条件';

const REFUND_REASON_SENTENCES = {
  late: '返金の理由: お支払いの確認が、購入を反映できる期限に間に合いませんでした。',
  ineligible:
    '返金の理由: お支払いを確認した時点で、購入の対象が購入できない状態になっていました。',
  duplicate:
    '返金の理由: 同じ購入の対象へのお支払いが既に確定していたため、重ねてのお支払いとなりました。',
} as const;

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function renderConfirmation(input: Record<string, unknown>) {
  return createRenderer().render(
    PAYMENTS_PURCHASE_CONFIRMATION_KIND,
    input,
    undefined,
  );
}

function renderRefund(input: Record<string, unknown>) {
  return createRenderer().render(
    PAYMENTS_AUTOMATIC_REFUND_KIND,
    input,
    undefined,
  );
}

function indexOrFail(text: string, part: string): number {
  const index = text.indexOf(part);
  expect(index, part).toBeGreaterThanOrEqual(0);
  return index;
}

describe('決済のテンプレートの集約', () => {
  test('購入確認と自動返金のテンプレートをこの順で凍結して持ち、それぞれの種別を指す', () => {
    expect(PAYMENT_EMAIL_TEMPLATES).toEqual([
      PURCHASE_CONFIRMATION_TEMPLATE,
      AUTOMATIC_REFUND_TEMPLATE,
    ]);
    expect(Object.isFrozen(PAYMENT_EMAIL_TEMPLATES)).toBe(true);
    expect(PURCHASE_CONFIRMATION_TEMPLATE.kind).toBe(
      PAYMENTS_PURCHASE_CONFIRMATION_KIND,
    );
    expect(AUTOMATIC_REFUND_TEMPLATE.kind).toBe(PAYMENTS_AUTOMATIC_REFUND_KIND);
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('payments.purchase-confirmation')).toBe(
      PURCHASE_CONFIRMATION_TEMPLATE,
    );
    expect(registry.get('payments.automatic-refund')).toBe(
      AUTOMATIC_REFUND_TEMPLATE,
    );
  });
});

describe('購入確認メールのテンプレート', () => {
  test('件名を接頭辞なしで返し、受信一覧の冒頭の文を持つ', () => {
    expect(PURCHASE_CONFIRMATION_TEMPLATE.subject(CONFIRMATION_INPUT)).toBe(
      CONFIRMATION_SUBJECT,
    );
    expect(PURCHASE_CONFIRMATION_TEMPLATE.preview(CONFIRMATION_INPUT)).toBe(
      'ご購入ありがとうございます。購入の内容と、同意いただいた条件をお知らせします。',
    );
  });

  test('宛名にニックネームを使い、行動ボタン「決済履歴を見る」で決済履歴へリンクする', () => {
    expect(PURCHASE_CONFIRMATION_TEMPLATE.greeting(CONFIRMATION_INPUT)).toBe(
      NICKNAME,
    );
    expect(PURCHASE_CONFIRMATION_TEMPLATE.action?.(CONFIRMATION_INPUT)).toEqual(
      { label: ACTION_LABEL, url: PAYMENT_HISTORY_URL },
    );
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in PURCHASE_CONFIRMATION_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに購入の内容・USDの税込の金額・time要素で包んだUTCの購入日時と同意の日時・同意の文言・返金ポリシーの要旨・決済履歴へのボタンを置く', async () => {
    const rendered = await renderConfirmation(CONFIRMATION_INPUT);

    expect(rendered.subject).toBe(CONFIRMATION_SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain('購入の内容');
    expect(rendered.html).toContain('<li>購入: Ultrasプラン</li>');
    expect(rendered.html).toContain('<li>分量: 1か月</li>');
    expect(rendered.html).toContain(
      '<li>お支払い金額: $1,234.50 USD(税込)</li>',
    );
    expect(rendered.html).toMatch(
      /<li>購入日時: <time datetime="2026-11-02T07:40:00\.000Z">2026年11月2日07:40\(UTC\)<\/time><\/li>/iu,
    );
    expect(rendered.html).toContain(
      '<li>役務の提供時期: 購入の確定後すぐ</li>',
    );
    expect(rendered.html).toMatch(
      /<time datetime="2026-11-02T07:38:00\.000Z">2026年11月2日07:38\(UTC\)<\/time>に、購入の画面で次の内容に同意いただきました。/iu,
    );
    expect(rendered.html).toContain(`「${CHECKOUT_CONSENT_TEXT}」`);
    expect(rendered.html).toContain('返金ポリシー');
    expect(rendered.html).toContain(REFUND_POLICY_SUMMARY);
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([PAYMENT_HISTORY_URL]);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('追加事項を「購入の内容」の下に見出しと箇条書きで置く', async () => {
    const rendered = await renderConfirmation(CONFIRMATION_INPUT);

    const contentIndex = indexOrFail(rendered.html, '購入の内容');
    const headingIndex = indexOrFail(rendered.html, NOTES_HEADING);
    const firstNoteIndex = indexOrFail(
      rendered.html,
      `<li>${ULTRAS_NOTES[0] ?? ''}</li>`,
    );
    const secondNoteIndex = indexOrFail(
      rendered.html,
      `<li>${ULTRAS_NOTES[1] ?? ''}</li>`,
    );
    const consentIndex = indexOrFail(rendered.html, '役務の即時提供への同意');
    expect(contentIndex).toBeLessThan(headingIndex);
    expect(headingIndex).toBeLessThan(firstNoteIndex);
    expect(firstNoteIndex).toBeLessThan(secondNoteIndex);
    expect(secondNoteIndex).toBeLessThan(consentIndex);
  });

  test('追加事項の無い購入では追加事項の見出しも置かない', async () => {
    const rendered = await renderConfirmation({
      ...CONFIRMATION_INPUT,
      itemName: 'Weekトーナメント参加費',
      additionalNotes: [],
    });

    expect(rendered.html).toContain('購入の内容');
    expect(rendered.html).not.toContain(NOTES_HEADING);
    expect(rendered.text).not.toContain(NOTES_HEADING);
  });

  test('テキストのパートにも購入の内容・金額・UTCの日時・追加事項・同意の文言・返金ポリシーの要旨・決済履歴のURLを置く', async () => {
    const rendered = await renderConfirmation(CONFIRMATION_INPUT);

    for (const part of [
      `${NICKNAME}さん`,
      '購入: Ultrasプラン',
      '分量: 1か月',
      'お支払い金額: $1,234.50 USD(税込)',
      '購入日時: 2026年11月2日07:40(UTC)',
      '役務の提供時期: 購入の確定後すぐ',
      NOTES_HEADING,
      ...ULTRAS_NOTES,
      '2026年11月2日07:38(UTC)に、購入の画面で次の内容に同意いただきました。',
      CHECKOUT_CONSENT_TEXT,
      REFUND_POLICY_SUMMARY,
      ACTION_LABEL,
      PAYMENT_HISTORY_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('1ドル未満の端数と1ドルちょうどの金額もセント単位まで表記する', async () => {
    const cents = await renderConfirmation({
      ...CONFIRMATION_INPUT,
      amount: 5,
    });
    const oneDollar = await renderConfirmation({
      ...CONFIRMATION_INPUT,
      amount: 100,
    });

    expect(cents.text).toContain('お支払い金額: $0.05 USD(税込)');
    expect(oneDollar.text).toContain('お支払い金額: $1.00 USD(税込)');
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderConfirmation({
      ...CONFIRMATION_INPUT,
      nickname: '<script>alert(1)</script>',
      itemName: '<script>alert(2)</script>',
      additionalNotes: ['<script>alert(3)</script>'],
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});

describe('自動返金の通知メールのテンプレート', () => {
  test('件名を接頭辞なしで返し、受信一覧の冒頭の文を持つ', () => {
    expect(AUTOMATIC_REFUND_TEMPLATE.subject(REFUND_INPUT)).toBe(
      REFUND_SUBJECT,
    );
    expect(AUTOMATIC_REFUND_TEMPLATE.preview(REFUND_INPUT)).toBe(
      '購入を確定できなかったため、お支払いいただいた金額の全額を返金しました。',
    );
  });

  test('宛名にニックネームを使い、行動ボタン「決済履歴を見る」で決済履歴へリンクする', () => {
    expect(AUTOMATIC_REFUND_TEMPLATE.greeting(REFUND_INPUT)).toBe(NICKNAME);
    expect(AUTOMATIC_REFUND_TEMPLATE.action?.(REFUND_INPUT)).toEqual({
      label: ACTION_LABEL,
      url: PAYMENT_HISTORY_URL,
    });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in AUTOMATIC_REFUND_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに返金した旨・理由・購入の内容・USDの返金の金額・time要素で包んだUTCの日時・決済履歴へのボタンを置く', async () => {
    const rendered = await renderRefund(REFUND_INPUT);

    expect(rendered.subject).toBe(REFUND_SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(
      '購入を確定できなかったため、お支払いいただいた金額の全額を返金しました。',
    );
    expect(rendered.html).toContain(REFUND_REASON_SENTENCES.late);
    expect(rendered.html).toContain('<li>購入: Weekトーナメント参加費</li>');
    expect(rendered.html).toContain('<li>分量: 1件</li>');
    expect(rendered.html).toContain('<li>返金した金額: $9.00 USD</li>');
    expect(rendered.html).toMatch(
      /<li>お支払いの日時: <time datetime="2026-11-02T07:40:00\.000Z">2026年11月2日07:40\(UTC\)<\/time><\/li>/iu,
    );
    expect(rendered.html).toMatch(
      /<li>返金の日時: <time datetime="2026-11-03T08:05:00\.000Z">2026年11月3日08:05\(UTC\)<\/time><\/li>/iu,
    );
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([PAYMENT_HISTORY_URL]);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test.each(Object.entries(REFUND_REASON_SENTENCES))(
    '理由%sの文言を本文に置き、他の理由の文言を置かない',
    async (reason, sentence) => {
      const rendered = await renderRefund({ ...REFUND_INPUT, reason });

      expect(rendered.html).toContain(sentence);
      expect(rendered.text).toContain(sentence);
      for (const other of Object.values(REFUND_REASON_SENTENCES)) {
        if (other !== sentence) {
          expect(rendered.html).not.toContain(other);
        }
      }
    },
  );

  test('テキストのパートにも返金した旨・理由・購入の内容・金額・UTCの日時・決済履歴のURLを置く', async () => {
    const rendered = await renderRefund(REFUND_INPUT);

    for (const part of [
      `${NICKNAME}さん`,
      '購入を確定できなかったため、お支払いいただいた金額の全額を返金しました。',
      REFUND_REASON_SENTENCES.late,
      '購入: Weekトーナメント参加費',
      '返金した金額: $9.00 USD',
      'お支払いの日時: 2026年11月2日07:40(UTC)',
      '返金の日時: 2026年11月3日08:05(UTC)',
      ACTION_LABEL,
      PAYMENT_HISTORY_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderRefund({
      ...REFUND_INPUT,
      nickname: '<script>alert(1)</script>',
      quantityLabel: '<script>alert(2)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
  });
});
