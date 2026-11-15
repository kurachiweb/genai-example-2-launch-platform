import { describe, expect, test } from 'bun:test';

import type {
  Breadcrumb,
  ErrorEvent,
  EventHint,
  StreamedSpanJSON,
} from '@sentry/core';

import { GraphQLClientError } from '../graphql/graphql-result.ts';
import {
  isExpectedFailure,
  scrubSentryEvent,
  scrubSentrySpan,
  SENTRY_DATA_COLLECTION,
} from './sentry-scrub.ts';
import { REDACTED } from './redaction-patterns.ts';

const COOKIE_SECRET = 'cookie-secret-value';
const IPV4_ADDRESS = '203.0.113.7';
const IPV6_ADDRESS = '2001:db8::7';
const EMAIL_ADDRESS = 'member@mail.example';
const QUERY_SECRET = 'query-secret-value';
const FRAGMENT_SECRET = 'fragment-secret-value';
const AUTHORIZATION_SECRET = 'authorization-secret-value';
const SESSION_TOKEN = 'session-token-value';
const TURNSTILE_TOKEN = 'turnstile-token-value';
const BODY_SECRET = 'body-secret-value';

const SENSITIVE_VALUES = [
  COOKIE_SECRET,
  IPV4_ADDRESS,
  IPV6_ADDRESS,
  EMAIL_ADDRESS,
  QUERY_SECRET,
  FRAGMENT_SECRET,
  AUTHORIZATION_SECRET,
  SESSION_TOKEN,
  TURNSTILE_TOKEN,
  BODY_SECRET,
];

const QUERY = `?q=${QUERY_SECRET}&email=${EMAIL_ADDRESS}`;
const FRAGMENT = `#${FRAGMENT_SECRET}`;
const PAGE_URL = 'https://launch.example/products/product-1';
const NO_HINT: EventHint = {};

const REMOVED_HEADERS: Readonly<Record<string, string>> = {
  Cookie: `session=${COOKIE_SECRET}`,
  Authorization: `Bearer ${AUTHORIZATION_SECRET}`,
  'CF-Connecting-IP': IPV4_ADDRESS,
  'X-Forwarded-For': `${IPV4_ADDRESS}, ${IPV6_ADDRESS}`,
  'X-Real-IP': IPV4_ADDRESS,
  'True-Client-IP': IPV6_ADDRESS,
  'X-Session-Token': SESSION_TOKEN,
  'CF-Turnstile-Response': TURNSTILE_TOKEN,
  'X-Original-Client-IP': IPV4_ADDRESS,
  'X-Client-IP': IPV4_ADDRESS,
  'Fly-Client-IP': IPV4_ADDRESS,
  'Fastly-Client-IP': IPV4_ADDRESS,
  'X-Cluster-Client-IP': IPV4_ADDRESS,
  'X-Forwarded': IPV4_ADDRESS,
  'Forwarded-For': IPV4_ADDRESS,
  Forwarded: `for=${IPV4_ADDRESS}`,
  'X-Vercel-Forwarded-For': IPV4_ADDRESS,
  'CF-Connecting-IPv6': IPV6_ADDRESS,
  'CF-Pseudo-IPv4': IPV4_ADDRESS,
};

const createErrorEvent = (overrides: Partial<ErrorEvent> = {}): ErrorEvent => ({
  type: undefined,
  event_id: '0123456789abcdef0123456789abcdef',
  environment: 'staging',
  ...overrides,
});

const createSensitiveEvent = (): ErrorEvent =>
  createErrorEvent({
    user: {
      id: 'user-1',
      email: EMAIL_ADDRESS,
      ip_address: IPV4_ADDRESS,
    },
    request: {
      url: `${PAGE_URL}${QUERY}${FRAGMENT}`,
      method: 'POST',
      query_string: QUERY.slice(1),
      cookies: { session: COOKIE_SECRET },
      data: { email: EMAIL_ADDRESS, note: BODY_SECRET },
      headers: {
        ...REMOVED_HEADERS,
        Referer: `${PAGE_URL}${QUERY}`,
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html',
      },
    },
    breadcrumbs: [
      {
        category: 'fetch',
        type: 'http',
        data: {
          method: 'POST',
          url: `https://launch.example/_bff/graphql${QUERY}`,
          status_code: 200,
        },
      },
      {
        category: 'navigation',
        data: {
          from: `/products${QUERY}`,
          to: `/products/product-1${FRAGMENT}`,
        },
      },
      {
        category: 'http',
        type: 'http',
        data: {
          url: 'https://api.example/graphql',
          'url.query': QUERY.slice(1),
          'url.fragment': FRAGMENT_SECRET,
          'http.request.method': 'GET',
        },
      },
    ],
    exception: { values: [{ type: 'Error', value: '描画に失敗しました' }] },
  });

const createSpan = (
  attributes: StreamedSpanJSON['attributes'],
): StreamedSpanJSON => ({
  span_id: '0123456789abcdef',
  trace_id: '0123456789abcdef0123456789abcdef',
  name: 'GET /products/$productId',
  start_timestamp: 1_792_000_000,
  end_timestamp: 1_792_000_001,
  status: 'ok',
  is_segment: true,
  attributes,
});

const createSensitiveSpan = (): StreamedSpanJSON =>
  createSpan({
    'sentry.op': 'http.server',
    'http.request.method': 'GET',
    'http.response.status_code': 200,
    'http.request.header.accept': 'text/html',
    'http.request.header.content-type': 'application/json',
    'http.request.header.user-agent': 'Mozilla/5.0',
    'http.request.header.cookie': `session=${COOKIE_SECRET}`,
    'http.request.header.cf-connecting-ip': IPV4_ADDRESS,
    'http.request.header.x-forwarded-for': IPV6_ADDRESS,
    'http.request.header.authorization': `Bearer ${AUTHORIZATION_SECRET}`,
    'http.request.header.x-session-token': SESSION_TOKEN,
    'http.request.header.cf-turnstile-response': TURNSTILE_TOKEN,
    'http.request.header.referer': `${PAGE_URL}${QUERY}`,
    'http.response.header.set-cookie': `session=${COOKIE_SECRET}`,
    'http.response.header.content-type': 'text/html',
    'user.ip_address': IPV4_ADDRESS,
    'user.email': EMAIL_ADDRESS,
    'user.id': 'user-1',
    'client.address': IPV6_ADDRESS,
    'network.peer.address': IPV4_ADDRESS,
    'http.request.body.data': BODY_SECRET,
    'url.full': `${PAGE_URL}${QUERY}${FRAGMENT}`,
    'url.path': '/products/product-1',
    'url.query': QUERY.slice(1),
    'url.fragment': FRAGMENT_SECRET,
    'http.target': `/products/product-1${QUERY}`,
    'http.url': `${PAGE_URL}${QUERY}`,
    'http.client_ip': IPV4_ADDRESS,
    'net.peer.ip': IPV6_ADDRESS,
    'net.sock.peer.addr': IPV4_ADDRESS,
  });

// シークレット検出が実物のトークンと誤検知しないよう、テスト用の値を部品から組み立てる
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIwMUpCWCJ9',
  'c2lnbmF0dXJlLXZhbHVlXy0',
].join('.');
const LUHN_VALID_CARD_NUMBER = '4111111111111111';
const BEARER_TOKEN = `Bearer ${AUTHORIZATION_SECRET}`;

const FREE_TEXT_SENSITIVE_VALUES = [
  EMAIL_ADDRESS,
  IPV4_ADDRESS,
  IPV6_ADDRESS,
  AUTHORIZATION_SECRET,
  JWT,
  LUHN_VALID_CARD_NUMBER,
];

const sensitiveText = (label: string): string =>
  `${label} ${EMAIL_ADDRESS} ${IPV4_ADDRESS} ${IPV6_ADDRESS} ${BEARER_TOKEN} ${JWT} ${LUHN_VALID_CARD_NUMBER}`;

const redactedText = (label: string): string =>
  `${label} ${REDACTED} ${REDACTED} ${REDACTED} ${REDACTED} ${REDACTED} ${REDACTED}`;

const ORDINARY_TEXT = '2026-10-25T12:34:56.789Z 12:34:56 v1.2.3 GET /products';

const createFreeTextEvent = (): ErrorEvent => {
  const circularParam: Record<string, unknown> = { ip: IPV4_ADDRESS };
  circularParam['self'] = circularParam;
  return createErrorEvent({
    message: sensitiveText('メッセージ'),
    transaction: sensitiveText('取引'),
    exception: {
      values: [
        { type: sensitiveText('種類'), value: sensitiveText('値') },
        { type: 'TypeError', value: ORDINARY_TEXT },
      ],
    },
    logentry: {
      message: sensitiveText('記録'),
      params: [EMAIL_ADDRESS, { nested: [BEARER_TOKEN] }, circularParam],
    },
    breadcrumbs: [
      {
        category: 'console',
        level: 'error',
        message: sensitiveText('コンソール'),
        data: {
          arguments: [
            sensitiveText('引数'),
            { detail: { email: EMAIL_ADDRESS, card: LUHN_VALID_CARD_NUMBER } },
            [JWT, IPV6_ADDRESS],
          ],
          logger: 'console',
        },
      },
      { category: 'ui.click', message: ORDINARY_TEXT },
    ],
  });
};

const scrubOrFail = (
  event: ErrorEvent,
  hint: EventHint = NO_HINT,
): ErrorEvent => {
  const scrubbed = scrubSentryEvent(event, hint);
  if (scrubbed === null) {
    throw new Error('イベントが捨てられた');
  }
  return scrubbed;
};

const breadcrumbDataOf = (
  event: ErrorEvent,
  index: number,
): Breadcrumb['data'] => event.breadcrumbs?.[index]?.data;

const graphQLError = (code: string): GraphQLClientError =>
  new GraphQLClientError({ code, message: '失敗しました', status: 400 });

const expectNoSensitiveValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  for (const sensitive of SENSITIVE_VALUES) {
    expect(serialized).not.toContain(sensitive);
  }
};

const expectNoFreeTextSensitiveValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  for (const sensitive of FREE_TEXT_SENSITIVE_VALUES) {
    expect(serialized).not.toContain(sensitive);
  }
};

describe('isExpectedFailure', () => {
  test.each([
    'csrf_rejected',
    'rate_limit_exceeded',
    'not_found',
    'validation_failed',
    'payload_too_large',
  ])('想定内のコード%sを持つGraphQLClientErrorは想定内と判定する', (code) => {
    expect(isExpectedFailure(graphQLError(code))).toBe(true);
  });

  test.each([
    'internal_error',
    'upstream_unavailable',
    'upstream_timeout',
    'network_error',
    'invalid_response',
    'persisted_operation_not_found',
  ])('想定外のコード%sを持つGraphQLClientErrorは想定外と判定する', (code) => {
    expect(isExpectedFailure(graphQLError(code))).toBe(false);
  });

  test.each([
    ['Error', new Error('描画に失敗しました')],
    ['文字列', 'csrf_rejected'],
    [
      'codeとexpectedを持つだけのオブジェクト',
      { code: 'not_found', expected: true },
    ],
    ['undefined', undefined],
  ])('GraphQLClientErrorでない値(%s)は想定外と判定する', (_label, error) => {
    expect(isExpectedFailure(error)).toBe(false);
  });
});

describe('scrubSentryEvent', () => {
  describe('想定内の失敗の除外', () => {
    test.each(['csrf_rejected', 'rate_limit_exceeded', 'not_found'])(
      '元の例外が想定内のコード%sなら送らない',
      (code) => {
        const event = createErrorEvent();

        expect(
          scrubSentryEvent(event, { originalException: graphQLError(code) }),
        ).toBeNull();
      },
    );

    test('元の例外が想定外のGraphQLClientErrorなら送る', () => {
      const event = createErrorEvent();

      expect(
        scrubSentryEvent(event, {
          originalException: graphQLError('internal_error'),
        }),
      ).not.toBeNull();
    });

    test('元の例外がGraphQLClientError以外の例外や無い場合は送る', () => {
      const event = createErrorEvent();

      expect(
        scrubSentryEvent(event, { originalException: new Error('想定外') }),
      ).not.toBeNull();
      expect(scrubSentryEvent(event, NO_HINT)).not.toBeNull();
    });
  });

  describe('利用者と要求の除去', () => {
    test('利用者の情報を丸ごと消す', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(scrubbed.user).toBeUndefined();
    });

    test('要求のCookie・本文・クエリ文字列を消し、URLのクエリとフラグメントを除く', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(scrubbed.request?.cookies).toBeUndefined();
      expect(scrubbed.request?.data).toBeUndefined();
      expect(scrubbed.request?.query_string).toBeUndefined();
      expect(scrubbed.request?.url).toBe(PAGE_URL);
      expect(scrubbed.request?.method).toBe('POST');
    });

    test('CookieとIPアドレスとトークンのヘッダーを大文字小文字を区別せずに消し、他のヘッダーを残す', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());
      const headerNames = Object.keys(scrubbed.request?.headers ?? {});

      expect(headerNames.toSorted()).toEqual([
        'Accept',
        'Referer',
        'User-Agent',
      ]);
      expect(scrubbed.request?.headers?.['User-Agent']).toBe('Mozilla/5.0');
      expect(scrubbed.request?.headers?.Accept).toBe('text/html');
    });

    test('小文字のヘッダー名でも消す', () => {
      const scrubbed = scrubOrFail(
        createErrorEvent({
          request: {
            headers: {
              cookie: `session=${COOKIE_SECRET}`,
              'cf-connecting-ip': IPV4_ADDRESS,
              'x-session-token': SESSION_TOKEN,
            },
          },
        }),
      );

      expect(scrubbed.request?.headers).toEqual({});
    });

    test('参照元のヘッダーのURLのクエリを除く', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(scrubbed.request?.headers?.Referer).toBe(PAGE_URL);
    });

    test('要求も利用者も無いイベントはそのままの形で返す', () => {
      const event = createErrorEvent({ message: '想定外の失敗' });

      expect(scrubOrFail(event)).toEqual(event);
    });
  });

  describe('パンくずの除去', () => {
    test('通信のパンくずのURLのクエリを除き、他のデータを残す', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(breadcrumbDataOf(scrubbed, 0)).toEqual({
        method: 'POST',
        url: 'https://launch.example/_bff/graphql',
        status_code: 200,
      });
    });

    test('画面遷移のパンくずの遷移元と遷移先のクエリとフラグメントを除く', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(breadcrumbDataOf(scrubbed, 1)).toEqual({
        from: '/products',
        to: '/products/product-1',
      });
    });

    test('パンくずのデータのurl.queryとurl.fragmentを消す', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(breadcrumbDataOf(scrubbed, 2)).toEqual({
        url: 'https://api.example/graphql',
        'http.request.method': 'GET',
      });
    });

    test('パンくずの分類と種類を残す', () => {
      const scrubbed = scrubOrFail(createSensitiveEvent());

      expect(scrubbed.breadcrumbs?.map(({ category }) => category)).toEqual([
        'fetch',
        'navigation',
        'http',
      ]);
    });
  });

  test('Cookie・IPアドレス・メールアドレス・クエリなどの値が1つも残らない', () => {
    const scrubbed = scrubOrFail(createSensitiveEvent());

    expectNoSensitiveValue(scrubbed);
    expect(scrubbed.exception).toEqual({
      values: [{ type: 'Error', value: '描画に失敗しました' }],
    });
  });

  test('元のイベントを書き換えない', () => {
    const event = createSensitiveEvent();
    const snapshot = structuredClone(event);

    scrubOrFail(event);

    expect(event).toEqual(snapshot);
  });

  describe('自由記述の値の伏せ字', () => {
    test('メッセージと取引の名前の中の個人情報と秘密の値を伏せる', () => {
      const scrubbed = scrubOrFail(createFreeTextEvent());

      expect(scrubbed.message).toBe(redactedText('メッセージ'));
      expect(scrubbed.transaction).toBe(redactedText('取引'));
    });

    test('例外の種類と値の中の個人情報と秘密の値を伏せ、普通の文は残す', () => {
      const scrubbed = scrubOrFail(createFreeTextEvent());

      expect(scrubbed.exception?.values).toEqual([
        { type: redactedText('種類'), value: redactedText('値') },
        { type: 'TypeError', value: ORDINARY_TEXT },
      ]);
    });

    test('記録のメッセージと入れ子の引数を伏せ、循環する引数は印に置き換える', () => {
      const scrubbed = scrubOrFail(createFreeTextEvent());

      expect(scrubbed.logentry).toEqual({
        message: redactedText('記録'),
        params: [
          REDACTED,
          { nested: [REDACTED] },
          { ip: REDACTED, self: '[Circular ~]' },
        ],
      });
    });

    test('パンくずのメッセージとコンソールの引数を入れ子まで伏せ、普通の文は残す', () => {
      const scrubbed = scrubOrFail(createFreeTextEvent());

      expect(scrubbed.breadcrumbs).toEqual([
        {
          category: 'console',
          level: 'error',
          message: redactedText('コンソール'),
          data: {
            arguments: [
              redactedText('引数'),
              { detail: { email: REDACTED, card: REDACTED } },
              [REDACTED, REDACTED],
            ],
            logger: 'console',
          },
        },
        { category: 'ui.click', message: ORDINARY_TEXT },
      ]);
    });

    test('メールアドレス・IPアドレス・Bearerトークン・JWT・カード番号が1つも残らない', () => {
      expectNoFreeTextSensitiveValue(scrubOrFail(createFreeTextEvent()));
    });

    test('自由記述の値を伏せても元のイベントを書き換えない', () => {
      const event = createFreeTextEvent();
      const snapshot = structuredClone(event);

      scrubOrFail(event);

      expect(event).toEqual(snapshot);
    });
  });
});

describe('scrubSentrySpan', () => {
  test('要求ヘッダーはaccept・content-type・user-agentだけを残す', () => {
    const { attributes } = scrubSentrySpan(createSensitiveSpan());
    const requestHeaderKeys = Object.keys(attributes).filter((key) =>
      key.startsWith('http.request.header.'),
    );

    expect(requestHeaderKeys.toSorted()).toEqual([
      'http.request.header.accept',
      'http.request.header.content-type',
      'http.request.header.user-agent',
    ]);
  });

  test('大文字を含む属性名の要求ヘッダーも許可した3つ以外を消す', () => {
    const { attributes } = scrubSentrySpan(
      createSpan({
        'http.request.header.Cookie': `session=${COOKIE_SECRET}`,
        'HTTP.REQUEST.HEADER.CF-CONNECTING-IP': IPV4_ADDRESS,
        'http.request.header.User-Agent': 'Mozilla/5.0',
      }),
    );

    expect(attributes).toEqual({
      'http.request.header.User-Agent': 'Mozilla/5.0',
    });
  });

  test('応答ヘッダーを全て消す', () => {
    const { attributes } = scrubSentrySpan(createSensitiveSpan());

    expect(
      Object.keys(attributes).filter((key) =>
        key.startsWith('http.response.header.'),
      ),
    ).toEqual([]);
  });

  test('利用者・接続元・本文・クエリ・フラグメントの属性を消す', () => {
    const { attributes } = scrubSentrySpan(createSensitiveSpan());

    for (const key of [
      'user.ip_address',
      'user.email',
      'user.id',
      'client.address',
      'network.peer.address',
      'http.request.body.data',
      'url.query',
      'url.fragment',
      'http.target',
      'http.url',
      'http.client_ip',
      'net.peer.ip',
      'net.sock.peer.addr',
    ]) {
      expect(attributes).not.toHaveProperty([key]);
    }
  });

  test('url.fullのクエリとフラグメントを除く', () => {
    const { attributes } = scrubSentrySpan(createSensitiveSpan());

    expect(attributes['url.full']).toBe(PAGE_URL);
  });

  test('値と単位の形のurl.fullもクエリを除く', () => {
    const { attributes } = scrubSentrySpan(
      createSpan({ 'url.full': { value: `${PAGE_URL}${QUERY}` } }),
    );

    expect(attributes['url.full']).toEqual({ value: PAGE_URL });
  });

  test('個人情報を含まない属性とスパンの項目を残す', () => {
    const scrubbed = scrubSentrySpan(createSensitiveSpan());

    expect(scrubbed.name).toBe('GET /products/$productId');
    expect(scrubbed.span_id).toBe('0123456789abcdef');
    expect(scrubbed.attributes).toMatchObject({
      'sentry.op': 'http.server',
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'url.path': '/products/product-1',
    });
  });

  test('Cookie・IPアドレス・メールアドレス・クエリなどの値が1つも残らない', () => {
    expectNoSensitiveValue(scrubSentrySpan(createSensitiveSpan()));
  });

  test('元のスパンを書き換えない', () => {
    const span = createSensitiveSpan();
    const snapshot = structuredClone(span);

    scrubSentrySpan(span);

    expect(span).toEqual(snapshot);
  });

  describe('自由記述の値の伏せ字', () => {
    const createFreeTextSpan = (): StreamedSpanJSON => ({
      ...createSpan({
        'sentry.description': sensitiveText('説明'),
        'graphql.operation.name': 'ProductQuery',
        'app.reasons': [sensitiveText('理由'), 'plain'],
        'app.detail': { value: sensitiveText('詳細'), unit: 'byte' },
        'app.count': 3,
        'app.flag': true,
        'app.timestamp': ORDINARY_TEXT,
      }),
      name: sensitiveText('名前'),
    });

    test('スパンの名前の中の個人情報と秘密の値を伏せる', () => {
      expect(scrubSentrySpan(createFreeTextSpan()).name).toBe(
        redactedText('名前'),
      );
    });

    test('文字列の属性・配列の属性・値と単位の形の属性を伏せ、他の型と普通の文は残す', () => {
      expect(scrubSentrySpan(createFreeTextSpan()).attributes).toEqual({
        'sentry.description': redactedText('説明'),
        'graphql.operation.name': 'ProductQuery',
        'app.reasons': [redactedText('理由'), 'plain'],
        'app.detail': { value: redactedText('詳細'), unit: 'byte' },
        'app.count': 3,
        'app.flag': true,
        'app.timestamp': ORDINARY_TEXT,
      });
    });

    test('メールアドレス・IPアドレス・Bearerトークン・JWT・カード番号が1つも残らない', () => {
      expectNoFreeTextSensitiveValue(scrubSentrySpan(createFreeTextSpan()));
    });
  });
});

describe('SENTRY_DATA_COLLECTION', () => {
  test('利用者の情報・Cookie・本文・クエリ・GraphQLの文書と変数を収集しない', () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
    });
  });

  test('要求ヘッダーはaccept・content-type・user-agentだけを収集し、応答ヘッダーを収集しない', () => {
    expect(SENTRY_DATA_COLLECTION.httpHeaders).toEqual({
      request: { allow: ['accept', 'content-type', 'user-agent'] },
      response: false,
    });
  });

  test('スタックフレームの変数・生成AI・DBのクエリ・キューのデータを収集しない', () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});
