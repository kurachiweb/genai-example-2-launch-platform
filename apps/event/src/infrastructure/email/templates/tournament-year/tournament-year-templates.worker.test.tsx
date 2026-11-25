import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { TOURNAMENT_YEAR_ENTRY_REFUND_KIND } from '../../../../../lib/core/email/kinds/tournament-year.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { TOURNAMENT_YEAR_EMAIL_TEMPLATES } from './index.ts';
import { YEAR_ENTRY_REFUND_TEMPLATE } from './year-entry-refund-template.ts';

const NICKNAME = '山田 はなこ';

const YEAR_LABEL = '2027年';

const WEEK_LABEL = '2026年第37週(9/7〜9/13)';

const BILLING_URL = 'https://client.example/settings/billing';

const ACTION_LABEL = '決済履歴を見る';

const SUBJECT = 'Yearトーナメントの参加費を返金します';

const ENTRY_REFUND_INPUT = {
  nickname: NICKNAME,
  yearLabel: YEAR_LABEL,
  weekLabel: WEEK_LABEL,
  reason: 'entitlement_lost' as const,
  billingUrl: BILLING_URL,
};

const LEAD_SENTENCE = '2027年のYearトーナメントの参加費を返金します。';

const WEEK_SENTENCE = `対象のProduct of the Week: ${WEEK_LABEL}`;

const REASON_SENTENCES = {
  entitlement_lost: '返金の理由: 組み合わせ決定前にプロダクトが削除されたため',
  entitlement_suspended:
    '返金の理由: 組み合わせ決定の時点でプロダクトが公開されていなかったため',
  capacity_exceeded:
    '返金の理由: 参加数が上限の64を超え、Week優勝の日時が古い順に参加の対象外となったため',
} as const;

const FULL_REFUND_SENTENCE =
  'お支払いいただいた参加費の全額を、お支払いに使った支払い方法へ返金します。お手元に反映されるまで数日かかる場合があります。';

const BILLING_GUIDE_SENTENCE =
  '返金の記録は、下のボタンから決済履歴で確認できます。';

const PAYMENT_DETAIL_PATTERNS = [
  /\$\s*\d/u,
  /USD/u,
  /金額/u,
  /カード/u,
  /\d+円/u,
];

const UNSUBSCRIBE_LABEL = '配信停止';

type RefundReason = keyof typeof REASON_SENTENCES;

const REASONS = Object.keys(REASON_SENTENCES) as RefundReason[];

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function renderEntryRefund(input: Record<string, unknown>) {
  return createRenderer().render(
    TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
    input,
    undefined,
  );
}

describe('Yearトーナメントのテンプレートの集約', () => {
  test('返金の知らせのテンプレートを凍結して持ち、トランザクションメールの種別を指す', () => {
    expect(TOURNAMENT_YEAR_EMAIL_TEMPLATES).toEqual([
      YEAR_ENTRY_REFUND_TEMPLATE,
    ]);
    expect(Object.isFrozen(TOURNAMENT_YEAR_EMAIL_TEMPLATES)).toBe(true);
    expect(YEAR_ENTRY_REFUND_TEMPLATE.kind).toBe(
      TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
    );
    expect(YEAR_ENTRY_REFUND_TEMPLATE.kind.category).toBe('transactional');
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('tournament-year.entry-refund')).toBe(
      YEAR_ENTRY_REFUND_TEMPLATE,
    );
  });
});

describe('Yearトーナメントの返金の知らせのテンプレート', () => {
  test('件名を接頭辞なしで返し、対象年を含む受信一覧の冒頭の文を持つ', () => {
    expect(YEAR_ENTRY_REFUND_TEMPLATE.subject(ENTRY_REFUND_INPUT)).toBe(
      SUBJECT,
    );
    expect(YEAR_ENTRY_REFUND_TEMPLATE.preview(ENTRY_REFUND_INPUT)).toBe(
      LEAD_SENTENCE,
    );
  });

  test('宛名にニックネームを使い、行動ボタン「決済履歴を見る」で決済履歴の画面へリンクする', () => {
    expect(YEAR_ENTRY_REFUND_TEMPLATE.greeting(ENTRY_REFUND_INPUT)).toBe(
      NICKNAME,
    );
    expect(YEAR_ENTRY_REFUND_TEMPLATE.action?.(ENTRY_REFUND_INPUT)).toEqual({
      label: ACTION_LABEL,
      url: BILLING_URL,
    });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in YEAR_ENTRY_REFUND_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに宛名・対象年・Week優勝の週の表記・理由・全額の返金と反映の日数の旨・決済履歴への導線とボタンだけを置く', async () => {
    const rendered = await renderEntryRefund(ENTRY_REFUND_INPUT);

    expect(rendered.subject).toBe(SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(LEAD_SENTENCE);
    expect(rendered.html).toContain(WEEK_SENTENCE);
    expect(rendered.html).toContain(REASON_SENTENCES.entitlement_lost);
    expect(rendered.html).toContain(FULL_REFUND_SENTENCE);
    expect(rendered.html).toContain(BILLING_GUIDE_SENTENCE);
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([BILLING_URL]);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・本文の5文・ボタンの文言・決済履歴のURLを置き、配信停止のリンクを置かない', async () => {
    const rendered = await renderEntryRefund(ENTRY_REFUND_INPUT);

    for (const part of [
      `${NICKNAME}さん`,
      LEAD_SENTENCE,
      WEEK_SENTENCE,
      REASON_SENTENCES.entitlement_lost,
      FULL_REFUND_SENTENCE,
      BILLING_GUIDE_SENTENCE,
      ACTION_LABEL,
      BILLING_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test.each(REASONS)(
    '返金の理由%sではその理由の文だけを置く',
    async (reason) => {
      const rendered = await renderEntryRefund({
        ...ENTRY_REFUND_INPUT,
        reason,
      });

      for (const part of [rendered.html, rendered.text]) {
        expect(part).toContain(REASON_SENTENCES[reason]);
        for (const other of REASONS.filter((each) => each !== reason)) {
          expect(part).not.toContain(REASON_SENTENCES[other]);
        }
      }
    },
  );

  test('対象年とWeek優勝の週の表記を入力のまま置く', async () => {
    const rendered = await renderEntryRefund({
      ...ENTRY_REFUND_INPUT,
      yearLabel: '2028年',
      weekLabel: '2027年第1週(1/4〜1/10)',
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain('2028年のYearトーナメントの参加費を返金します。');
      expect(part).toContain(
        '対象のProduct of the Week: 2027年第1週(1/4〜1/10)',
      );
      expect(part).not.toContain(LEAD_SENTENCE);
    }
  });

  test('返金の金額・カードなどの決済の詳細を載せない', async () => {
    const rendered = await renderEntryRefund({
      ...ENTRY_REFUND_INPUT,
      amount: 500,
      cardLast4: '4242',
    });

    for (const part of [rendered.html, rendered.text]) {
      for (const pattern of PAYMENT_DETAIL_PATTERNS) {
        expect(part).not.toMatch(pattern);
      }
      expect(part).not.toContain('4242');
      expect(part).not.toContain('500');
    }
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderEntryRefund({
      ...ENTRY_REFUND_INPUT,
      nickname: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});
