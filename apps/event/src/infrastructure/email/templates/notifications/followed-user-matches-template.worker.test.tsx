import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  type FollowedUserMatchesEmailInput,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
} from '../../../../../lib/core/email/kinds/notifications.ts';
import type { SenderInfo } from '../../../../../lib/core/email/ports.ts';
import { DIGEST_ITEM_LIMIT } from '../../../../../lib/core/notifications/notice-plan.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { FOLLOWED_USER_MATCHES_TEMPLATE } from './followed-user-matches-template.ts';

const NICKNAME = '山田 はなこ';

const SETTINGS_URL = 'https://client.example/settings/notifications';

const UNSUBSCRIBE_URL =
  'https://client.example/unsubscribe#token=0123456789abcdef';

const TOP_PAGE_URL = 'https://client.example/';

const SENDER_INFO: SenderInfo = {
  businessName: 'テスト事業者',
  contactEmail: 'contact@sender.example',
  postalAddress: '東京都千代田区1-1-1',
};

const FIRST_ITEM = {
  productName: 'Pitch Notes',
  makerNickname: '佐藤',
  matchLabel: 'Week 準決勝',
  opponentProductName: 'Tactics Board',
} as const;

const SECOND_ITEM = {
  productName: 'Line Up',
  makerNickname: '鈴木',
  matchLabel: '予選',
  opponentProductName: '非公開のプロダクト',
} as const;

const INPUT: FollowedUserMatchesEmailInput = {
  settingsUrl: SETTINGS_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  nickname: NICKNAME,
  items: [FIRST_ITEM],
  omittedCount: 0,
  topPageUrl: TOP_PAGE_URL,
};

const MULTIPLE_INPUT: FollowedUserMatchesEmailInput = {
  ...INPUT,
  items: [FIRST_ITEM, SECOND_ITEM],
};

const SINGLE_SUBJECT = 'Pitch Notesがキックオフします⚽️応援しましょう！';

const LEAD_SENTENCE =
  'フォローしているユーザーのプロダクトのマッチが始まりました。';

const FIRST_ITEM_LINE = 'Pitch Notes(佐藤さん)— Week 準決勝 vs Tactics Board';

const SECOND_ITEM_LINE = 'Line Up(鈴木さん)— 予選 vs 非公開のプロダクト';

const ACTION_LABEL = 'トップページで応援する';

const SETTINGS_LABEL = '通知設定を変更する';

const UNSUBSCRIBE_LABEL = 'この通知を配信停止';

function renderWith(
  input: FollowedUserMatchesEmailInput,
  senderInfo: SenderInfo | undefined,
) {
  const renderer = new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
  return renderer.render(
    NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
    input,
    senderInfo,
  );
}

function render(input: FollowedUserMatchesEmailInput) {
  return renderWith(input, SENDER_INFO);
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function itemsOf(count: number): FollowedUserMatchesEmailInput['items'] {
  return Array.from({ length: count }, (_, index) => ({
    ...FIRST_ITEM,
    productName: `Product ${String(index + 1)}`,
  }));
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

describe('フォロー中の利用者のマッチの開催通知のメールのテンプレート', () => {
  test('開催通知の通知メールの種別を指し、テストの入力は種別の検証を通る', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.kind).toBe(
      NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
    );
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.kind.category).toBe('notification');
    for (const input of [INPUT, MULTIPLE_INPUT]) {
      expect(
        NOTIFICATION_FOLLOWED_USER_MATCHES_KIND.inputSchema.parse(input),
      ).toEqual(input);
    }
  });

  test('対象が1件なら件名を接頭辞なしで「<プロダクト名>がキックオフします⚽️応援しましょう！」とする', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.subject(INPUT)).toBe(SINGLE_SUBJECT);
  });

  test('対象が複数なら件名を載せた項目と残りの件数を合わせた件数で示す', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.subject(MULTIPLE_INPUT)).toBe(
      'フォローしているユーザーの2プロダクトがキックオフします⚽️応援しましょう！',
    );
    expect(
      FOLLOWED_USER_MATCHES_TEMPLATE.subject({
        ...INPUT,
        items: itemsOf(DIGEST_ITEM_LIMIT),
        omittedCount: 1204,
      }),
    ).toBe(
      'フォローしているユーザーの1,234プロダクトがキックオフします⚽️応援しましょう！',
    );
  });

  test('載せた項目が1件でも残りの件数があれば複数の件名にする', () => {
    expect(
      FOLLOWED_USER_MATCHES_TEMPLATE.subject({ ...INPUT, omittedCount: 2 }),
    ).toBe(
      'フォローしているユーザーの3プロダクトがキックオフします⚽️応援しましょう！',
    );
  });

  test('受信一覧の冒頭の文は本文の冒頭の文と同じにする', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.preview(INPUT)).toBe(LEAD_SENTENCE);
  });

  test('宛名にニックネームを使い、行動ボタン「トップページで応援する」でトップページへリンクする', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.greeting(INPUT)).toBe(NICKNAME);
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.action?.(INPUT)).toEqual({
      label: ACTION_LABEL,
      url: TOP_PAGE_URL,
    });
  });

  test('配信停止のリンクはラベルを省いた1つで、既定の文言で表示させる', () => {
    expect(FOLLOWED_USER_MATCHES_TEMPLATE.unsubscribeLinks?.(INPUT)).toEqual([
      { url: UNSUBSCRIBE_URL },
    ]);
  });

  test('HTMLのパートに宛名・冒頭の文・項目の箇条・通知設定のリンク・ボタン・配信停止・送信者情報をこの順で置く', async () => {
    const rendered = await render(MULTIPLE_INPUT);

    expect(rendered.subject).toBe(
      'フォローしているユーザーの2プロダクトがキックオフします⚽️応援しましょう！',
    );
    expect(rendered.html).toContain(`<li>${FIRST_ITEM_LINE}</li>`);
    expect(rendered.html).toContain(`<li>${SECOND_ITEM_LINE}</li>`);
    expectInOrder(rendered.html, [
      `${NICKNAME}さん`,
      LEAD_SENTENCE,
      FIRST_ITEM_LINE,
      SECOND_ITEM_LINE,
      SETTINGS_LABEL,
      ACTION_LABEL,
      UNSUBSCRIBE_LABEL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);
    expect(hrefsOf(rendered.html)).toEqual([
      SETTINGS_URL,
      TOP_PAGE_URL,
      UNSUBSCRIBE_URL,
    ]);
    expect(rendered.html).not.toContain('ほか');
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも同じ順で文言とURLを置く', async () => {
    const rendered = await render(MULTIPLE_INPUT);

    expectInOrder(rendered.text, [
      `${NICKNAME}さん`,
      LEAD_SENTENCE,
      FIRST_ITEM_LINE,
      SECOND_ITEM_LINE,
      SETTINGS_LABEL,
      SETTINGS_URL,
      ACTION_LABEL,
      TOP_PAGE_URL,
      UNSUBSCRIBE_LABEL,
      UNSUBSCRIBE_URL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('残りの件数があれば項目の箇条の後に3桁ごとに区切った「ほか<件数>件」を添える', async () => {
    const items = itemsOf(DIGEST_ITEM_LIMIT);
    const rendered = await render({ ...INPUT, items, omittedCount: 1234 });

    expect(rendered.html.match(/<li>/gu)).toHaveLength(DIGEST_ITEM_LIMIT);
    expectInOrder(rendered.text, [
      LEAD_SENTENCE,
      `Product ${String(DIGEST_ITEM_LIMIT)}(佐藤さん)— Week 準決勝 vs Tactics Board`,
      'ほか1,234件',
      SETTINGS_LABEL,
      ACTION_LABEL,
    ]);
  });

  test('件名に日付を基準にした相対表現を使わない', async () => {
    for (const input of [INPUT, MULTIPLE_INPUT]) {
      const rendered = await render(input);

      expect(rendered.subject).not.toMatch(/明日|本日/u);
    }
  });

  test('送信者情報が渡されなければ送信者情報の区画を置かない', async () => {
    const rendered = await renderWith(INPUT, undefined);

    expect(rendered.text).not.toContain(SENDER_INFO.businessName);
    expect(rendered.text.trimEnd().endsWith(UNSUBSCRIBE_URL)).toBe(true);
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render({
      ...INPUT,
      nickname: '<script>alert(1)</script>',
      items: [
        {
          productName: '<script>alert(2)</script>',
          makerNickname: '<b>作り手</b>',
          matchLabel: '予選',
          opponentProductName: '<i>相手</i>',
        },
      ],
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).not.toContain('<b>作り手</b>');
    expect(rendered.html).not.toContain('<i>相手</i>');
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '<li>&lt;script&gt;alert(2)&lt;/script&gt;(&lt;b&gt;作り手&lt;/b&gt;さん)— 予選 vs &lt;i&gt;相手&lt;/i&gt;</li>',
    );
  });
});
