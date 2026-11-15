import { describe, expect, test } from 'vitest';

import {
  type MatchResultEmailInput,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../../../../../lib/core/email/kinds/notifications.ts';
import type { SenderInfo } from '../../../../../lib/core/email/ports.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { MATCH_RESULT_TEMPLATE } from './match-result-template.ts';

const NICKNAME = '山田 はなこ';

const SETTINGS_URL = 'https://client.example/settings/notifications';

const RESULT_UNSUBSCRIBE_URL =
  'https://client.example/unsubscribe#token=0123456789abcdef';

const PREVIEW_UNSUBSCRIBE_URL =
  'https://client.example/unsubscribe#token=fedcba9876543210';

const MY_PRODUCTS_URL = 'https://client.example/my/products';

const PAYMENT_URL = 'https://client.example/tournaments/week/entry';

const OWN_PRODUCT_ACTION = {
  label: '自分のプロダクトを見る',
  url: MY_PRODUCTS_URL,
} as const;

const SENDER_INFO: SenderInfo = {
  businessName: 'テスト事業者',
  contactEmail: 'contact@sender.example',
  postalAddress: '東京都千代田区1-1-1',
};

const WON_INPUT: MatchResultEmailInput = {
  settingsUrl: SETTINGS_URL,
  unsubscribeUrl: RESULT_UNSUBSCRIBE_URL,
  nickname: NICKNAME,
  ownProductName: 'Pitch Notes',
  opponentProductName: 'Tactics Board',
  matchLabel: '予選',
  outcome: 'won',
  decidedByLastUpvote: false,
  ownVotes: 12,
  opponentVotes: 9,
  supplements: [],
  action: OWN_PRODUCT_ACTION,
  next: null,
};

const NEXT_MATCH: NonNullable<MatchResultEmailInput['next']> = {
  opponentProductName: 'Formation Lab',
  roundName: '準決勝',
  matchLabel: 'Week 準決勝',
  startsAt: '2026-09-16T08:00:00.000Z',
  endsAt: '2026-09-17T07:40:00.000Z',
  unsubscribeUrl: PREVIEW_UNSUBSCRIBE_URL,
};

const COMBINED_INPUT: MatchResultEmailInput = {
  ...WON_INPUT,
  matchLabel: 'Week 準々決勝',
  next: NEXT_MATCH,
};

const WEEK_SUPPLEMENT = {
  title: 'Weekトーナメントへの参加',
  lines: [
    'Weekトーナメントに参加するには、参加費を支払ってください。',
    '支払いの期限: 9月16日23:00(UTC)',
  ],
  action: { label: '参加費を支払う', url: PAYMENT_URL },
  emphasized: true,
} as const;

const PLAIN_SUPPLEMENT = {
  title: 'ディレクトリへの掲載',
  lines: ['ディレクトリに掲載されます。'],
  emphasized: false,
} as const;

const SUPPLEMENTED_INPUT: MatchResultEmailInput = {
  ...WON_INPUT,
  supplements: [
    {
      ...WEEK_SUPPLEMENT,
      lines: [...WEEK_SUPPLEMENT.lines],
      action: { ...WEEK_SUPPLEMENT.action },
    },
    { ...PLAIN_SUPPLEMENT, lines: [...PLAIN_SUPPLEMENT.lines] },
  ],
  action: { ...WEEK_SUPPLEMENT.action },
};

const WON_SENTENCE = 'Pitch Notesは12対9でTactics Boardに勝利しました(予選)。';

const SETTINGS_LABEL = '通知設定を変更する';

const SINGLE_UNSUBSCRIBE_LABEL = 'この通知を配信停止';

const RESULT_UNSUBSCRIBE_LABEL = '勝敗結果の通知を配信停止';

const PREVIEW_UNSUBSCRIBE_LABEL = 'マッチ開始予告の通知を配信停止';

function render(input: MatchResultEmailInput) {
  const renderer = new ReactEmailRenderer(
    createEmailTemplateRegistry(
      [MATCH_RESULT_TEMPLATE],
      [NOTIFICATION_MATCH_RESULT_KIND],
    ),
  );
  return renderer.render(NOTIFICATION_MATCH_RESULT_KIND, input, SENDER_INFO);
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

describe('勝敗結果のメールのテンプレート', () => {
  test('勝敗結果の通知メールの種別を指し、テストの入力は種別の検証を通る', () => {
    expect(MATCH_RESULT_TEMPLATE.kind).toBe(NOTIFICATION_MATCH_RESULT_KIND);
    expect(MATCH_RESULT_TEMPLATE.kind.category).toBe('notification');
    for (const input of [WON_INPUT, COMBINED_INPUT, SUPPLEMENTED_INPUT]) {
      expect(NOTIFICATION_MATCH_RESULT_KIND.inputSchema.parse(input)).toEqual(
        input,
      );
    }
  });

  test('宛名にニックネームを使い、入力の主要な行動をボタンにする', () => {
    expect(MATCH_RESULT_TEMPLATE.greeting(WON_INPUT)).toBe(NICKNAME);
    expect(MATCH_RESULT_TEMPLATE.action?.(WON_INPUT)).toEqual(
      OWN_PRODUCT_ACTION,
    );
    expect(MATCH_RESULT_TEMPLATE.action?.(SUPPLEMENTED_INPUT)).toEqual(
      WEEK_SUPPLEMENT.action,
    );
  });

  test.each([
    [
      '勝利',
      WON_INPUT,
      'フルタイム: Pitch Notesが12対9でTactics Boardに勝利',
      WON_SENTENCE,
    ],
    [
      '敗北',
      { ...WON_INPUT, outcome: 'lost', ownVotes: 9, opponentVotes: 12 },
      'フルタイム: Pitch Notesは9対12でTactics Boardに敗れました',
      'Pitch Notesは9対12でTactics Boardに敗れました(予選)。',
    ],
    [
      '両者敗北',
      { ...WON_INPUT, outcome: 'no_votes', ownVotes: 0, opponentVotes: 0 },
      'フルタイム: Pitch NotesとTactics Boardは両者敗北(0対0)',
      'Upvoteが無かったため、両者敗北(0対0)となりました(予選)。',
    ],
    [
      '不戦勝',
      { ...WON_INPUT, outcome: 'bye', ownVotes: 0, opponentVotes: 0 },
      'フルタイム: Pitch Notesは不戦勝',
      '対戦相手がいないため不戦勝となりました(予選)。',
    ],
  ] as const satisfies readonly (readonly [
    string,
    MatchResultEmailInput,
    string,
    string,
  ])[])(
    '%sの件名と結果の文を示し、受信一覧の冒頭の文を結果の文にする',
    async (_name, input, subject, sentence) => {
      const rendered = await render(input);

      expect(MATCH_RESULT_TEMPLATE.subject(input)).toBe(subject);
      expect(MATCH_RESULT_TEMPLATE.preview(input)).toBe(sentence);
      expect(rendered.subject).toBe(subject);
      expect(rendered.text).toContain(sentence);
      expect(rendered.text).not.toContain('同数でしたが');
    },
  );

  test('勝利のスコアの票数を3桁ごとに区切る', async () => {
    const rendered = await render({
      ...WON_INPUT,
      ownVotes: 1234,
      opponentVotes: 999,
    });

    expect(rendered.text).toContain(
      'Pitch Notesは1,234対999でTactics Boardに勝利しました(予選)。',
    );
  });

  test('最終Upvote時間で勝ったときは結果の文に続けて同数だった旨を示す', async () => {
    const rendered = await render({
      ...WON_INPUT,
      ownVotes: 10,
      opponentVotes: 10,
      decidedByLastUpvote: true,
    });

    expectInOrder(rendered.text, [
      'Pitch Notesは10対10でTactics Boardに勝利しました(予選)。',
      '同数でしたが、最終Upvote時刻が早いため勝利しました。',
      SETTINGS_LABEL,
    ]);
  });

  test('最終Upvote時間で敗れたときは結果の文に続けて同数だった旨を示す', async () => {
    const rendered = await render({
      ...WON_INPUT,
      outcome: 'lost',
      ownVotes: 10,
      opponentVotes: 10,
      decidedByLastUpvote: true,
    });

    expectInOrder(rendered.text, [
      'Pitch Notesは10対10でTactics Boardに敗れました(予選)。',
      '同数でしたが、最終Upvote時刻が遅かったため敗れました。',
      SETTINGS_LABEL,
    ]);
  });

  test('相手のプロダクトが表示できないときは渡された「非公開のプロダクト」を件名と本文に示す', async () => {
    const rendered = await render({
      ...WON_INPUT,
      opponentProductName: '非公開のプロダクト',
    });

    expect(rendered.subject).toBe(
      'フルタイム: Pitch Notesが12対9で非公開のプロダクトに勝利',
    );
    expect(rendered.text).toContain(
      'Pitch Notesは12対9で非公開のプロダクトに勝利しました(予選)。',
    );
  });

  test('統合しないメールは宛名・結果の文・通知設定のリンク・ボタン・1つの配信停止・送信者情報をこの順で置く', async () => {
    const rendered = await render(WON_INPUT);

    expect(MATCH_RESULT_TEMPLATE.unsubscribeLinks?.(WON_INPUT)).toEqual([
      { url: RESULT_UNSUBSCRIBE_URL },
    ]);
    expectInOrder(rendered.html, [
      `${NICKNAME}さん`,
      WON_SENTENCE,
      SETTINGS_LABEL,
      OWN_PRODUCT_ACTION.label,
      SINGLE_UNSUBSCRIBE_LABEL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);
    expect(hrefsOf(rendered.html)).toEqual([
      SETTINGS_URL,
      MY_PRODUCTS_URL,
      RESULT_UNSUBSCRIBE_URL,
    ]);
    expectInOrder(rendered.text, [
      `${NICKNAME}さん`,
      WON_SENTENCE,
      SETTINGS_LABEL,
      SETTINGS_URL,
      OWN_PRODUCT_ACTION.label,
      MY_PRODUCTS_URL,
      SINGLE_UNSUBSCRIBE_LABEL,
      RESULT_UNSUBSCRIBE_URL,
      SENDER_INFO.businessName,
    ]);
    expect(rendered.html).not.toContain('<!-- -->');
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('結果の追記を結果の文の後に見出しと段落で載せ、強調を指定した追記だけを太字にする', async () => {
    const rendered = await render(SUPPLEMENTED_INPUT);

    expect(rendered.html).toMatch(/<h2[^>]*>Weekトーナメントへの参加<\/h2>/u);
    expect(rendered.html).toMatch(/<h2[^>]*>ディレクトリへの掲載<\/h2>/u);
    for (const line of WEEK_SUPPLEMENT.lines) {
      expect(rendered.html).toContain(`<strong>${line}</strong>`);
    }
    expect(rendered.html).toContain(PLAIN_SUPPLEMENT.lines[0]);
    expect(rendered.html).not.toContain(
      `<strong>${PLAIN_SUPPLEMENT.lines[0]}</strong>`,
    );
    expectInOrder(rendered.html, [
      WON_SENTENCE,
      WEEK_SUPPLEMENT.title,
      ...WEEK_SUPPLEMENT.lines,
      PLAIN_SUPPLEMENT.title,
      PLAIN_SUPPLEMENT.lines[0],
      SETTINGS_LABEL,
      WEEK_SUPPLEMENT.action.label,
    ]);
    expectInOrder(rendered.text, [
      WON_SENTENCE,
      WEEK_SUPPLEMENT.title,
      ...WEEK_SUPPLEMENT.lines,
      PLAIN_SUPPLEMENT.title,
      PLAIN_SUPPLEMENT.lines[0],
      SETTINGS_LABEL,
      WEEK_SUPPLEMENT.action.label,
      PAYMENT_URL,
    ]);
  });

  test('追記の行動は主要な行動のボタンだけに置き、追記の段落には重ねて置かない', async () => {
    const rendered = await render(SUPPLEMENTED_INPUT);

    expect(hrefsOf(rendered.html)).toEqual([
      SETTINGS_URL,
      PAYMENT_URL,
      RESULT_UNSUBSCRIBE_URL,
    ]);
    expect(rendered.html).not.toContain(OWN_PRODUCT_ACTION.label);
  });

  test('統合したメールは件名に次のラウンド名を示し、結果の文に続けて翌日の対戦とUTCの開始と終了の日時を示す', async () => {
    const rendered = await render(COMBINED_INPUT);

    expect(rendered.subject).toBe(
      'フルタイム: Pitch NotesがTactics Boardに勝利、次は準決勝',
    );
    expect(rendered.html).toMatch(
      /キックオフ: <time datetime="2026-09-16T08:00:00\.000Z">9月16日08:00\(UTC\)<\/time>/iu,
    );
    expect(rendered.html).toMatch(
      /フルタイム: <time datetime="2026-09-17T07:40:00\.000Z">9月17日07:40\(UTC\)<\/time>/iu,
    );
    expectInOrder(rendered.text, [
      `${NICKNAME}さん`,
      'Pitch Notesは12対9でTactics Boardに勝利しました(Week 準々決勝)。',
      '明日は準決勝です。Formation Labと対戦します。',
      'キックオフ: 9月16日08:00(UTC)',
      'フルタイム: 9月17日07:40(UTC)',
      SETTINGS_LABEL,
      OWN_PRODUCT_ACTION.label,
    ]);
    expect(rendered.text).not.toContain('Week 準決勝');
  });

  test('不戦勝の統合は件名を「<自分>は不戦勝、次は<ラウンド名>」とする', async () => {
    const input: MatchResultEmailInput = {
      ...COMBINED_INPUT,
      outcome: 'bye',
      ownVotes: 0,
      opponentVotes: 0,
    };
    const rendered = await render(input);

    expect(rendered.subject).toBe(
      'フルタイム: Pitch Notesは不戦勝、次は準決勝',
    );
    expectInOrder(rendered.text, [
      '対戦相手がいないため不戦勝となりました(Week 準々決勝)。',
      '明日は準決勝です。Formation Labと対戦します。',
    ]);
  });

  test('統合したメールは勝敗結果とマッチ開始予告の2つの配信停止のリンクをこの順でラベル付きで返し、行動ボタンと送信者情報の間に置く', async () => {
    const rendered = await render(COMBINED_INPUT);

    expect(MATCH_RESULT_TEMPLATE.unsubscribeLinks?.(COMBINED_INPUT)).toEqual([
      { url: RESULT_UNSUBSCRIBE_URL, label: RESULT_UNSUBSCRIBE_LABEL },
      { url: PREVIEW_UNSUBSCRIBE_URL, label: PREVIEW_UNSUBSCRIBE_LABEL },
    ]);
    expect(hrefsOf(rendered.html)).toEqual([
      SETTINGS_URL,
      MY_PRODUCTS_URL,
      RESULT_UNSUBSCRIBE_URL,
      PREVIEW_UNSUBSCRIBE_URL,
    ]);
    expect(rendered.html).not.toContain(SINGLE_UNSUBSCRIBE_LABEL);
    expectInOrder(rendered.text, [
      OWN_PRODUCT_ACTION.label,
      RESULT_UNSUBSCRIBE_LABEL,
      RESULT_UNSUBSCRIBE_URL,
      PREVIEW_UNSUBSCRIBE_LABEL,
      PREVIEW_UNSUBSCRIBE_URL,
      SENDER_INFO.businessName,
    ]);
  });

  test('統合したメールに追記があれば翌日の対戦の後に載せる', async () => {
    const rendered = await render({
      ...COMBINED_INPUT,
      supplements: [
        { ...PLAIN_SUPPLEMENT, lines: [...PLAIN_SUPPLEMENT.lines] },
      ],
    });

    expectInOrder(rendered.text, [
      'Pitch Notesは12対9でTactics Boardに勝利しました(Week 準々決勝)。',
      'フルタイム: 9月17日07:40(UTC)',
      PLAIN_SUPPLEMENT.title,
      PLAIN_SUPPLEMENT.lines[0],
      SETTINGS_LABEL,
    ]);
  });

  test('利用者の値と追記の文字列に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render({
      ...COMBINED_INPUT,
      nickname: '<script>alert(1)</script>',
      ownProductName: '<script>alert(2)</script>',
      opponentProductName: '<b>相手</b>',
      next: { ...NEXT_MATCH, opponentProductName: '<i>次の相手</i>' },
      supplements: [
        {
          title: '<script>alert(3)</script>',
          lines: ['<script>alert(4)</script>'],
          emphasized: true,
        },
      ],
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).not.toContain('<b>相手</b>');
    expect(rendered.html).not.toContain('<i>次の相手</i>');
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(2)&lt;/script&gt;は12対9で&lt;b&gt;相手&lt;/b&gt;に勝利しました(Week 準々決勝)。',
    );
    expect(rendered.html).toContain(
      '明日は準決勝です。&lt;i&gt;次の相手&lt;/i&gt;と対戦します。',
    );
    expect(rendered.html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(rendered.html).toContain(
      '<strong>&lt;script&gt;alert(4)&lt;/script&gt;</strong>',
    );
  });
});
