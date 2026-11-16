import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { TOURNAMENT_WEEK_ENTRY_REFUND_KIND } from '../../../../../lib/core/email/kinds/tournament-week.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { TOURNAMENT_WEEK_EMAIL_TEMPLATES } from './index.ts';
import { WEEK_ENTRY_REFUND_TEMPLATE } from './week-entry-refund-template.ts';

const NICKNAME = '山田 はなこ';

const WEEK_LABEL = '2026年第37週(9/7〜9/13)';

const BILLING_URL = 'https://client.example/settings/billing';

const ACTION_LABEL = '決済履歴を見る';

const SUBJECT = 'Weekトーナメントの参加費を返金します';

const ENTRY_REFUND_INPUT = {
  nickname: NICKNAME,
  weekLabel: WEEK_LABEL,
  launchDate: '2026-09-13',
  reason: 'entitlement_lost' as const,
  billingUrl: BILLING_URL,
};

const LEAD_SENTENCE = `${WEEK_LABEL}のWeekトーナメントの参加費を返金します。`;

const LOST_REASON_SENTENCE =
  '返金の理由: 組み合わせ決定前にプロダクトが削除されたため';

const SUSPENDED_REASON_SENTENCE =
  '返金の理由: 組み合わせ決定の時点でプロダクトが公開されていなかったため';

const FULL_REFUND_SENTENCE =
  'お支払いいただいた参加費の全額を、お支払いに使った支払い方法へ返金します。お手元に反映されるまで数日かかる場合があります。';

const BILLING_GUIDE_SENTENCE =
  '返金の記録は、下のボタンから決済履歴で確認できます。';

const LAUNCH_DATE_HTML =
  /対象のローンチ: <time datetime="2026-09-13">2026年9月13日<\/time>/iu;

const LAUNCH_DATE_TEXT = '対象のローンチ: 2026年9月13日';

const PAYMENT_DETAIL_PATTERNS = [
  /\$\s*\d/u,
  /USD/u,
  /金額/u,
  /カード/u,
  /\d+円/u,
];

const UNSUBSCRIBE_LABEL = '配信停止';

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
    TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
    input,
    undefined,
  );
}

describe('Weekトーナメントのテンプレートの集約', () => {
  test('返金の知らせのテンプレートを凍結して持ち、トランザクションメールの種別を指す', () => {
    expect(TOURNAMENT_WEEK_EMAIL_TEMPLATES).toEqual([
      WEEK_ENTRY_REFUND_TEMPLATE,
    ]);
    expect(Object.isFrozen(TOURNAMENT_WEEK_EMAIL_TEMPLATES)).toBe(true);
    expect(WEEK_ENTRY_REFUND_TEMPLATE.kind).toBe(
      TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
    );
    expect(WEEK_ENTRY_REFUND_TEMPLATE.kind.category).toBe('transactional');
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('tournament-week.entry-refund')).toBe(
      WEEK_ENTRY_REFUND_TEMPLATE,
    );
  });
});

describe('Weekトーナメントの返金の知らせのテンプレート', () => {
  test('件名を接頭辞なしで返し、週の表記を含む受信一覧の冒頭の文を持つ', () => {
    expect(WEEK_ENTRY_REFUND_TEMPLATE.subject(ENTRY_REFUND_INPUT)).toBe(
      SUBJECT,
    );
    expect(WEEK_ENTRY_REFUND_TEMPLATE.preview(ENTRY_REFUND_INPUT)).toBe(
      LEAD_SENTENCE,
    );
  });

  test('宛名にニックネームを使い、行動ボタン「決済履歴を見る」で決済履歴の画面へリンクする', () => {
    expect(WEEK_ENTRY_REFUND_TEMPLATE.greeting(ENTRY_REFUND_INPUT)).toBe(
      NICKNAME,
    );
    expect(WEEK_ENTRY_REFUND_TEMPLATE.action?.(ENTRY_REFUND_INPUT)).toEqual({
      label: ACTION_LABEL,
      url: BILLING_URL,
    });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in WEEK_ENTRY_REFUND_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに宛名・週の表記・time要素で包んだ年付きのローンチ日・理由・全額の返金と反映の日数の旨・決済履歴への導線とボタンだけを置く', async () => {
    const rendered = await renderEntryRefund(ENTRY_REFUND_INPUT);

    expect(rendered.subject).toBe(SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(LEAD_SENTENCE);
    expect(rendered.html).toMatch(LAUNCH_DATE_HTML);
    expect(rendered.html).toContain(LOST_REASON_SENTENCE);
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
      LAUNCH_DATE_TEXT,
      LOST_REASON_SENTENCE,
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

  test('参加資格の停止による返金では停止の理由の文だけを置く', async () => {
    const rendered = await renderEntryRefund({
      ...ENTRY_REFUND_INPUT,
      reason: 'entitlement_suspended',
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(SUSPENDED_REASON_SENTENCE);
      expect(part).not.toContain(LOST_REASON_SENTENCE);
    }
  });

  test('参加資格の喪失による返金では喪失の理由の文だけを置く', async () => {
    const rendered = await renderEntryRefund(ENTRY_REFUND_INPUT);

    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(SUSPENDED_REASON_SENTENCE);
    }
  });

  test('ローンチ日は業務日付の暦日のまま、今年かどうかによらず年を付けて表記する', async () => {
    const rendered = await renderEntryRefund({
      ...ENTRY_REFUND_INPUT,
      weekLabel: '2027年第1週(1/4〜1/10)',
      launchDate: '2027-01-04',
    });

    expect(rendered.html).toMatch(
      /対象のローンチ: <time datetime="2027-01-04">2027年1月4日<\/time>/iu,
    );
    expect(rendered.text).toContain('対象のローンチ: 2027年1月4日');
    expect(rendered.text).toContain(
      '2027年第1週(1/4〜1/10)のWeekトーナメントの参加費を返金します。',
    );
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
