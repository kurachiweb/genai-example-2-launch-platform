import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import type { FrontendRequestContext } from '../server/entry/request-context.ts';
import {
  type AppRuntime,
  createAppRuntimeHolder,
  createRouterContext,
  dehydrateAppRuntime,
  hydrateAppRuntime,
  toAppRuntime,
} from './router-context.ts';

const SESSION_TOKEN = 'session-token-must-not-leak';
const CLIENT_IP = '203.0.113.7';
const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';
const CORRELATION_ID = 'correlation-id-of-request';

const APP_RUNTIME: AppRuntime = {
  publicConfig: {
    environment: 'staging',
    turnstileSiteKey: '1x00000000000000000000AA',
    sentry: {
      dsn: undefined,
      environment: 'staging',
      tracesSampleRate: 0.1,
    },
    webAnalyticsToken: 'analytics-token',
  },
  display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
};

const requestContextOf = (): FrontendRequestContext => ({
  nonce: NONCE,
  correlationId: CORRELATION_ID,
  display: APP_RUNTIME.display,
  publicConfig: APP_RUNTIME.publicConfig,
  relay: {
    clientIp: CLIENT_IP,
    sessionToken: SESSION_TOKEN,
    traceHeaders: {},
  },
  api: { fetch: () => Promise.resolve(new Response(null)) },
  sessionCookieName: '__Host-test_session',
});

describe('createAppRuntimeHolder', () => {
  test('未設定の入れ物を読むと例外になる', () => {
    const holder = createAppRuntimeHolder(undefined);

    expect(() => holder.get()).toThrow(Error);
  });

  test('未設定の入れ物は1回だけ設定でき、設定した値を読める', () => {
    const holder = createAppRuntimeHolder(undefined);

    holder.set(APP_RUNTIME);

    expect(holder.get()).toEqual(APP_RUNTIME);
    expect(() => {
      holder.set(APP_RUNTIME);
    }).toThrow(Error);
    expect(holder.get()).toEqual(APP_RUNTIME);
  });

  test('初期値を渡した入れ物は初期値を読め、設定し直せない', () => {
    const holder = createAppRuntimeHolder(APP_RUNTIME);

    expect(holder.get()).toEqual(APP_RUNTIME);
    expect(() => {
      holder.set(APP_RUNTIME);
    }).toThrow(Error);
  });
});

describe('createRouterContext', () => {
  test('2回呼ぶと別々のQueryClient・Jotaiのストア・実行時の値の入れ物を返す', () => {
    const first = createRouterContext(undefined);
    const second = createRouterContext(undefined);

    expect(first.queryClient).toBeInstanceOf(QueryClient);
    expect(second.queryClient).toBeInstanceOf(QueryClient);
    expect(first.queryClient).not.toBe(second.queryClient);
    expect(first.jotaiStore).not.toBe(second.jotaiStore);
    expect(first.runtime).not.toBe(second.runtime);
  });

  test('QueryClientはアプリの既定値を持つ', () => {
    const { queryClient } = createRouterContext(undefined);

    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  test('初期値を渡すと実行時の値を読め、渡さなければ読むと例外になる', () => {
    expect(createRouterContext(APP_RUNTIME).runtime.get()).toEqual(APP_RUNTIME);
    expect(() => createRouterContext(undefined).runtime.get()).toThrow(Error);
  });
});

describe('dehydrateAppRuntime・hydrateAppRuntime', () => {
  test('dehydrateした値をJSONで受け渡してhydrateすると同じ実行時の値が戻る', () => {
    const server = createRouterContext(APP_RUNTIME);
    const browser = createRouterContext(undefined);

    const transferred: unknown = JSON.parse(
      JSON.stringify(dehydrateAppRuntime(server)),
    );
    hydrateAppRuntime(browser, transferred as { runtime: AppRuntime });

    expect(browser.runtime.get()).toEqual(APP_RUNTIME);
  });

  test('実行時の値が未設定ならdehydrateは例外になる', () => {
    expect(() => dehydrateAppRuntime(createRouterContext(undefined))).toThrow(
      Error,
    );
  });

  test('余分な項目を持つ値を設定しても、dehydrateは公開設定と表示設定だけを返し秘密を直列化しない', () => {
    const context = createRouterContext(requestContextOf());

    const dehydrated = dehydrateAppRuntime(context);
    const serialized = JSON.stringify(dehydrated);

    expect(Object.keys(dehydrated)).toEqual(['runtime']);
    expect(Object.keys(dehydrated.runtime).sort()).toEqual([
      'display',
      'publicConfig',
    ]);
    expect(dehydrated.runtime).toEqual(APP_RUNTIME);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain(NONCE);
    expect(serialized).not.toContain(CORRELATION_ID);
    expect(serialized).not.toContain('"relay"');
    expect(serialized).not.toContain('"api"');
    expect(serialized).not.toContain('__Host-');
  });

  test('設定済みの入れ物へhydrateすると例外になる', () => {
    const context = createRouterContext(APP_RUNTIME);

    expect(() => {
      hydrateAppRuntime(context, { runtime: APP_RUNTIME });
    }).toThrow(Error);
  });
});

describe('toAppRuntime', () => {
  test('描画の文脈から公開設定と表示設定だけを取り出す', () => {
    const runtime = toAppRuntime(requestContextOf());

    expect(Object.keys(runtime).sort()).toEqual(['display', 'publicConfig']);
    expect(runtime).toEqual(APP_RUNTIME);
  });

  test('dehydrateされる値にセッション識別子・接続元・APIの呼び出し口・nonce・相関IDを含めない', () => {
    const context = createRouterContext(toAppRuntime(requestContextOf()));

    const serialized = JSON.stringify(dehydrateAppRuntime(context));

    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain(NONCE);
    expect(serialized).not.toContain(CORRELATION_ID);
    expect(serialized).not.toContain('"relay"');
    expect(serialized).not.toContain('"api"');
    expect(serialized).not.toContain('__Host-');
  });
});
