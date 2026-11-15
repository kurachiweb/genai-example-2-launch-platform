import { afterEach, describe, expect, test } from 'bun:test';

import { resetSync } from '@logtape/logtape';
import { setCookie } from '@tanstack/react-start/server';

import {
  BROWSER_SESSION_TOKEN,
  CLIENT_IP,
  CLIENT_SESSION_COOKIE,
  graphqlResponse,
  htmlResponse,
  ISSUED_SESSION_TOKEN,
  pageRequestOf,
  recordFrontendLogs,
  recordingApi,
  renderContextOf,
  runInStartRequest,
  TEST_DOCUMENT_ID,
  TRACE_HEADERS,
} from '../../test/start-request-fixtures.ts';
import type { GraphQLResult } from '../../utilities/graphql/graphql-result.ts';
import type { PersistedDocument } from '../../utilities/graphql/persisted-document.ts';
import { executeGraphQLOnServer } from './execute-graphql.server.ts';

interface LaunchQuery {
  readonly launch: { readonly id: string } | null;
}

const LAUNCH_DOCUMENT = {
  kind: 'Document',
  definitions: [],
  loc: { source: 'query Launch { launch { id } }' },
  __meta__: { hash: TEST_DOCUMENT_ID },
} as unknown as PersistedDocument<LaunchQuery, { readonly id: string }>;

const COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Lax';

const ISSUED_COOKIE = `${CLIENT_SESSION_COOKIE}=${ISSUED_SESSION_TOKEN}; Max-Age=7776000; ${COOKIE_ATTRIBUTES}`;

const CLEARED_COOKIE = `${CLIENT_SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;

const ISSUE_HEADERS = {
  'x-session-issue': ISSUED_SESSION_TOKEN,
  'x-session-max-age': '7776000',
};

const LAUNCH_DATA = { launch: { id: 'launch-1' } };

afterEach(() => {
  resetSync();
});

const execute = (
  options: Parameters<typeof executeGraphQLOnServer>[2] = {},
): Promise<GraphQLResult<LaunchQuery>> =>
  executeGraphQLOnServer(LAUNCH_DOCUMENT, { id: 'launch-1' }, options);

const onlyRequest = (requests: readonly Request[]): Request => {
  const [request] = requests;
  if (requests.length !== 1 || request === undefined) {
    throw new Error('APIへの要求は1回を期待した');
  }
  return request;
};

describe('executeGraphQLOnServer(上流への要求)', () => {
  test('APIの/graphqlへ、契約の項目と識別子と変数だけを送る', async () => {
    const api = recordingApi(() =>
      Promise.resolve(graphqlResponse({ data: LAUNCH_DATA })),
    );
    let result: GraphQLResult<LaunchQuery> | undefined;

    await runInStartRequest({
      context: renderContextOf({ api, sessionToken: BROWSER_SESSION_TOKEN }),
      request: pageRequestOf({
        Cookie: `${CLIENT_SESSION_COOKIE}=${BROWSER_SESSION_TOKEN}; theme=dark`,
        'X-Original-Client-IP': '198.51.100.9',
      }),
      render: async () => {
        result = await execute({ turnstileToken: 'turnstile-token' });
        return htmlResponse();
      },
    });

    expect(result).toEqual({ ok: true, data: LAUNCH_DATA });
    const upstream = onlyRequest(api.requests);
    expect(upstream.method).toBe('POST');
    expect(new URL(upstream.url).pathname).toBe('/graphql');
    expect(Object.fromEntries(upstream.headers)).toEqual({
      'content-type': 'application/json',
      accept: 'application/graphql-response+json',
      'cf-turnstile-response': 'turnstile-token',
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': BROWSER_SESSION_TOKEN,
      'sentry-trace': TRACE_HEADERS['sentry-trace'] ?? '',
      baggage: TRACE_HEADERS.baggage ?? '',
    });
    expect(await upstream.json()).toEqual({
      documentId: TEST_DOCUMENT_ID,
      variables: { id: 'launch-1' },
    });
  });
});

describe('executeGraphQLOnServer(Cookieの指示)', () => {
  test('送り始める前の発行の指示をページの応答のCookieにし、上流のSet-Cookieは捨てる', async () => {
    const api = recordingApi(() =>
      Promise.resolve(
        graphqlResponse(
          { data: LAUNCH_DATA },
          { ...ISSUE_HEADERS, 'Set-Cookie': 'upstream=1; Path=/' },
        ),
      ),
    );

    const response = await runInStartRequest({
      context: renderContextOf({ api }),
      render: async () => {
        await execute();
        return htmlResponse();
      },
    });

    expect(response.headers.getSetCookie()).toEqual([ISSUED_COOKIE]);
    expect(response.headers.has('x-session-issue')).toBe(false);
  });

  test('送り始める前の削除の指示でセッションのCookieを削除する', async () => {
    const api = recordingApi(() =>
      Promise.resolve(
        graphqlResponse({ data: LAUNCH_DATA }, { 'x-session-clear': '1' }),
      ),
    );

    const response = await runInStartRequest({
      context: renderContextOf({ api, sessionToken: BROWSER_SESSION_TOKEN }),
      render: async () => {
        await execute();
        return new Response(null, {
          status: 307,
          headers: { Location: '/login' },
        });
      },
    });

    expect(response.headers.getSetCookie()).toEqual([CLEARED_COOKIE]);
  });

  test('他のCookieの指示を消さず、複数の指示は最後のセッションの指示だけを残す', async () => {
    const instructions = [ISSUE_HEADERS, { 'x-session-clear': '1' }];
    const api = recordingApi(() =>
      Promise.resolve(
        graphqlResponse({ data: LAUNCH_DATA }, instructions.shift() ?? {}),
      ),
    );

    const response = await runInStartRequest({
      context: renderContextOf({ api }),
      render: async () => {
        setCookie('theme', 'dark');
        await execute();
        setCookie('consent', 'yes');
        await execute();
        return htmlResponse({ 'Set-Cookie': 'route=1; Path=/' });
      },
    });

    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toContain('route=1; Path=/');
    expect(setCookies).toContain('theme=dark; Path=/');
    expect(setCookies).toContain('consent=yes; Path=/');
    expect(
      setCookies.filter((cookie) =>
        cookie.startsWith(`${CLIENT_SESSION_COOKIE}=`),
      ),
    ).toEqual([CLEARED_COOKIE]);
  });

  test('送り始めた後に届いた指示は警告のログを出して捨て、取得の結果は返す', async () => {
    const logs = recordFrontendLogs();
    const api = recordingApi(() =>
      Promise.resolve(graphqlResponse({ data: LAUNCH_DATA }, ISSUE_HEADERS)),
    );
    let late: Promise<GraphQLResult<LaunchQuery>> | undefined;

    const response = await runInStartRequest({
      context: renderContextOf({ api }),
      render: () => {
        late = (async () => {
          await Bun.sleep(5);
          return execute();
        })();
        return Promise.resolve(htmlResponse());
      },
    });
    const lateResult = await late;

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(lateResult).toEqual({ ok: true, data: LAUNCH_DATA });
    expect(
      logs()
        .filter((log) => log.category === 'client.relay.session')
        .map(({ level, reason }) => ({ level, reason })),
    ).toEqual([{ level: 'warning', reason: 'response_committed' }]);
    expect(JSON.stringify(logs())).not.toContain(ISSUED_SESSION_TOKEN);
  });
});

describe('executeGraphQLOnServer(失敗)', () => {
  test('APIへ到達できなければ中継と同じ503のエラーにして、警告のログを出して送る', async () => {
    const logs = recordFrontendLogs();
    const failure = new Error('service binding unavailable');
    const reported: unknown[] = [];
    const api = recordingApi(() => Promise.reject(failure));
    let result: GraphQLResult<LaunchQuery> | undefined;

    await runInStartRequest({
      context: renderContextOf({ api, reported }),
      render: async () => {
        result = await execute();
        return htmlResponse();
      },
    });

    if (result === undefined || result.ok) {
      throw new Error('失敗の結果を期待した');
    }
    expect(result.error.code).toBe('upstream_unavailable');
    expect(result.error.status).toBe(503);
    expect(result.error.retryAfterSeconds).toBe(5);
    expect(reported).toEqual([failure]);
    expect(logs().map((log) => log.category)).toContain('client.relay');
  });

  test('応答の本文の受信が途中で失敗すれば通信の失敗のエラーにする', async () => {
    const api = recordingApi(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError('stream cut'));
            },
          }),
          { headers: { 'Content-Type': 'application/graphql-response+json' } },
        ),
      ),
    );
    let result: GraphQLResult<LaunchQuery> | undefined;

    await runInStartRequest({
      context: renderContextOf({ api }),
      render: async () => {
        result = await execute();
        return htmlResponse();
      },
    });

    expect(result?.ok).toBe(false);
    expect(result?.ok === false ? result.error.code : undefined).toBe(
      'network_error',
    );
  });

  test('描画の文脈が無ければAPIを呼ばずに例外にする', async () => {
    const api = recordingApi(() =>
      Promise.resolve(graphqlResponse({ data: LAUNCH_DATA })),
    );
    let thrown: unknown;

    await runInStartRequest({
      context: { api },
      render: async () => {
        try {
          await execute();
        } catch (error) {
          thrown = error;
        }
        return htmlResponse();
      },
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(api.requests).toHaveLength(0);
  });
});
