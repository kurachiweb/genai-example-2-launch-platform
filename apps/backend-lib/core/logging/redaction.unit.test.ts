import { describe, expect, test } from 'bun:test';

import type { LogRecord } from '@logtape/logtape';
import {
  DEFAULT_REDACT_FIELDS,
  redactByField,
  redactByPattern,
  type RedactionPatterns,
} from '@logtape/redaction';

import { type LogObject, objectConsoleFormatter } from './log-record.ts';
import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
  REDACTION_PATTERNS,
} from './redaction.ts';

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
const CAUSE_FIELD_VALUE = 'p-secret-value';
const TOKEN_FIELD_VALUE = 't-secret-value';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    category: ['api', 'application', 'auth'],
    level: 'info',
    message: ['リクエストを処理しました'],
    rawMessage: 'リクエストを処理しました',
    timestamp: Date.UTC(2026, 9, 25, 12, 34, 56, 789),
    properties: {},
    ...overrides,
  };
}

function emitWith(patterns: RedactionPatterns, record: LogRecord): LogObject {
  const outputs: (readonly unknown[])[] = [];
  const formatter = redactByPattern(objectConsoleFormatter, patterns);
  const sink = redactByField(
    (redactedRecord) => {
      outputs.push(formatter(redactedRecord));
    },
    { fieldPatterns: REDACTED_FIELD_PATTERNS, action: () => REDACTED },
  );
  sink(record);
  expect(outputs).toHaveLength(1);
  return outputs[0]?.[0] as LogObject;
}

function emit(record: LogRecord): LogObject {
  return emitWith(REDACTION_PATTERNS, record);
}

function redactMessage(text: string): string {
  return emit(createRecord({ message: [text], rawMessage: text })).message;
}

describe('REDACTED', () => {
  test('伏せ字の文字列は[REDACTED]である', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});

describe('REDACTED_FIELD_PATTERNS', () => {
  test('@logtape/redactionの既定のフィールドを全て含む', () => {
    for (const fieldPattern of DEFAULT_REDACT_FIELDS) {
      expect(REDACTED_FIELD_PATTERNS).toContain(fieldPattern);
    }
  });

  test.each([
    'ip',
    'ipAddress',
    'clientIp',
    'remoteIp',
    'email',
    'mail',
    'cookie',
    'set-cookie',
    'authorization',
    'token',
    'turnstileToken',
    'pepper',
    'secret',
    'password',
  ])('属性%sの値を伏せ字にする', (field) => {
    const logObject = emit(
      createRecord({ properties: { [field]: 'opaque-value' } }),
    );

    expect(logObject[field]).toBe(REDACTED);
  });

  test.each(['cookies', 'setCookie', 'requestCookies', 'Set-Cookie2'])(
    'Cookieを名前に含む属性%sの値を伏せ字にする',
    (field) => {
      const logObject = emit(
        createRecord({ properties: { [field]: 'opaque-value' } }),
      );

      expect(logObject[field]).toBe(REDACTED);
    },
  );

  test.each(['IP', 'ClientIP', 'MAIL', 'Cookie', 'Set-Cookie', 'PEPPER'])(
    '属性名%sも大文字小文字を区別せずに伏せ字にする',
    (field) => {
      const logObject = emit(
        createRecord({ properties: { [field]: 'opaque-value' } }),
      );

      expect(logObject[field]).toBe(REDACTED);
    },
  );

  test('入れ子の属性の値も伏せ字にする', () => {
    const logObject = emit(
      createRecord({
        properties: {
          request: { headers: { cookie: 'session=opaque', accept: '*/*' } },
        },
      }),
    );

    expect(logObject.request).toEqual({
      headers: { cookie: REDACTED, accept: '*/*' },
    });
  });

  test('対象のフィールド名を部分に含むだけの属性は残す', () => {
    const logObject = emit(
      createRecord({
        properties: {
          description: 'opaque-value',
          zip: 'opaque-value',
          status: 200,
        },
      }),
    );

    expect(logObject.description).toBe('opaque-value');
    expect(logObject.zip).toBe('opaque-value');
    expect(logObject.status).toBe(200);
  });

  test('対象のフィールドを差し込んだメッセージの値も伏せ字にする', () => {
    const logObject = emit(
      createRecord({
        rawMessage: 'bot判定の検証に失敗: {turnstileToken}',
        message: ['bot判定の検証に失敗: ', 'opaque-value', ''],
        properties: { turnstileToken: 'opaque-value' },
      }),
    );

    expect(logObject.message).toBe(`bot判定の検証に失敗: ${REDACTED}`);
  });
});

describe('REDACTION_PATTERNS', () => {
  test('全てのパターンがgフラグ付きで、公開APIのキーのパターンがクエリの失敗の値のパターンの次にある', () => {
    for (const { pattern } of REDACTION_PATTERNS) {
      expect(pattern.global).toBe(true);
    }
    expect(REDACTION_PATTERNS[1]?.pattern.source).toContain('lsk_');
  });

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
      '宛先 user@example.example に送信',
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
  ])('メッセージ中の%sを伏せ字にする', (_name, text, expected) => {
    expect(redactMessage(text)).toBe(expected);
  });

  test.each([
    ['Luhnの検査を通らない16桁の数字', `番号 ${LUHN_INVALID_CARD_NUMBER}`],
    ['lsk_で始まる短い値', 'キー lsk_short を使用'],
    ['lsk_と42文字の値', `キー ${API_KEY.slice(0, -1)} を使用`],
    ['時刻', '開始 12:34:56 終了 23:59:59'],
    ['日付', '業務日付 2026-10-25'],
    ['名前空間の区切り', 'std::vector'],
    ['3つの数字の区切り', 'バージョン 1.2.3'],
    ['通常の文', 'GET /health 200 3ms'],
  ])('メッセージ中の%sは残す', (_name, text) => {
    expect(redactMessage(text)).toBe(text);
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
      expect(redactMessage(`番号 ${cardShapedDigits}`)).toBe(
        `番号 ${REDACTED}`,
      );
      expect(redactMessage(`相関ID ${uuid} の処理`)).toBe(
        `相関ID ${uuid} の処理`,
      );
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
  ])('メッセージ中の%sは、カード番号の形を含んでも残す', (_name, text) => {
    expect(redactMessage(text)).toBe(text);
  });

  test('属性の値のUUIDは、カード番号の形を含んでも残す', () => {
    const logObject = emit(
      createRecord({
        properties: {
          correlationId: UUID_WITH_CARD_SHAPED_GROUPS,
          nested: { ids: [UUID_WITH_CARD_SHAPED_FIRST_GROUP] },
        },
      }),
    );

    expect(logObject.correlationId).toBe(UUID_WITH_CARD_SHAPED_GROUPS);
    expect(logObject.nested).toEqual({
      ids: [UUID_WITH_CARD_SHAPED_FIRST_GROUP],
    });
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
    expect(redactMessage(text)).toBe(expected);
  });

  test('Luhnの検査を通る番号だけを伏せ、隣の検査を通らない番号は残す', () => {
    expect(
      redactMessage(`${LUHN_VALID_CARD_NUMBER} と ${LUHN_INVALID_CARD_NUMBER}`),
    ).toBe(`${REDACTED} と ${LUHN_INVALID_CARD_NUMBER}`);
  });

  test('属性の値と入れ子の値に含まれる公開APIのキーとIPアドレスを伏せ字にする', () => {
    const logObject = emit(
      createRecord({
        properties: {
          detail: `received ${API_KEY}`,
          nested: { values: ['203.0.113.7', 'plain'] },
          ordinary: 'plain-value',
        },
      }),
    );

    expect(logObject.detail).toBe(`received ${REDACTED}`);
    expect(logObject.nested).toEqual({ values: [REDACTED, 'plain'] });
    expect(logObject.ordinary).toBe('plain-value');
  });

  test('属性の例外のメッセージに含まれる公開APIのキーを伏せ字にする', () => {
    const logObject = emit(
      createRecord({
        properties: { failure: new Error(`invalid ${API_KEY}`) },
      }),
    );

    expect(logObject.failure).toMatchObject({
      message: `invalid ${REDACTED}`,
    });
    expect(JSON.stringify(logObject)).not.toContain(API_KEY);
  });

  test('属性の例外の原因に入れたオブジェクトの値を出力しない', () => {
    const logObject = emit(
      createRecord({
        properties: {
          failure: new Error('x', {
            cause: { password: CAUSE_FIELD_VALUE, token: TOKEN_FIELD_VALUE },
          }),
        },
      }),
    );
    const output = JSON.stringify(logObject);

    expect(output).not.toContain(CAUSE_FIELD_VALUE);
    expect(output).not.toContain(TOKEN_FIELD_VALUE);
  });

  test('属性の例外の独自のプロパティを出力しない', () => {
    const failure = Object.assign(new Error('x'), {
      detail: { password: CAUSE_FIELD_VALUE },
    });

    const output = JSON.stringify(
      emit(createRecord({ properties: { failure } })),
    );

    expect(output).not.toContain(CAUSE_FIELD_VALUE);
  });

  test('時刻とカテゴリは伏せ字の対象にならない', () => {
    const logObject = emit(createRecord());

    expect(logObject.time).toBe('2026-10-25T12:34:56.789Z');
    expect(logObject.category).toBe('api.application.auth');
  });

  test('カード番号の形を含む公開APIのキーを1つの伏せ字にし、キーの断片を残さない', () => {
    const logObject = emit(
      createRecord({
        message: [`キー ${API_KEY_WITH_CARD_NUMBER} を拒否`],
        rawMessage: `キー ${API_KEY_WITH_CARD_NUMBER} を拒否`,
        properties: { detail: API_KEY_WITH_CARD_NUMBER },
      }),
    );

    expect(logObject.message).toBe(`キー ${REDACTED} を拒否`);
    expect(logObject.detail).toBe(REDACTED);
  });

  describe('データベースのクエリの失敗の文言', () => {
    const query = 'select "id" from "articles" where "title" like ? limit ?';
    const failedQuery = `Failed query: ${query}`;
    const redactedQuery = `${failedQuery}\nparams: ${REDACTED}`;
    const params = '%検索語%,本文の1行目\n本文の2行目,20';
    const frames = [
      '    at D1PreparedQuery.queryWithCache (session.js:12:3)',
      '    at async ArticleSearch.search (article-search.ts:34:5)',
    ].join('\n');

    test.each([
      [
        '例外を差し込んだメッセージ',
        `検索に失敗: DrizzleQueryError: ${failedQuery}\nparams: ${params}`,
        `検索に失敗: DrizzleQueryError: ${redactedQuery}`,
      ],
      [
        'フレームの形の行で終わる値',
        `${failedQuery}\nparams: 本文\n    at 本文のフレームの形の行`,
        redactedQuery,
      ],
      [
        'メールアドレスで始まりフレームの形の行が続く値',
        `${failedQuery}\nparams: user@mail.example\n    at 秘密の続き`,
        redactedQuery,
      ],
      [
        'IPアドレスで始まりタブのフレームの形の行が続く値',
        `${failedQuery}\nparams: 203.0.113.7\n\tat 秘密の続き`,
        redactedQuery,
      ],
      [
        '公開APIのキーで始まりフレームの形の行が続く値',
        `${failedQuery}\nparams: ${API_KEY}\n    at 秘密の続き`,
        redactedQuery,
      ],
    ])('%sのバインドした値を伏せ、SQL文は残す', (_name, text, expected) => {
      expect(redactMessage(text)).toBe(expected);
    });

    test('クエリの失敗の値のパターンは、他のパターンが値の一部を先に伏せないよう先頭にある', () => {
      expect(REDACTION_PATTERNS[0]?.pattern.source).toContain('Failed query: ');
    });

    test('属性の例外の値が文字どおりの伏せ字で始まりフレームの形の行が続いても、値を残さない', () => {
      const queryError = Object.assign(
        new Error(`${failedQuery}\nparams: ${REDACTED}\n    at 秘密の続き`),
        { name: 'DrizzleQueryError' },
      );

      const logObject = emit(createRecord({ properties: { queryError } }));

      expect(logObject.queryError).toMatchObject({ message: redactedQuery });
      expect(JSON.stringify(logObject)).not.toContain('秘密');
    });

    test('区切りの無いクエリの失敗の文言が繰り返されても、伏せ字の時間が文字列の長さの2乗で増えない', () => {
      const text = 'Failed query: '.repeat(20_000);
      const startedAt = performance.now();

      expect(redactMessage(text)).toBe(text);
      expect(performance.now() - startedAt).toBeLessThan(1000);
    });

    test('属性の文字列のスタックトレースは、値とフレームの境目が分からないため、バインドした値から末尾までを伏せる', () => {
      const logObject = emit(
        createRecord({
          properties: {
            detail: `DrizzleQueryError: ${failedQuery}\nparams: ${params}\n${frames}`,
          },
        }),
      );

      expect(logObject.detail).toBe(`DrizzleQueryError: ${redactedQuery}`);
    });

    test('属性の例外と原因の例外のmessageとstackにバインドした値を残さない', () => {
      const queryError = Object.assign(
        new Error(`${failedQuery}\nparams: ${params}`),
        { name: 'DrizzleQueryError' },
      );
      const failure = new Error('操作の実行に失敗しました', {
        cause: queryError,
      });

      const logObject = emit(
        createRecord({ properties: { failure, queryError } }),
      );
      const output = JSON.stringify(logObject);

      const serializedQueryError = logObject.queryError as {
        readonly message: string;
        readonly stack: string;
      };
      expect(serializedQueryError.message).toBe(redactedQuery);
      expect(serializedQueryError.stack).toContain(`${redactedQuery}\n    at `);
      expect(logObject.failure).toMatchObject({
        cause: { message: redactedQuery },
      });
      expect(output).not.toContain('検索語');
      expect(output).not.toContain('本文');
    });

    test.each([
      ['バインドした値が無い文言', failedQuery],
      ['伏せ字にした後の文言', `${redactedQuery}\n${frames}`],
      ['クエリの失敗の文言を含まないparams:', '検索に失敗しました\nparams: 値'],
      ['params:の前に改行の無い文言', `${failedQuery} params: 値`],
    ])('%sは変えない', (_name, text) => {
      expect(redactMessage(text)).toBe(text);
    });
  });

  test('公開APIのキーのパターンを他のパターンより後へ動かすと、カード番号の形を含むキーの断片が残る', () => {
    const apiKeyPattern = REDACTION_PATTERNS.find(({ pattern }) =>
      pattern.source.startsWith('lsk_'),
    );
    if (apiKeyPattern === undefined) {
      throw new Error('公開APIのキーのパターンがありません');
    }
    const otherPatterns = REDACTION_PATTERNS.filter(
      (pattern) => pattern !== apiKeyPattern,
    );
    const text = `キー ${API_KEY_WITH_CARD_NUMBER} を拒否`;

    const logObject = emitWith(
      [...otherPatterns, apiKeyPattern],
      createRecord({ message: [text], rawMessage: text }),
    );

    expect(logObject.message).not.toBe(`キー ${REDACTED} を拒否`);
    expect(logObject.message).toContain('lsk_AbCdEfGhIjKl');
  });
});
