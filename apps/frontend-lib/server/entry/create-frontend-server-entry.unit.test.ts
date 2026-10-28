import { afterEach, describe, expect, test } from 'bun:test';

import { getConfig, resetSync } from '@logtape/logtape';

import {
  CLIENT_COOKIE,
  CLIENT_TOKEN,
  fetcherOf,
  rejecting,
  respondingWith,
} from '../../test/relay-route-fixtures.ts';
import {
  ACCESS_LOG_DURATION_MS,
  ADMIN_TEST_PROFILE,
  ANALYTICS_ORIGIN,
  APP_ORIGIN,
  baseEnvOf,
  CLIENT_TEST_PROFILE,
  createHarness,
  errorBodyOf,
  expectSecurityHeaders,
  type Harness,
  IMAGES_ORIGIN,
  limiterOf,
  logsOf,
  pageRequest,
  sameOriginPost,
  SENTRY_DSN,
  SENTRY_ORIGIN,
  TRACE_HEADERS,
  withCf,
} from '../../test/server-entry-fixtures.ts';
import {
  toPublicRuntimeConfig,
  validateFrontendEnv,
} from '../env/frontend-env.ts';
import { NON_PAGE_CONTENT_SECURITY_POLICY } from '../http/security-policy.ts';
import { GRAPHQL_RELAY_ROUTE } from '../relay/relay-route.ts';
import type { FrontendServerEntryOptions } from './create-frontend-server-entry.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

afterEach(() => {
  resetSync();
});

const onlyStartCall = (harness: Harness) => {
  expect(harness.startCalls).toHaveLength(1);
  const [call] = harness.startCalls;
  if (call === undefined) {
    throw new Error('描画が呼ばれなかった');
  }
  return call;
};

const accessLogOf = (harness: Harness) => {
  const logs = logsOf(harness, 'client.http.access');
  expect(logs).toHaveLength(1);
  return logs[0];
};

describe('createFrontendServerEntry(読み込みと組み立て)', () => {
  test('モジュールの読み込みと組み立てだけでは、環境を読まずログも設定しない', async () => {
    resetSync();
    const modulePath = new URL(
      './create-frontend-server-entry.ts?load-only',
      import.meta.url,
    ).href;
    const loaded = (await import(
      modulePath
    )) as typeof import('./create-frontend-server-entry.ts');
    expect(getConfig()).toBeNull();

    const readKeys: string[] = [];
    const env = new Proxy(
      baseEnvOf(
        respondingWith(() => new Response()),
        limiterOf(true),
      ),
      {
        get: (target, key, receiver) => {
          readKeys.push(String(key));
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );
    const consoleCalls: unknown[] = [];
    const entry = loaded.createFrontendServerEntry({
      profile: CLIENT_TEST_PROFILE,
      startHandler: {
        fetch: () => Promise.resolve(new Response('ok')),
      },
      relayRoutes: [GRAPHQL_RELAY_ROUTE],
      securityPolicy: {},
      reportUnexpected: () => undefined,
      traceHeaders: () => ({}),
      console: {
        info: (...args: unknown[]) => {
          consoleCalls.push(args);
        },
      } as unknown as Console,
    });

    expect(getConfig()).toBeNull();
    expect(readKeys).toEqual([]);
    expect(consoleCalls).toEqual([]);

    await entry.fetch(pageRequest(), env, { waitUntil: () => undefined });

    expect(getConfig()).not.toBeNull();
    expect(readKeys).toContain('LOG_LEVEL');
    expect(readKeys).toContain('IMAGES_ORIGIN');
  });
});

describe('createFrontendServerEntry(CSRF)', () => {
  test('中継の経路の拒否は403 csrf_rejectedで返し、理由とクエリを除く経路を警告に出して中継しない', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      sameOriginPost('/_bff/graphql?token=secret', {
        'Sec-Fetch-Site': 'cross-site',
      }),
    );

    expect(response.status).toBe(403);
    expect(await errorBodyOf(response)).toBe('csrf_rejected');
    expectSecurityHeaders(response);
    const [warning, ...rest] = logsOf(harness, 'client.http.csrf');
    expect(rest).toEqual([]);
    expect(warning?.level).toBe('warning');
    expect(warning?.reason).toBe('cross_site_fetch');
    expect(warning?.path).toBe('/_bff/graphql');
    expect(JSON.stringify(harness.logs())).not.toContain('secret');
    expect(harness.api.calls).toEqual([]);
    expect(harness.reported).toEqual([]);
  });

  test('GETのサーバー関数の呼び出しもヘッダーが無ければ拒否して描画を呼ばない', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      new Request(`${APP_ORIGIN}/_serverFn/abc?payload=1`),
    );

    expect(response.status).toBe(403);
    expect(logsOf(harness, 'client.http.csrf')[0]?.reason).toBe(
      'missing_headers',
    );
    expect(logsOf(harness, 'client.http.csrf')[0]?.path).toBe('/_serverFn/abc');
    expect(harness.startCalls).toEqual([]);
  });

  test('後続のspecが追加する経路の状態変更にも適用する', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      new Request(`${APP_ORIGIN}/launches/new`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      }),
    );

    expect(response.status).toBe(403);
    expect(logsOf(harness, 'client.http.csrf')[0]?.reason).toBe(
      'origin_mismatch',
    );
    expect(harness.startCalls).toEqual([]);
  });

  test('同じオリジンからの状態変更は通す', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      new Request(`${APP_ORIGIN}/launches/new`, {
        method: 'POST',
        headers: { Origin: APP_ORIGIN },
      }),
    );

    expect(response.status).toBe(200);
    expect(harness.startCalls).toHaveLength(1);
    expect(logsOf(harness, 'client.http.csrf')).toEqual([]);
  });
});

describe('createFrontendServerEntry(中継)', () => {
  test('登録した中継の経路はAPIへ中継し、描画を呼ばない', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      sameOriginPost('/_bff/graphql', {
        Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ok: true } });
    expectSecurityHeaders(response);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    expect(harness.api.calls).toHaveLength(1);
    const [call] = harness.api.calls;
    expect(call?.url).toBe('https://api.internal/graphql');
    expect(call?.headers['x-original-client-ip']).toBe('203.0.113.5');
    expect(call?.headers['x-session-token']).toBe(CLIENT_TOKEN);
    expect(call?.headers['sentry-trace']).toBe(TRACE_HEADERS['sentry-trace']);
    expect(call?.headers.baggage).toBe(TRACE_HEADERS.baggage);
    expect(harness.startCalls).toEqual([]);
  });

  test('未登録の/_bff/の経路は404 not_foundで返し、中継も描画もしない', async () => {
    const harness = createHarness();

    const response = await harness.fetch(
      new Request(`${APP_ORIGIN}/_bff/unknown`),
    );

    expect(response.status).toBe(404);
    expect(await errorBodyOf(response)).toBe('not_found');
    expectSecurityHeaders(response);
    expect(harness.api.calls).toEqual([]);
    expect(harness.startCalls).toEqual([]);
    expect(harness.reported).toEqual([]);
  });

  test('中継の失敗は[caller, relay]へ警告を出して送信し、503を返す', async () => {
    const harness = createHarness({
      api: rejecting(new Error('connection refused')),
    });

    const response = await harness.fetch(sameOriginPost('/_bff/graphql'));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expectSecurityHeaders(response);
    expect(logsOf(harness, 'client.relay')[0]?.level).toBe('warning');
    expect(harness.reported).toHaveLength(1);
  });

  test('Cookieの指示の破棄は[caller, relay, session]へ警告を出す', async () => {
    const harness = createHarness({
      api: respondingWith(
        () =>
          new Response('{"data":{}}', {
            headers: { 'x-session-clear': 'yes' },
          }),
      ),
    });

    await harness.fetch(sameOriginPost('/_bff/graphql'));

    expect(logsOf(harness, 'client.relay.session')[0]?.level).toBe('warning');
  });
});

describe('createFrontendServerEntry(描画)', () => {
  test('描画へnonce・表示設定・公開設定・中継の文脈・API・Cookieの名前をcontextで渡す', async () => {
    const harness = createHarness();
    const request = withCf(
      pageRequest('/launches', {
        'Accept-Language': 'en-US,ja;q=0.5',
        Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
      }),
      { timezone: 'Asia/Tokyo' },
    );

    await harness.fetch(request);

    const { context, request: passed } = onlyStartCall(harness);
    expect(passed).toBe(request);
    const validation = validateFrontendEnv(harness.env);
    if (!validation.ok) {
      throw new Error('テストの環境が不正');
    }
    expect(context.nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    expect(context.correlationId).toMatch(UUID_PATTERN);
    expect(context.display).toEqual({
      timeZone: 'Asia/Tokyo',
      locale: 'en-US',
    });
    expect(context.publicConfig).toEqual(
      toPublicRuntimeConfig(validation.env, CLIENT_TEST_PROFILE),
    );
    expect(context.relay).toEqual({
      clientIp: '203.0.113.5',
      sessionToken: CLIENT_TOKEN,
      traceHeaders: TRACE_HEADERS,
    });
    expect(context.api).toBe(harness.api);
    expect(context.sessionCookieName).toBe(CLIENT_COOKIE);
  });

  test('接続元のタイムゾーンと言語の設定が無ければUTCとja-JPにする', async () => {
    const harness = createHarness();

    await harness.fetch(withCf(pageRequest(), { timezone: 42 }));

    expect(onlyStartCall(harness).context.display).toEqual({
      timeZone: 'UTC',
      locale: 'ja-JP',
    });
  });

  test('ページのCSPに要求ごとのnonceと登録・実行時の許可先を入れる', async () => {
    const harness = createHarness();

    const first = await harness.fetch(pageRequest());
    const second = await harness.fetch(pageRequest());

    const [firstCall, secondCall] = harness.startCalls;
    expect(firstCall?.context.nonce).not.toBe(secondCall?.context.nonce);
    const csp = first.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain(`'nonce-${firstCall?.context.nonce ?? ''}'`);
    expect(csp).toContain(IMAGES_ORIGIN);
    expect(csp).toContain(SENTRY_ORIGIN);
    expect(csp).toContain(ANALYTICS_ORIGIN);
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain(SENTRY_DSN);
    expect(second.headers.get('Content-Security-Policy')).toContain(
      `'nonce-${secondCall?.context.nonce ?? ''}'`,
    );
    expect(first.headers.get('Permissions-Policy')).toContain('payment=(self)');
    expectSecurityHeaders(first);
  });

  test('ローカルではupgrade-insecure-requestsを付けない', async () => {
    const harness = createHarness({ env: { APP_ENVIRONMENT: 'local' } });

    const response = await harness.fetch(pageRequest());

    expect(response.headers.get('Content-Security-Policy')).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  test('HTML以外の応答にはページ以外のCSPを付ける', async () => {
    const harness = createHarness({
      respond: () => Response.json({ result: 1 }),
    });

    const response = await harness.fetch(sameOriginPost('/_serverFn/abc'));

    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    expectSecurityHeaders(response);
  });

  test('ヘッダーを変えられない応答にもヘッダーを付ける', async () => {
    const harness = createHarness({
      respond: () => Response.redirect(`${APP_ORIGIN}/login`, 307),
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(`${APP_ORIGIN}/login`);
    expectSecurityHeaders(response);
  });

  test('描画の応答の本文を読まずにそのまま返す', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<!doctype html>'));
        controller.close();
      },
    });
    const harness = createHarness({
      respond: () =>
        new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    const response = await harness.fetch(pageRequest());

    expect(response.body).toBe(body);
    expect(await response.text()).toBe('<!doctype html>');
  });
});

describe('createFrontendServerEntry(検索除外)', () => {
  test.each([
    ['client', 'prod', null],
    ['client', 'staging', 'noindex, nofollow'],
    ['client', 'local', 'noindex, nofollow'],
    ['admin', 'prod', 'noindex, nofollow'],
  ] as const)(
    '%sの%sではX-Robots-Tagが%p',
    async (caller, environment, expected) => {
      const harness = createHarness({
        profile: caller === 'client' ? CLIENT_TEST_PROFILE : ADMIN_TEST_PROFILE,
        env: { APP_ENVIRONMENT: environment },
      });

      const page = await harness.fetch(pageRequest());
      const relay = await harness.fetch(sameOriginPost('/_bff/graphql'));

      expect(page.headers.get('X-Robots-Tag')).toBe(expected);
      expect(relay.headers.get('X-Robots-Tag')).toBe(expected);
    },
  );

  test('管理者側のログのカテゴリはadminで始まり、公開設定に解析のトークンを含めない', async () => {
    const harness = createHarness({ profile: ADMIN_TEST_PROFILE });

    await harness.fetch(pageRequest());

    expect(onlyStartCall(harness).context.publicConfig.webAnalyticsToken).toBe(
      undefined,
    );
    expect(logsOf(harness, 'admin.http.access')).toHaveLength(1);
  });
});

describe('createFrontendServerEntry(想定外の例外)', () => {
  test('描画の例外は500の静的なエラー画面にし、[caller, http, error]へ出して送信する', async () => {
    const failure = new Error('render failed');
    const harness = createHarness({
      respond: () => Promise.reject(failure),
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expectSecurityHeaders(response);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    expect(harness.reported).toEqual([failure]);
    const [logged] = logsOf(harness, 'client.http.error');
    expect(logged?.level).toBe('error');
    expect((logged?.error as { message: string }).message).toBe(
      'render failed',
    );
  });

  test('登録した許可先が不正なら500にして送信する', async () => {
    const harness = createHarness({
      entryOptions: { securityPolicy: { scriptSrc: ['https://*.example'] } },
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    expect(harness.reported).toHaveLength(1);
    expect(harness.startCalls).toEqual([]);
  });

  test('中継の経路の上流のパスの例外も500にして送信する', async () => {
    const harness = createHarness({
      api: fetcherOf(() => Promise.resolve(new Response())),
      entryOptions: {
        relayRoutes: [
          {
            ...GRAPHQL_RELAY_ROUTE,
            upstreamPath: () => 'https://evil.example/',
          },
        ],
      },
    });

    const response = await harness.fetch(sameOriginPost('/_bff/graphql'));

    expect(response.status).toBe(500);
    expect(harness.reported).toHaveLength(1);
    expect(harness.api.calls).toEqual([]);
  });
});

describe('createFrontendServerEntry(送信の失敗)', () => {
  const REPORT_FAILURE_DETAIL = 'report-failure-detail';

  const throwingReporter = (): Partial<FrontendServerEntryOptions> => ({
    reportUnexpected: () => {
      throw new TypeError(`sentry unavailable ${REPORT_FAILURE_DETAIL}`);
    },
  });

  const expectReportFailureLogged = (harness: Harness): void => {
    const failures = logsOf(harness, 'client.http.error').filter(
      (logged) => logged.errorName !== undefined,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.level).toBe('error');
    expect(failures[0]?.errorName).toBe('TypeError');
    expect(JSON.stringify(harness.logs())).not.toContain(REPORT_FAILURE_DETAIL);
  };

  test.each([
    [
      '環境の不備',
      { env: { API: undefined } },
      () => pageRequest(),
      500,
      'static_error',
    ],
    [
      '描画の例外',
      { respond: () => Promise.reject(new Error('render failed')) },
      () => pageRequest(),
      500,
      'static_error',
    ],
    [
      '中継の失敗',
      { api: rejecting(new Error('connection refused')) },
      () => sameOriginPost('/_bff/graphql'),
      503,
      'relay',
    ],
  ] as const)(
    '%sで送信が例外を投げても、ヘッダー付きの応答とアクセスログを返し、送信の失敗を値を含めずに記録する',
    async (_name, harnessOptions, request, status, outcome) => {
      const harness = createHarness({
        ...harnessOptions,
        entryOptions: throwingReporter(),
      });

      const response = await harness.fetch(request());

      expect(response.status).toBe(status);
      expectSecurityHeaders(response);
      expect(response.headers.get('Content-Security-Policy')).toBe(
        NON_PAGE_CONTENT_SECURITY_POLICY,
      );
      expect(accessLogOf(harness)?.outcome).toBe(outcome);
      expect(accessLogOf(harness)?.status).toBe(status);
      expectReportFailureLogged(harness);
    },
  );

  test('Error以外の値を投げる送信の失敗は、値ではなく型の名前だけを記録する', async () => {
    const harness = createHarness({
      respond: () => Promise.reject(new Error('render failed')),
      entryOptions: {
        reportUnexpected: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- Error以外を投げる送信の実装を再現する
          throw REPORT_FAILURE_DETAIL;
        },
      },
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    const failure = logsOf(harness, 'client.http.error').find(
      (logged) => logged.errorName !== undefined,
    );
    expect(failure?.errorName).toBe('string');
    expect(JSON.stringify(harness.logs())).not.toContain(REPORT_FAILURE_DETAIL);
  });
});

describe('createFrontendServerEntry(アクセスログ)', () => {
  test.each([
    [
      'ページ',
      () => pageRequest('/launches?q=mail@user.example'),
      'GET',
      '/launches',
      200,
      'page',
    ],
    [
      '中継',
      () => sameOriginPost('/_bff/graphql?x=1'),
      'POST',
      '/_bff/graphql',
      200,
      'relay',
    ],
    [
      '未登録の中継',
      () => new Request(`${APP_ORIGIN}/_bff/none`),
      'GET',
      '/_bff/none',
      404,
      'rejected',
    ],
  ] as const)(
    '%sの要求ごとにメソッド・クエリを除く経路・状態コード・処理時間・相関ID・結果を1件出す',
    async (_name, request, method, path, status, outcome) => {
      const harness = createHarness();

      await harness.fetch(request());

      const logged = accessLogOf(harness);
      expect(logged?.level).toBe('info');
      expect(logged?.method).toBe(method);
      expect(logged?.path).toBe(path);
      expect(logged?.status).toBe(status);
      expect(logged?.durationMs).toBe(ACCESS_LOG_DURATION_MS);
      expect(logged?.correlationId).toMatch(UUID_PATTERN);
      expect(logged?.outcome).toBe(outcome);
      expect(JSON.stringify(harness.logs())).not.toContain('203.0.113.5');
    },
  );

  test('拒否・環境の不備・例外でもアクセスログを出す', async () => {
    const rejected = createHarness();
    await rejected.fetch(
      sameOriginPost('/_bff/graphql', { 'Sec-Fetch-Site': 'same-site' }),
    );
    expect(accessLogOf(rejected)?.outcome).toBe('rejected');
    expect(accessLogOf(rejected)?.status).toBe(403);

    const invalid = createHarness({ env: { API: undefined } });
    await invalid.fetch(pageRequest());
    expect(accessLogOf(invalid)?.outcome).toBe('static_error');
    expect(accessLogOf(invalid)?.status).toBe(500);

    const limited = createHarness({ limited: true });
    await limited.fetch(pageRequest());
    expect(accessLogOf(limited)?.outcome).toBe('rejected');
    expect(accessLogOf(limited)?.status).toBe(429);
  });

  test('1要求の中のログはすべて同じ相関IDを持ち、描画のcontextの相関IDと一致する', async () => {
    const harness = createHarness();

    await harness.fetch(
      sameOriginPost('/_bff/graphql', { 'Sec-Fetch-Site': 'cross-site' }),
    );
    await harness.fetch(pageRequest());

    const [csrf] = logsOf(harness, 'client.http.csrf');
    const [first, second] = logsOf(harness, 'client.http.access');
    expect(csrf?.correlationId).toBe(first?.correlationId);
    expect(second?.correlationId).toBe(
      onlyStartCall(harness).context.correlationId,
    );
    expect(first?.correlationId).not.toBe(second?.correlationId);
  });

  test('LOG_LEVELに従って出力を絞る', async () => {
    const harness = createHarness({ env: { LOG_LEVEL: 'warning' } });

    await harness.fetch(pageRequest());

    expect(logsOf(harness, 'client.http.access')).toEqual([]);
  });
});

describe('createFrontendServerEntry(静的な500の画面の案内文)', () => {
  const CONTACT_GUIDANCE = '解決しない場合はお問い合わせください。';
  const WITH_CONTACT =
    'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
  const WITHOUT_CONTACT =
    'ページを表示できませんでした。時間をおいて再度お試しください。';

  const FAILURES = [
    ['環境の不備', { env: { API: undefined } }],
    ['許可先の不正', { env: { IMAGES_ORIGIN: 'https://images.example:8443' } }],
    [
      '想定外の例外',
      { respond: () => Promise.reject(new Error('render failed')) },
    ],
  ] as const;

  test.each(FAILURES)(
    '%sの500は、問い合わせの導線を持つプロファイルでは問い合わせを促す案内文を出す',
    async (_name, harnessOptions) => {
      const harness = createHarness({
        ...harnessOptions,
        profile: CLIENT_TEST_PROFILE,
      });

      const response = await harness.fetch(pageRequest());

      expect(response.status).toBe(500);
      expect(await response.text()).toContain(`<h1>${WITH_CONTACT}</h1>`);
    },
  );

  test.each(FAILURES)(
    '%sの500は、問い合わせの導線を持たないプロファイルでは問い合わせを促す文を出さない',
    async (_name, harnessOptions) => {
      const harness = createHarness({
        ...harnessOptions,
        profile: ADMIN_TEST_PROFILE,
      });

      const response = await harness.fetch(pageRequest());

      expect(response.status).toBe(500);
      const html = await response.text();
      expect(html).toContain(`<h1>${WITHOUT_CONTACT}</h1>`);
      expect(html).not.toContain(CONTACT_GUIDANCE);
    },
  );
});
