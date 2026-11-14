import { describe, expect, test } from 'bun:test';

import type { LogRecord } from '@logtape/logtape';

import { objectConsoleFormatter, toLogObject } from './log-record.ts';

const TIMESTAMP = Date.UTC(2026, 9, 25, 3, 4, 5, 678);

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    category: ['api', 'application', 'rate-limit'],
    level: 'info',
    message: ['リクエストを処理しました'],
    rawMessage: 'リクエストを処理しました',
    timestamp: TIMESTAMP,
    properties: {},
    ...overrides,
  };
}

const QUERY = 'select "id" from "articles" where "title" like ? limit ?';
const QUERY_PARAMS = ['%検索語%', '本文の1行目\n本文の2行目', 20];
const REDACTED_QUERY_MESSAGE = `Failed query: ${QUERY}\nparams: [REDACTED]`;

// Drizzleは単文のクエリの失敗をこの名前と文言の形の例外で包む
class DrizzleQueryError extends Error {
  constructor(query: string, params?: readonly unknown[]) {
    super(
      params
        ? `Failed query: ${query}\nparams: ${params.join(',')}`
        : `Failed query: ${query}`,
    );
    this.name = 'DrizzleQueryError';
  }
}

function createQueryError(
  query: string,
  params?: readonly unknown[],
): DrizzleQueryError {
  return new DrizzleQueryError(query, params);
}

function expectedRedactedStack(error: Error): string {
  const stack = error.stack ?? '';
  const start = stack.indexOf(error.message);
  expect(start).toBeGreaterThanOrEqual(0);
  return `${stack.slice(0, start)}${REDACTED_QUERY_MESSAGE}${stack.slice(start + error.message.length)}`;
}

function expectNoQueryParams(logObject: unknown): void {
  const output = JSON.stringify(logObject);
  expect(output).not.toContain('検索語');
  expect(output).not.toContain('本文');
}

function templateStrings(...parts: string[]): TemplateStringsArray {
  return Object.assign([...parts], { raw: [...parts] });
}

describe('toLogObject', () => {
  test('時刻をUTCのISO 8601、カテゴリを点で連結した文字列にし、レベルとメッセージを持たせる', () => {
    const logObject = toLogObject(createRecord({ level: 'warning' }));

    expect(logObject).toEqual({
      time: '2026-10-25T03:04:05.678Z',
      level: 'warning',
      category: 'api.application.rate-limit',
      message: 'リクエストを処理しました',
    });
  });

  test('構造化した属性と文脈を最上位のフィールドに並べる', () => {
    const logObject = toLogObject(
      createRecord({
        properties: {
          correlationId: '01JBXQ5V7Z8K3M4N5P6Q7R8S9T',
          durationMs: 12,
          route: { method: 'GET', path: '/health' },
        },
      }),
    );

    expect(logObject.correlationId).toBe('01JBXQ5V7Z8K3M4N5P6Q7R8S9T');
    expect(logObject.durationMs).toBe(12);
    expect(logObject.route).toEqual({ method: 'GET', path: '/health' });
  });

  test('属性と同じ名前でも、時刻・レベル・カテゴリ・メッセージはログ1件の値を保つ', () => {
    const logObject = toLogObject(
      createRecord({
        properties: {
          time: 'x',
          level: 'x',
          category: 'x',
          message: 'x',
          other: 'kept',
        },
      }),
    );

    expect(logObject.time).toBe('2026-10-25T03:04:05.678Z');
    expect(logObject.level).toBe('info');
    expect(logObject.category).toBe('api.application.rate-limit');
    expect(logObject.message).toBe('リクエストを処理しました');
    expect(logObject.other).toBe('kept');
  });

  test('メッセージの差し込み値を、文字列はそのまま、それ以外はJSONで埋め込む', () => {
    const logObject = toLogObject(
      createRecord({
        rawMessage: '{kind}の処理が{count}件で{detail}を返した',
        message: [
          '',
          'cleanup',
          'の処理が',
          3,
          '件で',
          { ok: true },
          'を返した',
        ],
      }),
    );

    expect(logObject.message).toBe('cleanupの処理が3件で{"ok":true}を返した');
  });

  test('タグ付きテンプレートのメッセージも1つの文字列にする', () => {
    const logObject = toLogObject(
      createRecord({
        rawMessage: templateStrings('ジョブ', 'が', 'ミリ秒で終わった'),
        message: ['ジョブ', 'daily-cleanup', 'が', 1500, 'ミリ秒で終わった'],
      }),
    );

    expect(logObject.message).toBe('ジョブdaily-cleanupが1500ミリ秒で終わった');
  });

  test('JSONにできない差し込み値も文字列にして埋め込む', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const logObject = toLogObject(
      createRecord({
        message: ['', 10n, ' ', undefined, ' ', null, ' ', circular, ''],
      }),
    );

    expect(logObject.message).toBe('10 undefined null [object Object]');
  });

  test('差し込み値の例外を名前とメッセージの文字列にする', () => {
    const logObject = toLogObject(
      createRecord({
        message: ['失敗: ', new TypeError('不正な値'), ''],
      }),
    );

    expect(logObject.message).toBe('失敗: TypeError: 不正な値');
  });

  test('属性の例外を、名前・メッセージ・スタックトレース・原因を持つJSONにできるオブジェクトにする', () => {
    const cause = new RangeError('範囲外');
    const error = new Error('処理に失敗しました', { cause });

    const logObject = toLogObject(createRecord({ properties: { error } }));
    const serialized = JSON.parse(JSON.stringify(logObject)) as Record<
      string,
      unknown
    >;

    expect(serialized.error).toEqual({
      name: 'Error',
      message: '処理に失敗しました',
      stack: error.stack,
      cause: { name: 'RangeError', message: '範囲外', stack: cause.stack },
    });
    expect(logObject.error).not.toBeInstanceOf(Error);
  });

  test.each([
    ['文字列', 'タイムアウト'],
    ['数値', 504],
    ['真偽値', false],
  ])('原因の%sはそのまま残す', (_name, cause) => {
    const error = new Error('失敗', { cause });

    const logObject = toLogObject(createRecord({ properties: { error } }));

    expect(logObject.error).toMatchObject({
      name: 'Error',
      message: '失敗',
      cause,
    });
  });

  test.each([
    ['オブジェクト', { status: 504 }],
    ['配列', ['a']],
    ['null', null],
    ['BigInt', 10n],
  ])('原因の%sは出力しない', (_name, cause) => {
    const error = new Error('失敗', { cause });

    const logObject = toLogObject(createRecord({ properties: { error } }));

    expect(logObject.error).toEqual({
      name: 'Error',
      message: '失敗',
      stack: error.stack,
    });
  });

  test('原因が循環する例外は、循環した先の原因を出力しない', () => {
    const error = new Error('外側');
    const inner = new Error('内側', { cause: error });
    error.cause = inner;

    const logObject = toLogObject(createRecord({ properties: { error } }));

    expect(logObject.error).toEqual({
      name: 'Error',
      message: '外側',
      stack: error.stack,
      cause: { name: 'Error', message: '内側', stack: inner.stack },
    });
  });

  describe('データベースのクエリの失敗の例外', () => {
    test('messageとstackのバインドした値を伏せ、SQL文とスタックトレースのフレームは残す', () => {
      const error = createQueryError(QUERY, QUERY_PARAMS);

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toEqual({
        name: 'DrizzleQueryError',
        message: REDACTED_QUERY_MESSAGE,
        stack: expectedRedactedStack(error),
      });
      expectNoQueryParams(logObject);
    });

    test('原因の連鎖の中の例外のバインドした値も伏せる', () => {
      const queryError = createQueryError(QUERY, QUERY_PARAMS);
      const error = new Error('操作の実行に失敗しました', {
        cause: queryError,
      });

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toEqual({
        name: 'Error',
        message: '操作の実行に失敗しました',
        stack: error.stack,
        cause: {
          name: 'DrizzleQueryError',
          message: REDACTED_QUERY_MESSAGE,
          stack: expectedRedactedStack(queryError),
        },
      });
      expectNoQueryParams(logObject);
    });

    test('文言を写して包んだ別の名前の例外のバインドした値も伏せる', () => {
      const queryError = createQueryError(QUERY, QUERY_PARAMS);
      const error = Object.assign(
        new Error(queryError.message, { cause: queryError }),
        { name: 'GraphQLError' },
      );

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toMatchObject({
        name: 'GraphQLError',
        message: REDACTED_QUERY_MESSAGE,
        cause: { message: REDACTED_QUERY_MESSAGE },
      });
      expectNoQueryParams(logObject);
    });

    test('値の後にフレームの形の行が続いても、値の部分を残さない', () => {
      const error = createQueryError(QUERY, [
        '本文の1行目\n    at 本文に書いたフレームの形の行',
      ]);

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toMatchObject({
        message: REDACTED_QUERY_MESSAGE,
        stack: expectedRedactedStack(error),
      });
      expect(JSON.stringify(logObject)).not.toContain('本文');
    });

    test('バインドした値が無い文言は変えない', () => {
      const error = createQueryError(QUERY);

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toEqual({
        name: 'DrizzleQueryError',
        message: `Failed query: ${QUERY}`,
        stack: error.stack,
      });
    });

    test.each([
      ['params:を含む他の例外', '検索に失敗しました\nparams: 値'],
      [
        'クエリの失敗の文言で始まらない例外',
        `前置き Failed query: x\nparams: 値`,
      ],
    ])('%sの文言は変えない', (_name, message) => {
      const error = new Error(message);

      const logObject = toLogObject(createRecord({ properties: { error } }));

      expect(logObject.error).toEqual({
        name: 'Error',
        message,
        stack: error.stack,
      });
    });
  });

  test('例外の独自のプロパティは出力しない', () => {
    const error = Object.assign(new Error('失敗'), { code: 'E_FAIL' });

    const logObject = toLogObject(createRecord({ properties: { error } }));

    expect(logObject.error).toEqual({
      name: 'Error',
      message: '失敗',
      stack: error.stack,
    });
  });
});

describe('objectConsoleFormatter', () => {
  test('ログ1件のオブジェクトだけをコンソールへ渡す引数にする', () => {
    const record = createRecord({ properties: { correlationId: 'abc' } });

    const output = objectConsoleFormatter(record);

    expect(output).toEqual([toLogObject(record)]);
  });
});
