import { describe, expect, test } from 'bun:test';

import {
  checkHandleFormat,
  IMPERSONATION_RESERVED_HANDLES,
  isReservedHandle,
} from '../handles/handle-rules.ts';
import { markdownTextSchema } from '../validation/markdown-text-schema.ts';
import {
  checkHelpSearchQuery,
  checkHelpSubtitle,
  checkHelpTitle,
  HELP_ARTICLE_EXTERNAL_LINK_REL,
  HELP_ARTICLE_HANDLE_RULE,
  HELP_BODY_MAX,
  HELP_BODY_RULE,
  HELP_REORDER_MAX,
  HELP_SEARCH_COUNTER_FROM,
  HELP_SEARCH_QUERY_MAX,
  HELP_SEARCH_RESULT_LIMIT,
  HELP_SUBTITLE_MAX,
  HELP_TITLE_MAX,
  type HelpTextCheck,
} from './help-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304B\u3099';

const SURROUNDING_SPACES = ' \u3000\t\r\n';

describe('定数', () => {
  test('要件の上限・検索の件数・並べ替えの件数の上限と一致する', () => {
    expect({
      HELP_TITLE_MAX,
      HELP_SUBTITLE_MAX,
      HELP_BODY_MAX,
      HELP_SEARCH_QUERY_MAX,
      HELP_SEARCH_COUNTER_FROM,
      HELP_SEARCH_RESULT_LIMIT,
      HELP_REORDER_MAX,
    }).toEqual({
      HELP_TITLE_MAX: 100,
      HELP_SUBTITLE_MAX: 100,
      HELP_BODY_MAX: 100_000,
      HELP_SEARCH_QUERY_MAX: 50,
      HELP_SEARCH_COUNTER_FROM: 40,
      HELP_SEARCH_RESULT_LIMIT: 100,
      HELP_REORDER_MAX: 1_000,
    });
  });

  test('本文の別オリジンへのリンクにはnoopenerだけを付け、凍結されている', () => {
    expect(HELP_ARTICLE_EXTERNAL_LINK_REL).toEqual(['noopener']);
    expect(Object.isFrozen(HELP_ARTICLE_EXTERNAL_LINK_REL)).toBe(true);
  });
});

describe('HELP_ARTICLE_HANDLE_RULE', () => {
  test('上限は50文字で、予約語を持たない', () => {
    expect(HELP_ARTICLE_HANDLE_RULE.maxLength).toBe(50);
    expect(HELP_ARTICLE_HANDLE_RULE.reservedWords).toEqual([]);
  });

  test('50文字を受け付け、51文字を長すぎると判定する', () => {
    expect(checkHandleFormat('a'.repeat(50), HELP_ARTICLE_HANDLE_RULE)).toBe(
      'ok',
    );
    expect(checkHandleFormat('a'.repeat(51), HELP_ARTICLE_HANDLE_RULE)).toBe(
      'too-long',
    );
  });

  test.each([['admin'], ['Support'], ['launchstadium']])(
    'ユーザー・プロダクトの予約語%sも形式の検査を通り、予約語としない',
    (word) => {
      expect(checkHandleFormat(word, HELP_ARTICLE_HANDLE_RULE)).toBe('ok');
      expect(isReservedHandle(word, HELP_ARTICLE_HANDLE_RULE)).toBe(false);
    },
  );

  test.each(IMPERSONATION_RESERVED_HANDLES.map((word) => [word]))(
    'なりすましの予約語%sを予約語としない',
    (word) => {
      expect(isReservedHandle(word, HELP_ARTICLE_HANDLE_RULE)).toBe(false);
    },
  );

  test.each([
    ['空文字列', '', 'empty'],
    ['記号で始まる', '-getting-started', 'invalid-characters'],
    ['空白を含む', 'getting started', 'invalid-characters'],
    ['ASCII以外の文字', 'はじめに', 'invalid-characters'],
  ] as const)('%sのハンドルを拒否する', (_, value, expected) => {
    expect(checkHandleFormat(value, HELP_ARTICLE_HANDLE_RULE)).toBe(expected);
  });

  test('規則と予約語は凍結されている', () => {
    expect(Object.isFrozen(HELP_ARTICLE_HANDLE_RULE)).toBe(true);
    expect(Object.isFrozen(HELP_ARTICLE_HANDLE_RULE.reservedWords)).toBe(true);
  });
});

describe('HELP_BODY_RULE', () => {
  test('本文は必須で100,000書記素以内とし、凍結されている', () => {
    expect(HELP_BODY_RULE).toEqual({
      label: '本文',
      maxGraphemes: 100_000,
      required: true,
    });
    expect(Object.isFrozen(HELP_BODY_RULE)).toBe(true);
  });

  test('100,000書記素の本文を受け付け、100,001書記素の本文を拒否する', () => {
    const schema = markdownTextSchema(HELP_BODY_RULE);

    expect(schema.safeParse('あ'.repeat(100_000)).success).toBe(true);
    expect(schema.safeParse('あ'.repeat(100_001)).error?.issues).toEqual([
      expect.objectContaining({
        message: '本文は100,000文字以内で入力してください。',
      }),
    ]);
  });

  test('空白だけの本文を拒否する', () => {
    expect(
      markdownTextSchema(HELP_BODY_RULE).safeParse(' \n　').error?.issues,
    ).toEqual([
      expect.objectContaining({ message: '本文を入力してください。' }),
    ]);
  });
});

const TEXT_RULES: readonly (readonly [
  string,
  (value: string) => HelpTextCheck | undefined,
])[] = [
  ['タイトル', checkHelpTitle],
  ['サブタイトル', checkHelpSubtitle],
];

describe.each(TEXT_RULES)('%sの判定', (_, check) => {
  test.each([
    ['1書記素', 'a'],
    ['100書記素', 'あ'.repeat(100)],
    ['ZWJで結合した絵文字の100書記素', FAMILY_EMOJI.repeat(100)],
    ['結合文字の濁点の100書記素', COMBINED_KANA.repeat(100)],
    [
      '前後の空白を除いて100書記素',
      `${SURROUNDING_SPACES}${'あ'.repeat(100)}${SURROUNDING_SPACES}`,
    ],
  ])('%sを受け付ける', (__, value) => {
    expect(check(value)).toBeUndefined();
  });

  test.each([
    ['101書記素', 'あ'.repeat(101)],
    ['ZWJで結合した絵文字の101書記素', FAMILY_EMOJI.repeat(101)],
    ['途中の空白を含めて101書記素', `${'あ'.repeat(99)} あ`],
  ])('%sをtoo-longと判定する', (__, value) => {
    expect(check(value)).toBe('too-long');
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白・タブ・改行だけ', '　\t\r\n　'],
    ['上限を超える数の空白だけ', ' '.repeat(110)],
  ])('%sをemptyと判定する', (__, value) => {
    expect(check(value)).toBe('empty');
  });

  test.each([
    ['NUL', 'a\u0000b'],
    ['C0制御文字', 'a\u0001b'],
    ['DEL', 'a\u007fb'],
    ['C1制御文字', 'a\u0085b'],
    ['対になっていないサロゲート', 'a\ud800b'],
    ['先頭のVT', '\u000ba'],
    ['空白に囲まれた制御文字だけ', '  \u0001  '],
  ])('%sをforbidden-charactersと判定する', (__, value) => {
    expect(check(value)).toBe('forbidden-characters');
  });

  test('使用できない文字を長さより先に判定する', () => {
    expect(check(`${'a'.repeat(101)}\u0001`)).toBe('forbidden-characters');
  });
});

describe('checkHelpSearchQuery', () => {
  test.each([
    ['空文字列', ''],
    ['50書記素', 'あ'.repeat(50)],
    ['ZWJで結合した絵文字の50書記素', FAMILY_EMOJI.repeat(50)],
    ['前後の空白を除いて50書記素', `  ${'あ'.repeat(50)}\u3000`],
  ])('%sの検索語を受け付ける', (_, value) => {
    expect(checkHelpSearchQuery(value)).toBeUndefined();
  });

  test.each([
    ['51書記素', 'あ'.repeat(51)],
    ['ZWJで結合した絵文字の51書記素', FAMILY_EMOJI.repeat(51)],
    ['途中の空白を含めて51書記素', `${'あ'.repeat(25)} ${'あ'.repeat(25)}`],
  ])('%sの検索語をtoo-longと判定する', (_, value) => {
    expect(checkHelpSearchQuery(value)).toBe('too-long');
  });
});
