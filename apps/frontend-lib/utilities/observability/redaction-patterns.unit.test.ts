import { describe, expect, test } from 'bun:test';

import {
  REDACTED,
  REDACTION_PATTERNS,
  redactDeep,
  redactText,
} from './redaction-patterns.ts';

const API_KEY = `lsk_${'AbCdEfGhIj'.repeat(4)}K_-`;
const LUHN_VALID_CARD_NUMBER = '4111111111111111';
const LUHN_INVALID_CARD_NUMBER = '4111111111111112';
const API_KEY_WITH_CARD_NUMBER = `lsk_AbCdEfGhIjKl${LUHN_VALID_CARD_NUMBER}MnOpQrStUvWxYzA`;
const HYPHENATED_CARD_NUMBER = ['4111', '1111', '1111', '1111'].join('-');
// 区切りの中の数字の並びがLuhnの検査を通るカード番号の形になるUUID
const UUID_WITH_CARD_SHAPED_GROUPS = '015e5a15-444e-4123-8456-123451c99bf9';
const UUID_WITH_CARD_SHAPED_FIRST_GROUP =
  'abcd1234-5678-9012-3452-abcdefabcdef';
const UPPERCASE_UUID_WITH_CARD_SHAPED_GROUPS =
  '6F1C2B3A-9E8D-4012-8888-888881ABCDEF';

// シークレット検出が実物のトークンと誤検知しないよう、テスト用の値を部品から組み立てる
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIwMUpCWCJ9',
  'c2lnbmF0dXJlLXZhbHVlXy0',
].join('.');

describe('REDACTED', () => {
  test('伏せ字の文字列は[REDACTED]である', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});

describe('REDACTION_PATTERNS', () => {
  test('全てのパターンがgフラグ付きで、先頭がクエリの失敗の値、次が公開APIのキーのパターンである', () => {
    for (const { pattern } of REDACTION_PATTERNS) {
      expect(pattern.global).toBe(true);
    }
    expect(REDACTION_PATTERNS[0]?.pattern.source).toContain('Failed query: ');
    expect(REDACTION_PATTERNS[1]?.pattern.source).toContain('lsk_');
  });

  describe('データベースのクエリの失敗の文言', () => {
    const failedQuery =
      'Failed query: select "id" from "articles" where "title" like ?';
    const redactedQuery = `${failedQuery}\nparams: ${REDACTED}`;
    const frame = '    at search (article-search.ts:34:5)';

    test.each([
      ['改行を含む値', `${failedQuery}\nparams: 本文の1行目\n本文の2行目,20`],
      [
        'メールアドレスで始まりフレームの形の行が続く値',
        `${failedQuery}\nparams: user@mail.example\n    at 秘密の続き`,
      ],
      [
        '公開APIのキーで始まりフレームの形の行が続く値',
        `${failedQuery}\nparams: ${API_KEY}\n    at 秘密の続き`,
      ],
    ])('%sを伏せ、SQL文は残す', (_name, text) => {
      expect(redactText(text)).toBe(redactedQuery);
    });

    test.each([
      ['バインドした値が無い文言', failedQuery],
      ['伏せ字にした後の文言', `${redactedQuery}\n${frame}`],
      ['クエリの失敗の文言を含まないparams:', '検索に失敗しました\nparams: 値'],
    ])('%sは変えない', (_name, text) => {
      expect(redactText(text)).toBe(text);
    });
  });

  test('公開APIのキーのパターンを他のパターンより後へ動かすと、キーの断片が残る', () => {
    const apiKeyPattern = REDACTION_PATTERNS.find(({ pattern }) =>
      pattern.source.startsWith('lsk_'),
    );
    if (apiKeyPattern === undefined) {
      throw new Error('公開APIのキーのパターンがありません');
    }
    const others = REDACTION_PATTERNS.filter(
      (pattern) => pattern !== apiKeyPattern,
    );
    const reordered = [...others, apiKeyPattern];
    const redacted = reordered.reduce(
      (current, { pattern, replacement }) =>
        typeof replacement === 'string'
          ? current.replaceAll(pattern, replacement)
          : current.replaceAll(pattern, replacement),
      API_KEY_WITH_CARD_NUMBER,
    );

    expect(redacted).toContain('lsk_');
    expect(redactText(API_KEY_WITH_CARD_NUMBER)).toBe(REDACTED);
  });
});

describe('redactText', () => {
  test.each([
    ['IPv4', '接続元 203.0.113.7 から', `接続元 ${REDACTED} から`],
    ['文末のIPv4', '接続元は198.51.100.255.', `接続元は${REDACTED}.`],
    [
      'IPv6',
      '接続元 2001:db8:85a3::8a2e:370:7334 から',
      `接続元 ${REDACTED} から`,
    ],
    [
      '省略の無いIPv6',
      '[2001:0db8:85a3:0000:0000:8a2e:0370:7334]',
      `[${REDACTED}]`,
    ],
    ['ループバックのIPv6', 'host=::1', `host=${REDACTED}`],
    ['末尾を省略したIPv6', 'prefix fe80:: end', `prefix ${REDACTED} end`],
    [
      'Bearer',
      'Authorization: Bearer abc.DEF-123_~+/xyz==',
      `Authorization: ${REDACTED}`,
    ],
    [
      'メールアドレス',
      '宛先 member@mail.example に送信',
      `宛先 ${REDACTED} に送信`,
    ],
    ['JWT', `token=${JWT};`, `token=${REDACTED};`],
    [
      'カード番号',
      `カード ${LUHN_VALID_CARD_NUMBER} を登録`,
      `カード ${REDACTED} を登録`,
    ],
    [
      '区切り付きのカード番号',
      'カード 4111 1111 1111 1111 を登録',
      `カード ${REDACTED} を登録`,
    ],
    ['公開APIのキー', `キー ${API_KEY} を使用`, `キー ${REDACTED} を使用`],
  ])('%sを伏せ字にする', (_name, text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  test.each([
    ['Luhnの検査を通らない16桁の数字', `番号 ${LUHN_INVALID_CARD_NUMBER}`],
    ['lsk_で始まる短い値', 'キー lsk_short を使用'],
    ['時刻', '開始 12:34:56 終了 23:59:59'],
    ['日付', '業務日付 2026-10-25'],
    ['ISO 8601の日時', '2026-10-25T12:34:56.789Z'],
    ['名前空間の区切り', 'std::vector'],
    ['3つの数字の区切り', 'バージョン 1.2.3'],
    ['5つの数字の区切り', 'バージョン 1.2.3.4.5'],
    ['通常の文', '描画に失敗しました: GET /products/product-1 200 3ms'],
    ['Bearerだけの語', 'Bearer認証'],
    ['@を含むだけの語', '@scope/package を読み込めません'],
  ])('%sは残す', (_name, text) => {
    expect(redactText(text)).toBe(text);
  });

  test('Luhnの検査を通る番号だけを伏せ、隣の検査を通らない番号は残す', () => {
    expect(
      redactText(`${LUHN_VALID_CARD_NUMBER} と ${LUHN_INVALID_CARD_NUMBER}`),
    ).toBe(`${REDACTED} と ${LUHN_INVALID_CARD_NUMBER}`);
  });

  test.each([
    [
      '区切りの途中から始まる',
      UUID_WITH_CARD_SHAPED_GROUPS,
      '4123-8456-123451',
    ],
    [
      '先頭の区切りの途中から始まる',
      UUID_WITH_CARD_SHAPED_FIRST_GROUP,
      '1234-5678-9012-3452',
    ],
    [
      '大文字のUUIDの',
      UPPERCASE_UUID_WITH_CARD_SHAPED_GROUPS,
      '4012-8888-888881',
    ],
  ])(
    '%sカード番号の形の数字の並びは、UUIDの中では残す',
    (_name, uuid, cardShapedDigits) => {
      expect(redactText(`番号 ${cardShapedDigits}`)).toBe(`番号 ${REDACTED}`);
      expect(redactText(`相関ID ${uuid} の処理`)).toBe(`相関ID ${uuid} の処理`);
    },
  );

  test.each([
    ['文末のUUID', `相関ID ${UUID_WITH_CARD_SHAPED_GROUPS}`],
    ['前後に16進の文字が続くUUID', `ab${UUID_WITH_CARD_SHAPED_GROUPS}cd`],
    [
      '前後に-と16進の文字が続くUUID',
      `f0-${UUID_WITH_CARD_SHAPED_FIRST_GROUP}-a1`,
    ],
    [
      '並んだ2つのUUID',
      `${UUID_WITH_CARD_SHAPED_GROUPS},${UPPERCASE_UUID_WITH_CARD_SHAPED_GROUPS}`,
    ],
  ])('%sは、カード番号の形を含んでも残す', (_name, text) => {
    expect(redactText(text)).toBe(text);
  });

  test.each([
    [
      'UUIDの隣の区切り無しのカード番号',
      `${UUID_WITH_CARD_SHAPED_GROUPS} ${LUHN_VALID_CARD_NUMBER}`,
      `${UUID_WITH_CARD_SHAPED_GROUPS} ${REDACTED}`,
    ],
    [
      'UUIDの隣の空白区切りのカード番号',
      `${UUID_WITH_CARD_SHAPED_GROUPS} 4111 1111 1111 1111`,
      `${UUID_WITH_CARD_SHAPED_GROUPS} ${REDACTED}`,
    ],
    [
      'UUIDの隣のハイフン区切りのカード番号',
      `${UUID_WITH_CARD_SHAPED_GROUPS} ${HYPHENATED_CARD_NUMBER}`,
      `${UUID_WITH_CARD_SHAPED_GROUPS} ${REDACTED}`,
    ],
    [
      '16進の文字と-に続くカード番号',
      `card-${HYPHENATED_CARD_NUMBER}`,
      `card-${REDACTED}`,
    ],
  ])('UUIDの形でない%sは伏せ字にする', (_name, text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  test('同じ文字列を続けて伏せても結果が変わらない', () => {
    const text = '接続元 203.0.113.7 と member@mail.example';

    expect(redactText(text)).toBe(redactText(text));
  });
});

describe('redactDeep', () => {
  test('入れ子のオブジェクトと配列の中の文字列を伏せ、他の型の値は残す', () => {
    expect(
      redactDeep({
        message: '接続元 203.0.113.7',
        nested: { values: ['member@mail.example', 'plain', 3, true, null] },
        count: 1,
      }),
    ).toEqual({
      message: `接続元 ${REDACTED}`,
      nested: { values: [REDACTED, 'plain', 3, true, null] },
      count: 1,
    });
  });

  test('文字列そのものも伏せる', () => {
    expect(redactDeep('member@mail.example')).toBe(REDACTED);
  });

  test('循環するオブジェクトは祖先の位置を印に置き換えて打ち切る', () => {
    const circular: Record<string, unknown> = { note: '203.0.113.7' };
    circular['self'] = circular;
    circular['list'] = [circular];

    expect(redactDeep(circular)).toEqual({
      note: REDACTED,
      self: '[Circular ~]',
      list: ['[Circular ~]'],
    });
  });

  test('同じオブジェクトを兄弟の位置で共有していても循環とみなさない', () => {
    const shared = { address: '203.0.113.7' };

    expect(redactDeep({ first: shared, second: shared })).toEqual({
      first: { address: REDACTED },
      second: { address: REDACTED },
    });
  });

  test('素のオブジェクトと配列以外のオブジェクトはそのまま返す', () => {
    const date = new Date(Date.UTC(2026, 9, 25));
    const result = redactDeep({ date });

    expect(result.date).toBe(date);
  });

  test('元の値を書き換えない', () => {
    const value = { nested: { values: ['203.0.113.7'] } };

    redactDeep(value);

    expect(value).toEqual({ nested: { values: ['203.0.113.7'] } });
  });
});
