import { describe, expect, test } from 'bun:test';

import { idPrefixFor } from '../markdown/markdown-options.ts';
import { countGraphemes } from '../text/graphemes.ts';
import {
  COMMENT_BODY_RULE,
  COMMENT_BOT_ACTIONS,
  COMMENT_MAX_DEPTH,
  COMMENT_MAX_GRAPHEMES,
  COMMENT_PAGE_SIZE,
  commentBodySchema,
  commentComposerIdScope,
  commentIdScope,
  LAUNCH_NOT_COMMENTABLE_MESSAGE,
  OWN_PRODUCT_RATING_MESSAGE,
  RATING_SCORES,
  ratingScoreSchema,
} from './engagement-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const FLAG_EMOJI = '🇯🇵';

const COMBINED_KANA = '\u304B\u3099';

const TOO_LONG_MESSAGE = 'コメントは2,000文字以内で入力してください。';

const REQUIRED_MESSAGE = 'コメントを入力してください。';

const FORBIDDEN_CHARACTERS_MESSAGE =
  'コメントに使用できない文字が含まれています。';

const RATING_SCORE_MESSAGE = '評価は1〜5で選んでください。';

const ID_SCOPE_PATTERN = /^[a-z0-9]{1,32}$/u;

const COMMENT_IDS = [
  '01JF0COMMENT00000000000001',
  '01JF0COMMENT00000000000002',
  '01HZY3K8Q4M7N2P5R9S6T0V1WX',
] as const;

const issueMessagesOf = (
  result:
    | ReturnType<ReturnType<typeof commentBodySchema>['safeParse']>
    | ReturnType<ReturnType<typeof ratingScoreSchema>['safeParse']>,
): readonly string[] =>
  result.success ? [] : result.error.issues.map(({ message }) => message);

describe('定数', () => {
  test('本文の上限2,000書記素・1ページ10件・3階層の要件の値と一致する', () => {
    expect({
      COMMENT_MAX_GRAPHEMES,
      COMMENT_PAGE_SIZE,
      COMMENT_MAX_DEPTH,
    }).toEqual({
      COMMENT_MAX_GRAPHEMES: 2000,
      COMMENT_PAGE_SIZE: 10,
      COMMENT_MAX_DEPTH: 3,
    });
  });

  test('評価の値は1〜5の整数をこの順に持ち、凍結されている', () => {
    expect(RATING_SCORES).toEqual([1, 2, 3, 4, 5]);
    expect(Object.isFrozen(RATING_SCORES)).toBe(true);
  });

  test('本文の規則は項目名「コメント」・上限2,000書記素・必須で、凍結されている', () => {
    expect(COMMENT_BODY_RULE).toEqual({
      label: 'コメント',
      maxGraphemes: COMMENT_MAX_GRAPHEMES,
      required: true,
    });
    expect(Object.isFrozen(COMMENT_BODY_RULE)).toBe(true);
  });
});

describe('commentBodySchema', () => {
  describe('上限の書記素の数', () => {
    test.each([
      ['半角英字だけで2,000文字', 'a'.repeat(COMMENT_MAX_GRAPHEMES)],
      [
        '結合文字を含む絵文字だけで2,000書記素',
        FAMILY_EMOJI.repeat(COMMENT_MAX_GRAPHEMES),
      ],
      [
        '国旗と濁点の結合文字を混ぜて2,000書記素',
        `${FLAG_EMOJI}${COMBINED_KANA}`.repeat(COMMENT_MAX_GRAPHEMES / 2),
      ],
    ])('%sの本文を受け付ける', (_, text) => {
      expect(countGraphemes(text)).toBe(COMMENT_MAX_GRAPHEMES);
      expect(commentBodySchema().safeParse(text)).toEqual({
        success: true,
        data: text,
      });
    });

    test.each([
      ['半角英字だけで2,001文字', 'a'.repeat(COMMENT_MAX_GRAPHEMES + 1)],
      [
        '結合文字を含む絵文字だけで2,001書記素',
        FAMILY_EMOJI.repeat(COMMENT_MAX_GRAPHEMES + 1),
      ],
    ])('%sの本文を上限の文言で拒否する', (_, text) => {
      expect(issueMessagesOf(commentBodySchema().safeParse(text))).toEqual([
        TOO_LONG_MESSAGE,
      ]);
    });
  });

  describe('空白だけの本文', () => {
    test.each([
      ['空文字列', ''],
      ['半角空白・全角空白・タブ・改行だけ', ' 　\t\r\n'],
      ['ノーブレークスペースだけ', '\u00a0\u00a0'],
    ])('%sの本文を必須の文言で拒否する', (_, text) => {
      expect(issueMessagesOf(commentBodySchema().safeParse(text))).toEqual([
        REQUIRED_MESSAGE,
      ]);
    });

    test('上限を超える空白だけの本文も必須の文言だけで拒否する', () => {
      expect(
        issueMessagesOf(
          commentBodySchema().safeParse(' '.repeat(COMMENT_MAX_GRAPHEMES + 1)),
        ),
      ).toEqual([REQUIRED_MESSAGE]);
    });
  });

  describe('使用できない文字', () => {
    test.each([
      ['孤立したサロゲート', 'あ\ud83dい'],
      ['NUL', 'あ\u0000い'],
      ['ESC', 'あ\u001bい'],
    ])('%sを含む本文を使用できない文字の文言で拒否する', (_, text) => {
      expect(issueMessagesOf(commentBodySchema().safeParse(text))).toEqual([
        FORBIDDEN_CHARACTERS_MESSAGE,
      ]);
    });

    test('使用できない文字と空白だけを、必須より先に使用できない文字の文言だけで拒否する', () => {
      expect(
        issueMessagesOf(commentBodySchema().safeParse(' \u0000 ')),
      ).toEqual([FORBIDDEN_CHARACTERS_MESSAGE]);
    });

    test('使用できない文字を含む上限超過の本文を、上限より先に使用できない文字の文言だけで拒否する', () => {
      expect(
        issueMessagesOf(
          commentBodySchema().safeParse(
            `${'a'.repeat(COMMENT_MAX_GRAPHEMES)}\u0000`,
          ),
        ),
      ).toEqual([FORBIDDEN_CHARACTERS_MESSAGE]);
    });
  });

  test('マークダウンの原文を変えずに返す', () => {
    const markdown = '## 質問\n\n**どの言語**で作りましたか?\n';

    expect(commentBodySchema().safeParse(markdown)).toEqual({
      success: true,
      data: markdown,
    });
  });
});

describe('ratingScoreSchema', () => {
  test.each(RATING_SCORES.map((score) => [score]))(
    '評価の値%iを受け付ける',
    (score) => {
      expect(ratingScoreSchema().safeParse(score)).toEqual({
        success: true,
        data: score,
      });
    },
  );

  test.each([
    ['0', 0],
    ['6', 6],
    ['負の数', -1],
    ['小数', 2.5],
    ['NaN', Number.NaN],
    ['数字の文字列', '3'],
    ['null', null],
    ['未指定', undefined],
  ])('%sの評価の値を評価の文言で拒否する', (_, value) => {
    expect(issueMessagesOf(ratingScoreSchema().safeParse(value))).toEqual([
      RATING_SCORE_MESSAGE,
    ]);
  });
});

describe('COMMENT_BOT_ACTIONS', () => {
  test('投稿・編集・削除のbot対策の操作名を持ち、凍結されている', () => {
    expect(COMMENT_BOT_ACTIONS).toEqual({
      post: 'comment_post',
      edit: 'comment_edit',
      delete: 'comment_delete',
    });
    expect(Object.isFrozen(COMMENT_BOT_ACTIONS)).toBe(true);
  });
});

describe('commentIdScope', () => {
  test.each(COMMENT_IDS.map((commentId) => [commentId]))(
    'コメントのID%sから英小文字と数字の32文字以内の接頭辞を作る',
    (commentId) => {
      const scope = commentIdScope(commentId);

      expect(scope).toBe(`c${commentId.toLowerCase()}`);
      expect(scope).toMatch(ID_SCOPE_PATTERN);
    },
  );

  test('コメントのIDごとに異なり、説明文の接頭辞productと衝突しない', () => {
    const scopes = COMMENT_IDS.map(commentIdScope);

    expect(new Set(scopes).size).toBe(COMMENT_IDS.length);
    expect(scopes).not.toContain('product');
  });

  test('見出しのアンカーの接頭辞をコメントごとにuser-content-c<ULID>-の形にする', () => {
    const [first, second] = COMMENT_IDS;

    expect(idPrefixFor(commentIdScope(first))).toBe(
      'user-content-c01jf0comment00000000000001-',
    );
    expect(idPrefixFor(commentIdScope(second))).toBe(
      'user-content-c01jf0comment00000000000002-',
    );
  });
});

describe('commentComposerIdScope', () => {
  const [LAUNCH_ID, COMMENT_ID] = COMMENT_IDS;

  test.each<[Parameters<typeof commentComposerIdScope>[0], string]>([
    ['post', 'p'],
    ['reply', 'r'],
    ['edit', 'e'],
  ])(
    '%sの欄は対象のIDの小文字に%sを前置し、英小文字と数字の32文字以内にする',
    (mode, prefix) => {
      const scope = commentComposerIdScope(mode, LAUNCH_ID);

      expect(scope).toBe(`${prefix}${LAUNCH_ID.toLowerCase()}`);
      expect(scope).toMatch(ID_SCOPE_PATTERN);
    },
  );

  test('同じIDでも欄の種類ごとに異なり、コメントの本文・説明文の接頭辞と衝突しない', () => {
    const scopes = [
      commentComposerIdScope('post', COMMENT_ID),
      commentComposerIdScope('reply', COMMENT_ID),
      commentComposerIdScope('edit', COMMENT_ID),
    ];

    expect(new Set([...scopes, commentIdScope(COMMENT_ID)]).size).toBe(4);
    expect(scopes).not.toContain('product');
  });

  test('対象のIDごとに異なる', () => {
    const scopes = COMMENT_IDS.map((id) => commentComposerIdScope('reply', id));

    expect(new Set(scopes).size).toBe(COMMENT_IDS.length);
  });
});

describe('共有の文言', () => {
  test('キックオフ前のローンチのコメント欄の文言が文言規則と一致する', () => {
    expect(LAUNCH_NOT_COMMENTABLE_MESSAGE).toBe(
      'キックオフ後にコメントできるようになります。',
    );
  });

  test('自身のプロダクトの評価欄の文言が文言規則と一致する', () => {
    expect(OWN_PRODUCT_RATING_MESSAGE).toBe(
      '自身のプロダクトは評価できません。',
    );
  });
});
