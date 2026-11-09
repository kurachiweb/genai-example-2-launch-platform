import { describe, expect, test } from 'bun:test';

import { markdownTextSchema } from '../validation/markdown-text-schema.ts';
import {
  checkHandleFormat,
  IMPERSONATION_RESERVED_HANDLES,
  isReservedHandle,
} from '../handles/handle-rules.ts';
import {
  checkProductName,
  checkScreenshotTotals,
  checkTagline,
  LAUNCH_DATE_HORIZON_DAYS,
  PRODUCT_CATEGORY_HANDLE_MESSAGES,
  PRODUCT_CATEGORY_HANDLE_RULE,
  PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  PRODUCT_DESCRIPTION_RULE,
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_HANDLE_RULE,
  PRODUCT_LOGO_MAX_BYTES,
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_NAME_MAX_GRAPHEMES,
  PRODUCT_NAME_MESSAGES,
  PRODUCT_SCREENSHOT_MAX_BYTES,
  PRODUCT_SCREENSHOT_PURPOSE,
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
  PRODUCT_TAGLINE_MAX_GRAPHEMES,
  PRODUCT_TAGLINE_MESSAGES,
  type RequiredTextCheck,
} from './product-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304B\u3099';

const VARIATION_SELECTOR_KANJI = '\u845B\u{e0101}';

const SURROUNDING_SPACES = ' \u3000\t\r\n';

describe('定数', () => {
  test('要件の上限・用途・ローンチ日の上限(仮4)・スクリーンショットの枚数(仮6)と一致する', () => {
    expect({
      PRODUCT_NAME_MAX_GRAPHEMES,
      PRODUCT_TAGLINE_MAX_GRAPHEMES,
      PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
      PRODUCT_LOGO_PURPOSE,
      PRODUCT_LOGO_MAX_BYTES,
      PRODUCT_SCREENSHOT_PURPOSE,
      PRODUCT_SCREENSHOT_MAX_BYTES,
      PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
      PRODUCT_SCREENSHOTS_MAX,
      LAUNCH_DATE_HORIZON_DAYS,
    }).toEqual({
      PRODUCT_NAME_MAX_GRAPHEMES: 50,
      PRODUCT_TAGLINE_MAX_GRAPHEMES: 100,
      PRODUCT_DESCRIPTION_MAX_GRAPHEMES: 20_000,
      PRODUCT_LOGO_PURPOSE: 'product-logo',
      PRODUCT_LOGO_MAX_BYTES: 512_000,
      PRODUCT_SCREENSHOT_PURPOSE: 'product-screenshot',
      PRODUCT_SCREENSHOT_MAX_BYTES: 5_242_880,
      PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES: 10_485_760,
      PRODUCT_SCREENSHOTS_MAX: 20,
      LAUNCH_DATE_HORIZON_DAYS: 90,
    });
  });
});

describe('PRODUCT_HANDLE_RULE', () => {
  test('上限は50文字で、予約語はなりすましの14語である', () => {
    expect(PRODUCT_HANDLE_RULE.maxLength).toBe(50);
    expect(PRODUCT_HANDLE_RULE.reservedWords).toEqual(
      IMPERSONATION_RESERVED_HANDLES,
    );
    expect(PRODUCT_HANDLE_RULE.reservedWords).toHaveLength(14);
  });

  test('50文字を受け付け、51文字を長すぎると判定する', () => {
    expect(checkHandleFormat('a'.repeat(50), PRODUCT_HANDLE_RULE)).toBe('ok');
    expect(checkHandleFormat('a'.repeat(51), PRODUCT_HANDLE_RULE)).toBe(
      'too-long',
    );
  });

  test.each(IMPERSONATION_RESERVED_HANDLES.map((word) => [word]))(
    '予約語%sを大文字小文字を区別せずに予約語と判定する',
    (word) => {
      expect(isReservedHandle(word, PRODUCT_HANDLE_RULE)).toBe(true);
      expect(isReservedHandle(word.toUpperCase(), PRODUCT_HANDLE_RULE)).toBe(
        true,
      );
    },
  );

  test('予約語と完全に一致しないハンドルは予約語としない', () => {
    expect(isReservedHandle('admin1', PRODUCT_HANDLE_RULE)).toBe(false);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(PRODUCT_HANDLE_RULE)).toBe(true);
  });
});

describe('PRODUCT_CATEGORY_HANDLE_RULE', () => {
  test('上限は50文字で、予約語を持たない', () => {
    expect(PRODUCT_CATEGORY_HANDLE_RULE.maxLength).toBe(50);
    expect(PRODUCT_CATEGORY_HANDLE_RULE.reservedWords).toEqual([]);
  });

  test('50文字を受け付け、51文字を長すぎると判定する', () => {
    expect(
      checkHandleFormat('a'.repeat(50), PRODUCT_CATEGORY_HANDLE_RULE),
    ).toBe('ok');
    expect(
      checkHandleFormat('a'.repeat(51), PRODUCT_CATEGORY_HANDLE_RULE),
    ).toBe('too-long');
  });

  test.each(IMPERSONATION_RESERVED_HANDLES.map((word) => [word]))(
    'なりすましの予約語%sもカテゴリのハンドルでは予約語としない',
    (word) => {
      expect(isReservedHandle(word, PRODUCT_CATEGORY_HANDLE_RULE)).toBe(false);
    },
  );

  test('一覧と予約語は凍結されている', () => {
    expect(Object.isFrozen(PRODUCT_CATEGORY_HANDLE_RULE)).toBe(true);
    expect(Object.isFrozen(PRODUCT_CATEGORY_HANDLE_RULE.reservedWords)).toBe(
      true,
    );
  });
});

describe('ハンドルの違反の文言', () => {
  const EXPECTED_HANDLE_MESSAGES = {
    ok: undefined,
    empty: 'ハンドルを入力してください。',
    'too-long': 'ハンドルは50文字以内で入力してください。',
    'invalid-characters':
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  };

  test.each([
    ['プロダクト', PRODUCT_HANDLE_MESSAGES],
    ['プロダクトカテゴリ', PRODUCT_CATEGORY_HANDLE_MESSAGES],
  ] as const)(
    '%sのハンドルの全ての判定の結果に対応する文言規則の文言を持ち、凍結されている',
    (_, messages) => {
      expect(messages).toEqual(EXPECTED_HANDLE_MESSAGES);
      expect(Object.isFrozen(messages)).toBe(true);
    },
  );

  test.each([
    ['プロダクト', PRODUCT_HANDLE_RULE, PRODUCT_HANDLE_MESSAGES],
    [
      'プロダクトカテゴリ',
      PRODUCT_CATEGORY_HANDLE_RULE,
      PRODUCT_CATEGORY_HANDLE_MESSAGES,
    ],
  ] as const)('%sのハンドルの判定の結果で文言を引ける', (_, rule, messages) => {
    expect(messages[checkHandleFormat('pitch-notes', rule)]).toBeUndefined();
    expect(messages[checkHandleFormat('', rule)]).toBe(messages.empty);
    expect(messages[checkHandleFormat('a'.repeat(51), rule)]).toBe(
      messages['too-long'],
    );
    expect(messages[checkHandleFormat('-notes', rule)]).toBe(
      messages['invalid-characters'],
    );
  });
});

const TEXT_RULES: readonly (readonly [
  string,
  (value: string) => RequiredTextCheck,
  number,
])[] = [
  ['名称', checkProductName, 50],
  ['タグライン', checkTagline, 100],
];

describe.each(TEXT_RULES)('%sの判定', (_, check, max) => {
  test.each([
    ['1書記素', 'a'],
    ['半角英字の上限ちょうど', 'a'.repeat(max)],
    ['ZWJで結合した絵文字の上限ちょうど', FAMILY_EMOJI.repeat(max)],
    ['結合文字の濁点の上限ちょうど', COMBINED_KANA.repeat(max)],
    [
      '異体字セレクタ付きの漢字の上限ちょうど',
      VARIATION_SELECTOR_KANJI.repeat(max),
    ],
    [
      '前後の空白を除いて上限ちょうど',
      `${SURROUNDING_SPACES}${'あ'.repeat(max)}${SURROUNDING_SPACES}`,
    ],
  ])('%sをokと判定する', (__, value) => {
    expect(check(value)).toBe('ok');
  });

  test.each([
    ['半角英字の上限+1', 'a'.repeat(max + 1)],
    ['ZWJで結合した絵文字の上限+1', FAMILY_EMOJI.repeat(max + 1)],
    ['結合文字の濁点の上限+1', COMBINED_KANA.repeat(max + 1)],
    ['途中の空白を含めて上限+1', `${'あ'.repeat(max - 1)} あ`],
  ])('%sをtoo-longと判定する', (__, value) => {
    expect(check(value)).toBe('too-long');
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
    ['上限を超える数の空白だけ', ' '.repeat(max + 10)],
  ])('%sをemptyと判定する', (__, value) => {
    expect(check(value)).toBe('empty');
  });

  test.each([
    ['NUL', 'a\u0000b'],
    ['C0制御文字', 'a\u0001b'],
    ['DEL', 'a\u007fb'],
    ['C1制御文字', 'a\u0085b'],
    ['対になっていないサロゲート', 'a\ud800b'],
  ])('%sをforbidden-charactersと判定する', (__, value) => {
    expect(check(value)).toBe('forbidden-characters');
  });

  describe('判定の順', () => {
    test('空白に囲まれた使用できない文字だけの入力を空でなく使用できない文字と判定する', () => {
      expect(check('  \u0001  ')).toBe('forbidden-characters');
    });

    test.each([
      ['先頭のVT', '\u000ba'],
      ['末尾のFF', 'a\u000c'],
      ['末尾のNEL', 'a\u0085'],
      ['VTだけ', '\u000b'],
    ])(
      '空白でもある制御文字(%s)を前後の空白として除かずに使用できない文字と判定する',
      (__, value) => {
        expect(check(value)).toBe('forbidden-characters');
      },
    );

    test('使用できない文字を長さより先に判定する', () => {
      expect(check(`${'a'.repeat(max + 1)}\u0001`)).toBe(
        'forbidden-characters',
      );
    });

    test('空白だけで上限を超える入力を長すぎるでなく空と判定する', () => {
      expect(check('\u3000'.repeat(max + 1))).toBe('empty');
    });
  });
});

describe('要件の境界の値', () => {
  test.each([
    ['名称の50書記素', checkProductName, 'あ'.repeat(50), 'ok'],
    ['名称の51書記素', checkProductName, 'あ'.repeat(51), 'too-long'],
    ['タグラインの100書記素', checkTagline, 'あ'.repeat(100), 'ok'],
    ['タグラインの101書記素', checkTagline, 'あ'.repeat(101), 'too-long'],
  ] as const)('%sを判定する', (_, check, value, expected) => {
    expect(check(value)).toBe(expected);
  });
});

describe('違反の文言', () => {
  test.each([
    [
      '名称',
      PRODUCT_NAME_MESSAGES,
      {
        ok: undefined,
        empty: '名称を入力してください。',
        'too-long': '名称は50文字以内で入力してください。',
        'forbidden-characters': '名称に使用できない文字が含まれています。',
      },
    ],
    [
      'タグライン',
      PRODUCT_TAGLINE_MESSAGES,
      {
        ok: undefined,
        empty: 'タグラインを入力してください。',
        'too-long': 'タグラインは100文字以内で入力してください。',
        'forbidden-characters':
          'タグラインに使用できない文字が含まれています。',
      },
    ],
  ] as const)(
    '%sの全ての判定の結果に対応する文言を持ち、凍結されている',
    (_, messages, expected) => {
      expect(messages).toEqual(expected);
      expect(Object.keys(messages).sort()).toEqual(
        ['empty', 'forbidden-characters', 'ok', 'too-long'].sort(),
      );
      expect(Object.isFrozen(messages)).toBe(true);
    },
  );

  test.each([
    ['名称', checkProductName, PRODUCT_NAME_MESSAGES],
    ['タグライン', checkTagline, PRODUCT_TAGLINE_MESSAGES],
  ] as const)('%sの判定の結果で文言を引ける', (_, check, messages) => {
    expect(messages[check('a')]).toBeUndefined();
    expect(messages[check('')]).toBe(messages.empty);
    expect(messages[check('a'.repeat(101))]).toBe(messages['too-long']);
    expect(messages[check('\u0000')]).toBe(messages['forbidden-characters']);
  });
});

describe('checkScreenshotTotals', () => {
  const MEBIBYTE = 1_048_576;

  test('スクリーンショットが無ければokと判定する', () => {
    expect(checkScreenshotTotals([])).toBe('ok');
  });

  test('20枚を受け付け、21枚をtoo-manyと判定する', () => {
    expect(checkScreenshotTotals(Array.from({ length: 20 }, () => 1))).toBe(
      'ok',
    );
    expect(checkScreenshotTotals(Array.from({ length: 21 }, () => 1))).toBe(
      'too-many',
    );
  });

  test('合計10,485,760バイトを受け付け、10,485,761バイトをtoo-largeと判定する', () => {
    expect(checkScreenshotTotals([5 * MEBIBYTE, 5 * MEBIBYTE])).toBe('ok');
    expect(checkScreenshotTotals([5 * MEBIBYTE, 5 * MEBIBYTE, 1])).toBe(
      'too-large',
    );
    expect(checkScreenshotTotals([10_485_760])).toBe('ok');
    expect(checkScreenshotTotals([10_485_761])).toBe('too-large');
  });

  test('枚数と合計の両方を超える場合は枚数の超過を先に示す', () => {
    expect(
      checkScreenshotTotals(Array.from({ length: 21 }, () => MEBIBYTE)),
    ).toBe('too-many');
  });
});

describe('PRODUCT_DESCRIPTION_RULE', () => {
  test('説明文は必須で20,000文字までのマークダウンとして、文言規則の文言で拒否する', () => {
    const schema = markdownTextSchema(PRODUCT_DESCRIPTION_RULE);

    expect(PRODUCT_DESCRIPTION_RULE).toEqual({
      label: '説明文',
      maxGraphemes: PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
      required: true,
    });
    expect(Object.isFrozen(PRODUCT_DESCRIPTION_RULE)).toBe(true);
    expect(schema.safeParse('# 概要').success).toBe(true);
    expect(schema.safeParse('あ'.repeat(20_000)).success).toBe(true);
    expect(schema.safeParse(' \n').error?.issues[0]?.message).toBe(
      '説明文を入力してください。',
    );
    expect(
      schema.safeParse('あ'.repeat(20_001)).error?.issues[0]?.message,
    ).toBe('説明文は20,000文字以内で入力してください。');
    expect(schema.safeParse('概要\u0000').error?.issues[0]?.message).toBe(
      '説明文に使用できない文字が含まれています。',
    );
  });
});
