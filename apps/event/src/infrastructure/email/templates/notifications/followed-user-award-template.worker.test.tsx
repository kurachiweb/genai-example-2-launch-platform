import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  type FollowedUserAwardEmailInput,
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
} from '../../../../../lib/core/email/kinds/notifications.ts';
import type { SenderInfo } from '../../../../../lib/core/email/ports.ts';
import { awardPeriodLabel } from '../../../../../lib/core/notifications/notice-copy.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { FOLLOWED_USER_AWARD_TEMPLATE } from './followed-user-award-template.ts';

const NICKNAME = '山田 はなこ';

const SETTINGS_URL = 'https://client.example/settings/notifications';

const UNSUBSCRIBE_URL =
  'https://client.example/unsubscribe#token=0123456789abcdef';

const PRODUCT_URL = 'https://client.example/p/pitch-notes';

const SENDER_INFO: SenderInfo = {
  businessName: 'テスト事業者',
  contactEmail: 'contact@sender.example',
  postalAddress: '東京都千代田区1-1-1',
};

const WEEK_INPUT: FollowedUserAwardEmailInput = {
  settingsUrl: SETTINGS_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  nickname: NICKNAME,
  productName: 'Pitch Notes',
  makerNickname: '佐藤',
  award: 'product_of_the_week',
  periodLabel: awardPeriodLabel('product_of_the_week', '2026-W37'),
  productUrl: PRODUCT_URL,
};

const YEAR_INPUT: FollowedUserAwardEmailInput = {
  ...WEEK_INPUT,
  award: 'product_of_the_year',
  periodLabel: awardPeriodLabel('product_of_the_year', '2026'),
};

const WEEK_SENTENCE =
  '佐藤さんのPitch Notesが2026年第37週(9/7〜9/13)のProduct of the Weekを受賞しました。';

const YEAR_SENTENCE =
  '佐藤さんのPitch Notesが2026年のProduct of the Yearを受賞しました。';

const ACTION_LABEL = 'プロダクトを見る';

const SETTINGS_LABEL = '通知設定を変更する';

const UNSUBSCRIBE_LABEL = 'この通知を配信停止';

function renderWith(
  input: FollowedUserAwardEmailInput,
  senderInfo: SenderInfo | undefined,
) {
  const renderer = new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
  return renderer.render(
    NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
    input,
    senderInfo,
  );
}

function render(input: FollowedUserAwardEmailInput) {
  return renderWith(input, SENDER_INFO);
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

// 受信一覧の冒頭の文などの前の出現に惑わされないよう、各部分を直前の部分より後ろから探す
function expectInOrder(content: string, parts: readonly string[]): void {
  let from = 0;
  for (const part of parts) {
    const position = content.indexOf(part, from);
    expect(position, part).toBeGreaterThanOrEqual(0);
    from = position + part.length;
  }
}

describe('フォロー中の利用者の受賞結果のメールのテンプレート', () => {
  test('受賞結果の通知メールの種別を指し、テストの入力は種別の検証を通る', () => {
    expect(FOLLOWED_USER_AWARD_TEMPLATE.kind).toBe(
      NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
    );
    expect(FOLLOWED_USER_AWARD_TEMPLATE.kind.category).toBe('notification');
    for (const input of [WEEK_INPUT, YEAR_INPUT]) {
      expect(
        NOTIFICATION_FOLLOWED_USER_AWARD_KIND.inputSchema.parse(input),
      ).toEqual(input);
    }
  });

  test.each([
    [
      'Product of the Week',
      WEEK_INPUT,
      'Pitch NotesがProduct of the Weekを受賞',
    ],
    [
      'Product of the Year',
      YEAR_INPUT,
      'Pitch NotesがProduct of the Yearを受賞',
    ],
  ] as const)(
    '%sの件名を接頭辞なしで「<プロダクト名>が<賞>を受賞」とする',
    (_, input, subject) => {
      expect(FOLLOWED_USER_AWARD_TEMPLATE.subject(input)).toBe(subject);
    },
  );

  test.each([
    ['Product of the Week', WEEK_INPUT, WEEK_SENTENCE],
    ['Product of the Year', YEAR_INPUT, YEAR_SENTENCE],
  ] as const)(
    '%sの受信一覧の冒頭の文は投稿者のニックネームと賞の期間を含む本文の文とする',
    (_, input, sentence) => {
      expect(FOLLOWED_USER_AWARD_TEMPLATE.preview(input)).toBe(sentence);
    },
  );

  test('宛名にニックネームを使い、行動ボタン「プロダクトを見る」で受賞したプロダクトの詳細へリンクする', () => {
    expect(FOLLOWED_USER_AWARD_TEMPLATE.greeting(WEEK_INPUT)).toBe(NICKNAME);
    expect(FOLLOWED_USER_AWARD_TEMPLATE.action?.(WEEK_INPUT)).toEqual({
      label: ACTION_LABEL,
      url: PRODUCT_URL,
    });
  });

  test('配信停止のリンクはラベルを省いた1つで、既定の文言で表示させる', () => {
    expect(FOLLOWED_USER_AWARD_TEMPLATE.unsubscribeLinks?.(WEEK_INPUT)).toEqual(
      [{ url: UNSUBSCRIBE_URL }],
    );
  });

  test('HTMLのパートに宛名・受賞の文・通知設定のリンク・ボタン・配信停止・送信者情報をこの順で置く', async () => {
    const rendered = await render(WEEK_INPUT);

    expect(rendered.subject).toBe('Pitch NotesがProduct of the Weekを受賞');
    expectInOrder(rendered.html, [
      `${NICKNAME}さん`,
      WEEK_SENTENCE,
      SETTINGS_LABEL,
      ACTION_LABEL,
      UNSUBSCRIBE_LABEL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);
    expect(hrefsOf(rendered.html)).toEqual([
      SETTINGS_URL,
      PRODUCT_URL,
      UNSUBSCRIBE_URL,
    ]);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも同じ順で文言とURLを置き、Yearの賞は年で期間を示す', async () => {
    const rendered = await render(YEAR_INPUT);

    expectInOrder(rendered.text, [
      `${NICKNAME}さん`,
      YEAR_SENTENCE,
      SETTINGS_LABEL,
      SETTINGS_URL,
      ACTION_LABEL,
      PRODUCT_URL,
      UNSUBSCRIBE_LABEL,
      UNSUBSCRIBE_URL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('件名に日付を基準にした相対表現を使わない', async () => {
    for (const input of [WEEK_INPUT, YEAR_INPUT]) {
      const rendered = await render(input);

      expect(rendered.subject).not.toMatch(/明日|本日/u);
    }
  });

  test('送信者情報が渡されなければ送信者情報の区画を置かない', async () => {
    const rendered = await renderWith(WEEK_INPUT, undefined);

    expect(rendered.text).not.toContain(SENDER_INFO.businessName);
    expect(rendered.text.trimEnd().endsWith(UNSUBSCRIBE_URL)).toBe(true);
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render({
      ...WEEK_INPUT,
      nickname: '<script>alert(1)</script>',
      productName: '<script>alert(2)</script>',
      makerNickname: '<b>作り手</b>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).not.toContain('<b>作り手</b>');
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '&lt;b&gt;作り手&lt;/b&gt;さんの&lt;script&gt;alert(2)&lt;/script&gt;が2026年第37週(9/7〜9/13)のProduct of the Weekを受賞しました。',
    );
  });
});
