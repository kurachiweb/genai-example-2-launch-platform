import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  ULTRAS_CANCELLATION_ACCEPTED_KIND,
  ULTRAS_PAYMENT_FAILED_KIND,
} from '../../../../../lib/core/email/kinds/ultras.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { CANCELLATION_ACCEPTED_TEMPLATE } from './cancellation-accepted-template.ts';
import { ULTRAS_EMAIL_TEMPLATES } from './index.ts';
import { PAYMENT_FAILED_TEMPLATE } from './payment-failed-template.ts';

const NICKNAME = '山田 はなこ';

const PLAN_URL = 'https://client.example/settings/plan';

const ACTION_LABEL = 'プランを見る';

const PAYMENT_FAILED_INPUT = {
  nickname: NICKNAME,
  planUrl: PLAN_URL,
};

const CANCELLATION_ACCEPTED_INPUT = {
  nickname: NICKNAME,
  acceptedAt: '2026-11-02T07:40:00.000Z',
  benefitEndsAt: '2026-11-30T23:05:00.000Z',
  planUrl: PLAN_URL,
};

const PAYMENT_FAILED_SUBJECT = 'Ultrasの支払いに失敗しました';

const CANCELLATION_ACCEPTED_SUBJECT = 'Ultrasの解約を受け付けました';

const PAYMENT_FAILED_SENTENCES = [
  'Ultrasの毎月のお支払いに失敗しました。お支払いを再試行しています。',
  '再試行の間も特典は続きます。再試行がすべて失敗すると、特典は終了します。',
  '特典を続けるには、下のボタンからプラン管理画面を開き、「解約・支払い方法の管理」から支払い方法を更新してください。',
] as const;

const CANCELLATION_UNDO_SENTENCE =
  '解約を取り消す場合は、下のボタンからプラン管理画面を開き、「解約・支払い方法の管理」から解約を取り消してください。特典の終了日時を過ぎると取り消せません。';

const ACCEPTED_AT_SENTENCE =
  /<time datetime="2026-11-02T07:40:00\.000Z">2026年11月2日07:40\(UTC\)<\/time>に、Ultrasの解約を受け付けました。/iu;

const BENEFIT_ENDS_AT_SENTENCE =
  /特典は<time datetime="2026-11-30T23:05:00\.000Z">2026年11月30日23:05\(UTC\)<\/time>まで続き、その後は更新されません。/iu;

const UNSUBSCRIBE_LABEL = '配信停止';

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function renderPaymentFailed(input: Record<string, unknown>) {
  return createRenderer().render(ULTRAS_PAYMENT_FAILED_KIND, input, undefined);
}

function renderCancellationAccepted(input: Record<string, unknown>) {
  return createRenderer().render(
    ULTRAS_CANCELLATION_ACCEPTED_KIND,
    input,
    undefined,
  );
}

describe('定期課金のテンプレートの集約', () => {
  test('支払いの失敗と解約の受付のテンプレートをこの順で凍結して持ち、それぞれのトランザクションメールの種別を指す', () => {
    expect(ULTRAS_EMAIL_TEMPLATES).toEqual([
      PAYMENT_FAILED_TEMPLATE,
      CANCELLATION_ACCEPTED_TEMPLATE,
    ]);
    expect(Object.isFrozen(ULTRAS_EMAIL_TEMPLATES)).toBe(true);
    expect(PAYMENT_FAILED_TEMPLATE.kind).toBe(ULTRAS_PAYMENT_FAILED_KIND);
    expect(CANCELLATION_ACCEPTED_TEMPLATE.kind).toBe(
      ULTRAS_CANCELLATION_ACCEPTED_KIND,
    );
    expect(PAYMENT_FAILED_TEMPLATE.kind.category).toBe('transactional');
    expect(CANCELLATION_ACCEPTED_TEMPLATE.kind.category).toBe('transactional');
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('ultras.payment-failed')).toBe(PAYMENT_FAILED_TEMPLATE);
    expect(registry.get('ultras.cancellation-accepted')).toBe(
      CANCELLATION_ACCEPTED_TEMPLATE,
    );
  });
});

describe('支払いの失敗のメールのテンプレート', () => {
  test('件名を接頭辞なしで返し、受信一覧の冒頭の文を持つ', () => {
    expect(PAYMENT_FAILED_TEMPLATE.subject(PAYMENT_FAILED_INPUT)).toBe(
      PAYMENT_FAILED_SUBJECT,
    );
    expect(PAYMENT_FAILED_TEMPLATE.preview(PAYMENT_FAILED_INPUT)).toBe(
      'Ultrasの毎月のお支払いに失敗しました。特典を続けるには、支払い方法を更新してください。',
    );
  });

  test('宛名にニックネームを使い、行動ボタン「プランを見る」でプラン管理画面へリンクする', () => {
    expect(PAYMENT_FAILED_TEMPLATE.greeting(PAYMENT_FAILED_INPUT)).toBe(
      NICKNAME,
    );
    expect(PAYMENT_FAILED_TEMPLATE.action?.(PAYMENT_FAILED_INPUT)).toEqual({
      label: ACTION_LABEL,
      url: PLAN_URL,
    });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in PAYMENT_FAILED_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに宛名・支払いの失敗と再試行の旨・再試行の間は特典が続き再試行がすべて失敗すると終了する旨・支払い方法の更新の案内・プラン管理画面へのボタンだけを置く', async () => {
    const rendered = await renderPaymentFailed(PAYMENT_FAILED_INPUT);

    expect(rendered.subject).toBe(PAYMENT_FAILED_SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    for (const sentence of PAYMENT_FAILED_SENTENCES) {
      expect(rendered.html).toContain(sentence);
    }
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([PLAN_URL]);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・本文の3文・ボタンの文言・プラン管理画面のURLを置き、配信停止のリンクを置かない', async () => {
    const rendered = await renderPaymentFailed(PAYMENT_FAILED_INPUT);

    for (const part of [
      `${NICKNAME}さん`,
      ...PAYMENT_FAILED_SENTENCES,
      ACTION_LABEL,
      PLAN_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderPaymentFailed({
      ...PAYMENT_FAILED_INPUT,
      nickname: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});

describe('解約の受付のメールのテンプレート', () => {
  test('件名を接頭辞なしで返し、受信一覧の冒頭の文を持つ', () => {
    expect(
      CANCELLATION_ACCEPTED_TEMPLATE.subject(CANCELLATION_ACCEPTED_INPUT),
    ).toBe(CANCELLATION_ACCEPTED_SUBJECT);
    expect(
      CANCELLATION_ACCEPTED_TEMPLATE.preview(CANCELLATION_ACCEPTED_INPUT),
    ).toBe('Ultrasの解約を受け付けました。特典は課金期間の末日まで続きます。');
  });

  test('宛名にニックネームを使い、行動ボタン「プランを見る」でプラン管理画面へリンクする', () => {
    expect(
      CANCELLATION_ACCEPTED_TEMPLATE.greeting(CANCELLATION_ACCEPTED_INPUT),
    ).toBe(NICKNAME);
    expect(
      CANCELLATION_ACCEPTED_TEMPLATE.action?.(CANCELLATION_ACCEPTED_INPUT),
    ).toEqual({ label: ACTION_LABEL, url: PLAN_URL });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in CANCELLATION_ACCEPTED_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに宛名・time要素で包んだ年付きUTCの受け付けた日時と特典の終了日時・取り消しの方法・プラン管理画面へのボタンだけを置く', async () => {
    const rendered = await renderCancellationAccepted(
      CANCELLATION_ACCEPTED_INPUT,
    );

    expect(rendered.subject).toBe(CANCELLATION_ACCEPTED_SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toMatch(ACCEPTED_AT_SENTENCE);
    expect(rendered.html).toMatch(BENEFIT_ENDS_AT_SENTENCE);
    expect(rendered.html).toContain(CANCELLATION_UNDO_SENTENCE);
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([PLAN_URL]);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・年付きUTCの受け付けた日時と特典の終了日時・取り消しの方法・ボタンの文言・プラン管理画面のURLを置き、配信停止のリンクを置かない', async () => {
    const rendered = await renderCancellationAccepted(
      CANCELLATION_ACCEPTED_INPUT,
    );

    for (const part of [
      `${NICKNAME}さん`,
      '2026年11月2日07:40(UTC)に、Ultrasの解約を受け付けました。',
      '特典は2026年11月30日23:05(UTC)まで続き、その後は更新されません。',
      CANCELLATION_UNDO_SENTENCE,
      ACTION_LABEL,
      PLAN_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('日時はローカルの時刻に寄らずUTCで表記する', async () => {
    const rendered = await renderCancellationAccepted({
      ...CANCELLATION_ACCEPTED_INPUT,
      acceptedAt: '2026-12-31T23:59:00.000Z',
      benefitEndsAt: '2027-01-31T00:00:00.000Z',
    });

    expect(rendered.text).toContain(
      '2026年12月31日23:59(UTC)に、Ultrasの解約を受け付けました。',
    );
    expect(rendered.text).toContain(
      '特典は2027年1月31日00:00(UTC)まで続き、その後は更新されません。',
    );
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderCancellationAccepted({
      ...CANCELLATION_ACCEPTED_INPUT,
      nickname: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});
