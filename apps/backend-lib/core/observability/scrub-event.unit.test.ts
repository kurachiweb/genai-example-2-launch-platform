import { describe, expect, test } from 'bun:test';

import type {
  Breadcrumb,
  ErrorEvent,
  EventHint,
  SpanJSON,
  TransactionEvent,
} from '@sentry/core';

import { AppError } from '../errors/app-error.ts';
import { REDACTED } from '../logging/redaction.ts';
import { scrubEvent, scrubTransaction } from './scrub-event.ts';

const API_KEY = `lsk_${'AbCdEfGhIj'.repeat(4)}K_-`;
const LUHN_VALID_CARD_NUMBER = '4111111111111111';
const NO_HINT: EventHint = {};

// Sentryが利用者のIPアドレスの取得に使う12種のヘッダーと、Cookie・認証のヘッダー
const REMOVED_HEADER_NAMES = [
  'X-Client-IP',
  'X-Forwarded-For',
  'Fly-Client-IP',
  'CF-Connecting-IP',
  'Fastly-Client-Ip',
  'True-Client-Ip',
  'X-Real-IP',
  'X-Cluster-Client-IP',
  'X-Forwarded',
  'Forwarded-For',
  'Forwarded',
  'X-Vercel-Forwarded-For',
  'Cookie',
  'Authorization',
];

function sensitiveText(label: string): string {
  return `${label} ${API_KEY} 番号#${LUHN_VALID_CARD_NUMBER}#確認`;
}

function redactedText(label: string): string {
  return `${label} ${REDACTED} 番号#${REDACTED}#確認`;
}

function createErrorEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    event_id: '0123456789abcdef0123456789abcdef',
    environment: 'staging',
    ...overrides,
  };
}

function createSpan(overrides: Partial<SpanJSON> = {}): SpanJSON {
  return {
    span_id: '0123456789abcdef',
    trace_id: '0123456789abcdef0123456789abcdef',
    start_timestamp: 1_792_000_000,
    status: 'ok',
    data: {},
    ...overrides,
  };
}

function createTransactionEvent(
  overrides: Partial<TransactionEvent> = {},
): TransactionEvent {
  return {
    type: 'transaction',
    event_id: '0123456789abcdef0123456789abcdef',
    environment: 'staging',
    ...overrides,
  };
}

function scrubOrFail(event: ErrorEvent, hint: EventHint = NO_HINT): ErrorEvent {
  const scrubbed = scrubEvent(event, hint);
  if (scrubbed === null) {
    throw new Error('イベントが落とされました');
  }
  return scrubbed;
}

describe('scrubEvent', () => {
  describe('想定内の失敗の除外', () => {
    test('共通エラー型の例外のイベントを送信対象から外す', () => {
      const appError = new AppError({
        kind: 'not_found',
        code: 'product_not_found',
        message: '製品が見つかりません',
      });

      expect(
        scrubEvent(createErrorEvent(), { originalException: appError }),
      ).toBeNull();
    });

    test('共通エラー型の派生クラスの例外も送信対象から外す', () => {
      class DerivedAppError extends AppError {}
      const derived = new DerivedAppError({
        kind: 'conflict',
        code: 'already_voted',
        message: '既に投票しています',
      });

      expect(
        scrubEvent(createErrorEvent(), { originalException: derived }),
      ).toBeNull();
    });

    test.each([
      ['想定外の例外', new TypeError('undefinedのプロパティを読めません')],
      [
        '名前だけがAppErrorの例外',
        Object.assign(new Error('x'), { name: 'AppError' }),
      ],
      ['例外以外の値', 'string-thrown'],
      ['例外が無いイベント', undefined],
    ])('%sのイベントは送信対象に残す', (_label, originalException) => {
      expect(
        scrubEvent(createErrorEvent(), { originalException }),
      ).not.toBeNull();
    });
  });

  describe('利用者とリクエストの個人情報の除去', () => {
    test('利用者のIPアドレスとメールアドレスを除き、他の項目は残す', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          user: {
            id: '01JBXUSER',
            ip_address: '203.0.113.10',
            email: 'someone@mail.example',
            username: 'launcher',
          },
        }),
      );

      expect(scrubbed.user).toStrictEqual({
        id: '01JBXUSER',
        username: 'launcher',
      });
    });

    test('リクエストのCookie・本文・クエリ文字列を除く', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          request: {
            method: 'POST',
            url: 'https://api.launch-stadium.example/graphql',
            cookies: { session: 'opaque-session' },
            data: { comment: '本文' },
            query_string: 'page=2',
          },
        }),
      );

      expect(scrubbed.request).toStrictEqual({
        method: 'POST',
        url: 'https://api.launch-stadium.example/graphql',
      });
    });

    test('IPアドレスや認証を表すヘッダーを大文字小文字を区別せずに除き、他のヘッダーは残す', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          request: {
            headers: {
              Cookie: 'session=opaque-session',
              authorization: 'Bearer opaque-credential',
              'CF-Connecting-IP': '203.0.113.10',
              'x-forwarded-for': '203.0.113.10, 198.51.100.1',
              'X-Real-IP': '203.0.113.10',
              'true-client-ip': '203.0.113.10',
              'user-agent': 'Mozilla/5.0',
              accept: 'application/json',
            },
          },
        }),
      );

      expect(scrubbed.request?.headers).toStrictEqual({
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json',
      });
    });

    test.each(REMOVED_HEADER_NAMES)('ヘッダー%sを除く', (name) => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          request: { headers: { [name]: '203.0.113.10', accept: '*/*' } },
        }),
      );

      expect(scrubbed.request?.headers).toStrictEqual({ accept: '*/*' });
    });
  });

  describe('値の形式による伏せ字', () => {
    test('logentryのparamsの循環するオブジェクトで無限に再帰せず、循環の位置を印に置き換える', () => {
      const cyclic: Record<string, unknown> = { key: API_KEY };
      cyclic.self = cyclic;
      const shared = { note: 'plain' };

      const scrubbed = scrubOrFail(
        createErrorEvent({
          logentry: { message: '%o %o', params: [cyclic, [shared, shared]] },
        }),
      );

      expect(scrubbed.logentry).toStrictEqual({
        message: '%o %o',
        params: [
          { key: REDACTED, self: '[Circular ~]' },
          [{ note: 'plain' }, { note: 'plain' }],
        ],
      });
    });

    test('パンくずのdataの値に入れた公開APIのキーを伏せ字にし、他の値は残す', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          breadcrumbs: [
            {
              category: 'fetch',
              data: {
                url: `https://partner.example/v1?key=${API_KEY}`,
                status_code: 401,
                nested: { header: API_KEY, list: [API_KEY, 'plain'] },
              },
            },
          ],
        }),
      );

      expect(scrubbed.breadcrumbs).toStrictEqual([
        {
          category: 'fetch',
          data: {
            url: `https://partner.example/v1?key=${REDACTED}`,
            status_code: 401,
            nested: { header: REDACTED, list: [REDACTED, 'plain'] },
          },
        },
      ]);
    });

    test('例外の値と種類に入れたキーとカード番号の形を伏せ、周りの文字列は残す', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          exception: {
            values: [
              {
                type: sensitiveText('種類'),
                value: sensitiveText('例外'),
                mechanism: { type: 'hono', handled: false },
              },
            ],
          },
        }),
      );

      expect(scrubbed.exception).toStrictEqual({
        values: [
          {
            type: redactedText('種類'),
            value: redactedText('例外'),
            mechanism: { type: 'hono', handled: false },
          },
        ],
      });
    });

    test('イベントのメッセージに入れたキーとカード番号の形を伏せる', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({ message: sensitiveText('メッセージ') }),
      );

      expect(scrubbed.message).toBe(redactedText('メッセージ'));
    });

    test('logentryのmessage・formatted・文字列のparamsを伏せ、文字列以外のparamsは残す', () => {
      const logentry = {
        message: sensitiveText('書式'),
        formatted: sensitiveText('整形済み'),
        params: [sensitiveText('引数'), 42, true, null],
      };

      const expected = {
        message: redactedText('書式'),
        formatted: redactedText('整形済み'),
        params: [redactedText('引数'), 42, true, null],
      };

      const scrubbed = scrubOrFail(createErrorEvent({ logentry }));

      expect(scrubbed.logentry).toStrictEqual(expected);
    });

    test('パンくずのメッセージに入れたキーとカード番号の形を伏せる', () => {
      const breadcrumb: Breadcrumb = {
        category: 'console',
        level: 'info',
        message: sensitiveText('パンくず'),
      };

      const scrubbed = scrubOrFail(
        createErrorEvent({ breadcrumbs: [breadcrumb] }),
      );

      expect(scrubbed.breadcrumbs).toStrictEqual([
        {
          category: 'console',
          level: 'info',
          message: redactedText('パンくず'),
        },
      ]);
    });

    test('リクエストのURLに入れたキーとカード番号の形を伏せる', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          request: {
            url: `https://api.launch-stadium.example/v1/keys/${API_KEY}/cards/c-${LUHN_VALID_CARD_NUMBER}-x`,
          },
        }),
      );

      expect(scrubbed.request?.url).toBe(
        `https://api.launch-stadium.example/v1/keys/${REDACTED}/cards/c-${REDACTED}-x`,
      );
    });

    test('トランザクションの名前に入れたキーとカード番号の形を伏せる', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({ transaction: sensitiveText('GET /v1') }),
      );

      expect(scrubbed.transaction).toBe(redactedText('GET /v1'));
    });

    test('カード番号の形を含む公開APIのキーを1つの伏せ字にし、キーの断片を残さない', () => {
      const apiKeyWithCardNumber = `lsk_AbCdEfGhIjKl${LUHN_VALID_CARD_NUMBER}MnOpQrStUvWxYzA`;

      const scrubbed = scrubOrFail(
        createErrorEvent({ message: `キー ${apiKeyWithCardNumber} を拒否` }),
      );

      expect(scrubbed.message).toBe(`キー ${REDACTED} を拒否`);
    });

    test('パターンに当たらない通常のメッセージとクラス名は変えない', () => {
      const event = createErrorEvent({
        message: '投票の集計に失敗しました',
        transaction: 'GET /v1/products/:productId',
        logentry: { message: '集計 %s 件', params: ['12'] },
        exception: {
          values: [{ type: 'TypeError', value: '集計対象が見つかりません' }],
        },
        breadcrumbs: [
          { message: 'キャッシュを参照しました', data: { hit: true } },
        ],
        request: { url: 'https://api.launch-stadium.example/v1/products' },
      });

      expect(scrubOrFail(event)).toStrictEqual(event);
    });

    test('対象の項目が無いイベントに項目を書き足さない', () => {
      const event = createErrorEvent();

      expect(scrubOrFail(event)).toStrictEqual(event);
    });
  });

  test('元のイベントを書き換えない', () => {
    const event = createErrorEvent({
      message: sensitiveText('メッセージ'),
      user: { id: '01JBXUSER', ip_address: '203.0.113.10' },
      request: {
        url: sensitiveText('https://api.launch-stadium.example/'),
        headers: { authorization: 'Bearer opaque-credential' },
        cookies: { session: 'opaque-session' },
      },
      exception: { values: [{ type: 'Error', value: sensitiveText('例外') }] },
      breadcrumbs: [
        { message: sensitiveText('パンくず'), data: { key: API_KEY } },
      ],
    });
    const before = structuredClone(event);

    scrubOrFail(event);

    expect(event).toStrictEqual(before);
  });
});

describe('scrubTransaction', () => {
  test('利用者のIPアドレスとメールアドレス、リクエストのCookie・本文・クエリ文字列・IPアドレスや認証を表すヘッダーを除き、URLを伏せる', () => {
    const scrubbed = scrubTransaction(
      createTransactionEvent({
        user: {
          id: '01JBXUSER',
          ip_address: '203.0.113.10',
          email: 'someone@mail.example',
        },
        request: {
          method: 'GET',
          url: `https://api.launch-stadium.example/v1/keys/${API_KEY}`,
          cookies: { session: 'opaque-session' },
          data: { comment: '本文' },
          query_string: 'page=2',
          headers: {
            'cf-connecting-ip': '203.0.113.10',
            'x-forwarded-for': '203.0.113.10',
            'true-client-ip': '203.0.113.10',
            cookie: 'session=opaque-session',
            authorization: 'Bearer opaque-credential',
            'user-agent': 'Mozilla/5.0',
          },
        },
      }),
    );

    expect(scrubbed.user).toStrictEqual({ id: '01JBXUSER' });
    expect(scrubbed.request).toStrictEqual({
      method: 'GET',
      url: `https://api.launch-stadium.example/v1/keys/${REDACTED}`,
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
  });

  test.each(REMOVED_HEADER_NAMES)('ヘッダー%sを除く', (name) => {
    const scrubbed = scrubTransaction(
      createTransactionEvent({
        request: { headers: { [name]: '203.0.113.10', accept: '*/*' } },
      }),
    );

    expect(scrubbed.request?.headers).toStrictEqual({ accept: '*/*' });
  });

  test('トランザクションの名前に入れたキーとカード番号の形を伏せる', () => {
    const scrubbed = scrubTransaction(
      createTransactionEvent({ transaction: sensitiveText('GET /v1') }),
    );

    expect(scrubbed.transaction).toBe(redactedText('GET /v1'));
  });

  test('スパンの説明とdataの文字列の値を伏せ、文字列以外の値は残す', () => {
    const scrubbed = scrubTransaction(
      createTransactionEvent({
        spans: [
          createSpan({
            description: sensitiveText('GET https://partner.example/'),
            op: 'http.client',
            data: {
              'url.full': sensitiveText('https://partner.example/'),
              'http.response.status_code': 200,
              'list.values': [API_KEY, 'plain'],
            },
          }),
        ],
      }),
    );

    expect(scrubbed.spans).toStrictEqual([
      createSpan({
        description: redactedText('GET https://partner.example/'),
        op: 'http.client',
        data: {
          'url.full': redactedText('https://partner.example/'),
          'http.response.status_code': 200,
          'list.values': [REDACTED, 'plain'],
        },
      }),
    ]);
  });

  test('トレースのコンテキストのdataの文字列の値を伏せ、他のコンテキストは残す', () => {
    const scrubbed = scrubTransaction(
      createTransactionEvent({
        contexts: {
          trace: {
            span_id: '0123456789abcdef',
            trace_id: '0123456789abcdef0123456789abcdef',
            op: 'http.server',
            data: {
              'http.route': sensitiveText('/v1/keys'),
              'sentry.sample_rate': 0.1,
            },
          },
          cloud_resource: { 'cloud.provider': 'cloudflare' },
        },
      }),
    );

    expect(scrubbed.contexts).toStrictEqual({
      trace: {
        span_id: '0123456789abcdef',
        trace_id: '0123456789abcdef0123456789abcdef',
        op: 'http.server',
        data: {
          'http.route': redactedText('/v1/keys'),
          'sentry.sample_rate': 0.1,
        },
      },
      cloud_resource: { 'cloud.provider': 'cloudflare' },
    });
  });

  test('パターンに当たらない通常の名前と説明は変えず、対象の項目が無ければ書き足さない', () => {
    const event = createTransactionEvent({
      transaction: 'GET /v1/products/:productId',
      spans: [
        createSpan({
          description: 'SELECT * FROM products',
          data: { 'db.system': 'd1' },
        }),
      ],
      contexts: {
        trace: {
          span_id: '0123456789abcdef',
          trace_id: '0123456789abcdef0123456789abcdef',
        },
      },
    });

    expect(scrubTransaction(event)).toStrictEqual(event);
    expect(scrubTransaction(createTransactionEvent())).toStrictEqual(
      createTransactionEvent(),
    );
  });

  test('元のトランザクションを書き換えない', () => {
    const event = createTransactionEvent({
      transaction: sensitiveText('GET /v1'),
      spans: [
        createSpan({
          description: sensitiveText('説明'),
          data: { key: API_KEY },
        }),
      ],
      contexts: {
        trace: {
          span_id: '0123456789abcdef',
          trace_id: '0123456789abcdef0123456789abcdef',
          data: { key: API_KEY },
        },
      },
    });
    const before = structuredClone(event);

    scrubTransaction(event);

    expect(event).toStrictEqual(before);
  });
});
