import { describe, expect, test } from 'vitest';

import {
  type MatchPreviewEmailInput,
  NOTIFICATION_MATCH_PREVIEW_KIND,
} from '../../../../../lib/core/email/kinds/notifications.ts';
import type { SenderInfo } from '../../../../../lib/core/email/ports.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { MATCH_PREVIEW_TEMPLATE } from './match-preview-template.ts';

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

const INPUT: MatchPreviewEmailInput = {
  settingsUrl: SETTINGS_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  nickname: NICKNAME,
  ownProductName: 'Pitch Notes',
  opponentProductName: 'Tactics Board',
  matchLabel: 'Week 準決勝',
  startsAt: '2026-09-15T08:00:00.000Z',
  endsAt: '2026-09-16T07:40:00.000Z',
  topPageUrl: TOP_PAGE_URL,
};

const SUBJECT = 'まもなくキックオフ: Pitch Notes vs Tactics Board';

const PREVIEW = 'Pitch Notesの次のマッチの対戦相手と開始時刻をお知らせします。';

const MATCH_SENTENCE =
  '明日、Pitch NotesがTactics Boardと対戦します(Week 準決勝)。';

const KICKOFF_LINE = 'キックオフ: 9月15日08:00(UTC)';

const FULL_TIME_LINE = 'フルタイム: 9月16日07:40(UTC)';

const ACTION_LABEL = 'トップページを見る';

const SETTINGS_LABEL = '通知設定を変更する';

const UNSUBSCRIBE_LABEL = 'この通知を配信停止';

function render(input: MatchPreviewEmailInput, senderInfo = SENDER_INFO) {
  const renderer = new ReactEmailRenderer(
    createEmailTemplateRegistry(
      [MATCH_PREVIEW_TEMPLATE],
      [NOTIFICATION_MATCH_PREVIEW_KIND],
    ),
  );
  return renderer.render(NOTIFICATION_MATCH_PREVIEW_KIND, input, senderInfo);
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

describe('マッチ開始予告のメールのテンプレート', () => {
  test('マッチ開始予告の通知メールの種別を指し、テストの入力は種別の検証を通る', () => {
    expect(MATCH_PREVIEW_TEMPLATE.kind).toBe(NOTIFICATION_MATCH_PREVIEW_KIND);
    expect(MATCH_PREVIEW_TEMPLATE.kind.category).toBe('notification');
    expect(NOTIFICATION_MATCH_PREVIEW_KIND.inputSchema.parse(INPUT)).toEqual(
      INPUT,
    );
  });

  test('件名を接頭辞なしで「まもなくキックオフ: <自分> vs <相手>」とし、受信一覧の冒頭の文を持つ', () => {
    expect(MATCH_PREVIEW_TEMPLATE.subject(INPUT)).toBe(SUBJECT);
    expect(MATCH_PREVIEW_TEMPLATE.preview(INPUT)).toBe(PREVIEW);
  });

  test('宛名にニックネームを使い、行動ボタン「トップページを見る」でトップページへリンクする', () => {
    expect(MATCH_PREVIEW_TEMPLATE.greeting(INPUT)).toBe(NICKNAME);
    expect(MATCH_PREVIEW_TEMPLATE.action?.(INPUT)).toEqual({
      label: ACTION_LABEL,
      url: TOP_PAGE_URL,
    });
  });

  test('配信停止のリンクはラベルを省いた1つで、既定の文言で表示させる', () => {
    expect(MATCH_PREVIEW_TEMPLATE.unsubscribeLinks?.(INPUT)).toEqual([
      { url: UNSUBSCRIBE_URL },
    ]);
  });

  test('HTMLのパートに宛名・対戦の文・time要素で包んだUTCの開始と終了の日時・通知設定のリンク・ボタン・配信停止・送信者情報をこの順で置く', async () => {
    const rendered = await render(INPUT);

    expect(rendered.subject).toBe(SUBJECT);
    expect(rendered.html).toContain(PREVIEW);
    expect(rendered.html).toMatch(
      /キックオフ: <time datetime="2026-09-15T08:00:00\.000Z">9月15日08:00\(UTC\)<\/time>/iu,
    );
    expect(rendered.html).toMatch(
      /フルタイム: <time datetime="2026-09-16T07:40:00\.000Z">9月16日07:40\(UTC\)<\/time>/iu,
    );
    expectInOrder(rendered.html, [
      `${NICKNAME}さん`,
      MATCH_SENTENCE,
      '9月15日08:00(UTC)',
      '9月16日07:40(UTC)',
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
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも同じ順で文言とURLを置く', async () => {
    const rendered = await render(INPUT);

    expectInOrder(rendered.text, [
      `${NICKNAME}さん`,
      MATCH_SENTENCE,
      KICKOFF_LINE,
      FULL_TIME_LINE,
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

  test('件名に日付を基準にした相対表現を使わない', async () => {
    const rendered = await render(INPUT);

    expect(rendered.subject).not.toMatch(/明日|本日/u);
  });

  test('日時はローカルの時刻に寄らずUTCで表記し、日付の境界をまたいでも月日をUTCで示す', async () => {
    const rendered = await render({
      ...INPUT,
      startsAt: '2026-12-31T23:59:00.000Z',
      endsAt: '2027-01-01T00:05:00.000Z',
    });

    expect(rendered.text).toContain('キックオフ: 12月31日23:59(UTC)');
    expect(rendered.text).toContain('フルタイム: 1月1日00:05(UTC)');
  });

  test('予選のマッチはマッチの表記を「予選」で示す', async () => {
    const rendered = await render({ ...INPUT, matchLabel: '予選' });

    expect(rendered.text).toContain(
      '明日、Pitch NotesがTactics Boardと対戦します(予選)。',
    );
  });

  test('送信者情報が渡されなければ送信者情報の区画を置かない', async () => {
    const rendered = await new ReactEmailRenderer(
      createEmailTemplateRegistry(
        [MATCH_PREVIEW_TEMPLATE],
        [NOTIFICATION_MATCH_PREVIEW_KIND],
      ),
    ).render(NOTIFICATION_MATCH_PREVIEW_KIND, INPUT, undefined);

    expect(rendered.text).not.toContain(SENDER_INFO.businessName);
    expect(rendered.text.trimEnd().endsWith(UNSUBSCRIBE_URL)).toBe(true);
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render({
      ...INPUT,
      nickname: '<script>alert(1)</script>',
      ownProductName: '<script>alert(2)</script>',
      opponentProductName: '<b>相手</b>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).not.toContain('<b>相手</b>');
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '明日、&lt;script&gt;alert(2)&lt;/script&gt;が&lt;b&gt;相手&lt;/b&gt;と対戦します(Week 準決勝)。',
    );
  });
});
