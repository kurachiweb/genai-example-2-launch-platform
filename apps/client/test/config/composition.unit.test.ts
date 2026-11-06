import { afterEach, describe, expect, test } from 'bun:test';

import { resetSync } from '@logtape/logtape';

import {
  BASE_SECURITY_POLICY_SOURCES,
  mergeSecurityPolicySources,
} from '../../lib/server/http/security-policy.ts';
import { RELAY_PATH_PREFIX } from '../../lib/server/relay/relay-contract.ts';
import {
  FILE_DOWNLOAD_RELAY_ROUTE,
  UPLOAD_RELAY_ROUTE,
} from '../../lib/server/media/media-relay-routes.ts';
import { GRAPHQL_RELAY_ROUTE } from '../../lib/server/relay/relay-route.ts';
import { WEB_ANALYTICS_BEACON_SRC } from '../../lib/start/observability/web-analytics.ts';
import {
  createHarness,
  type Harness,
  pageRequest,
} from '../../lib/test/server-entry-fixtures.ts';
import { CLIENT_PROFILE } from '../../src/composition/app-profile.ts';
import { RELAY_ROUTES } from '../../src/composition/relay-routes.ts';
import { CLIENT_SECURITY_POLICY } from '../../src/composition/security-policy.ts';

const WEB_ANALYTICS_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com';

const WEB_ANALYTICS_REPORT_ORIGIN = 'https://cloudflareinsights.com';

const STRIPE_JS_ORIGIN = 'https://js.stripe.com';

const STRIPE_HOOKS_ORIGIN = 'https://hooks.stripe.com';

const STRIPE_API_ORIGIN = 'https://api.stripe.com';

const LINK_ORIGIN = 'https://link.com';

const STRIPE_PUBLISHABLE_KEY = `pk_test_${'0'.repeat(32)}`;

afterEach(() => {
  resetSync();
});

const directiveSourcesOf = (
  policy: string | null,
  name: string,
): readonly string[] => {
  const directive = (policy ?? '')
    .split('; ')
    .find((entry) => entry.startsWith(`${name} `));
  return directive?.split(' ').slice(1) ?? [];
};

const clientHarness = (): Harness =>
  createHarness({
    profile: CLIENT_PROFILE,
    env: { STRIPE_PUBLISHABLE_KEY },
    entryOptions: {
      relayRoutes: RELAY_ROUTES,
      securityPolicy: CLIENT_SECURITY_POLICY,
    },
  });

const onlyRenderContextOf = (harness: Harness) => {
  const [call] = harness.startCalls;
  if (harness.startCalls.length !== 1 || call === undefined) {
    throw new Error('描画は1回だけ呼ばれることを期待した');
  }
  return call.context;
};

describe('CLIENT_PROFILE', () => {
  test('利用者側として、利用者のセッションのCookieの名前とアクセス解析ありを持つ', () => {
    expect(CLIENT_PROFILE.caller).toBe('client');
    expect(CLIENT_PROFILE.sessionCookieName).toBe('__Host-ls_session');
    expect(CLIENT_PROFILE.webAnalytics).toBe(true);
  });

  test('問い合わせの画面への導線を持ち、静的な500の画面と画面の失敗の文言で問い合わせを案内する', () => {
    expect(CLIENT_PROFILE.contactAvailable).toBe(true);
  });

  test('prodだけ検索エンジンへの登録を許す', () => {
    expect(CLIENT_PROFILE.indexable('prod')).toBe(true);
    expect(CLIENT_PROFILE.indexable('staging')).toBe(false);
    expect(CLIENT_PROFILE.indexable('local')).toBe(false);
  });

  test('決済を持ち、決済の公開キーを描画とブラウザへの公開設定に渡す', async () => {
    expect(CLIENT_PROFILE.payments).toBe(true);
    const harness = clientHarness();

    await harness.fetch(pageRequest());

    expect(onlyRenderContextOf(harness).publicConfig.stripePublishableKey).toBe(
      STRIPE_PUBLISHABLE_KEY,
    );
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(CLIENT_PROFILE)).toBe(true);
  });
});

describe('CLIENT_SECURITY_POLICY', () => {
  test('Web Analyticsの計測と、Stripe.js・Linkの許可先と、支払いの機能の許可だけを加える', () => {
    expect(CLIENT_SECURITY_POLICY).toEqual({
      scriptSrc: [WEB_ANALYTICS_SCRIPT_ORIGIN, STRIPE_JS_ORIGIN],
      connectSrc: [WEB_ANALYTICS_REPORT_ORIGIN, STRIPE_API_ORIGIN, LINK_ORIGIN],
      frameSrc: [STRIPE_JS_ORIGIN, STRIPE_HOOKS_ORIGIN, LINK_ORIGIN],
      permissions: { payment: ['self', `"${STRIPE_JS_ORIGIN}"`] },
    });
  });

  test('計測スクリプトの配信元のオリジンを読み込み先に含む', () => {
    expect(CLIENT_SECURITY_POLICY.scriptSrc).toContain(
      new URL(WEB_ANALYTICS_BEACON_SRC).origin,
    );
  });

  test('基本の許可先と合成でき、合成後に追加の許可先が残る', () => {
    const merged = mergeSecurityPolicySources(
      BASE_SECURITY_POLICY_SOURCES,
      CLIENT_SECURITY_POLICY,
    );

    expect(merged.scriptSrc).toContain(WEB_ANALYTICS_SCRIPT_ORIGIN);
    expect(merged.scriptSrc).toContain(STRIPE_JS_ORIGIN);
    expect(merged.connectSrc).toContain(WEB_ANALYTICS_REPORT_ORIGIN);
    expect(merged.connectSrc).toContain(STRIPE_API_ORIGIN);
    expect(merged.frameSrc).toContain(STRIPE_HOOKS_ORIGIN);
    expect(merged.permissions?.payment).toEqual([
      'self',
      `"${STRIPE_JS_ORIGIN}"`,
    ]);
  });

  test('ページの応答のCSPとPermissions-Policyに、Stripeの許可先と支払いの機能の許可が含まれる', async () => {
    const response = await clientHarness().fetch(pageRequest());

    expect(response.status).toBe(200);
    const policy = response.headers.get('Content-Security-Policy');
    expect(directiveSourcesOf(policy, 'script-src')).toContain(
      STRIPE_JS_ORIGIN,
    );
    const frameSources = directiveSourcesOf(policy, 'frame-src');
    for (const origin of [STRIPE_JS_ORIGIN, STRIPE_HOOKS_ORIGIN, LINK_ORIGIN]) {
      expect(frameSources).toContain(origin);
    }
    const connectSources = directiveSourcesOf(policy, 'connect-src');
    for (const origin of [STRIPE_API_ORIGIN, LINK_ORIGIN]) {
      expect(connectSources).toContain(origin);
    }
    expect(response.headers.get('Permissions-Policy')).toContain(
      `payment=(self "${STRIPE_JS_ORIGIN}")`,
    );
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.scriptSrc)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.connectSrc)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.frameSrc)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.permissions)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.permissions?.payment)).toBe(
      true,
    );
  });
});

describe('RELAY_ROUTES', () => {
  test('GraphQLの中継の経路の後に、アップロードとダウンロードの中継の経路を持つ', () => {
    expect(RELAY_ROUTES).toEqual([
      GRAPHQL_RELAY_ROUTE,
      UPLOAD_RELAY_ROUTE,
      FILE_DOWNLOAD_RELAY_ROUTE,
    ]);
  });

  test('末尾が/*の経路を完全一致の経路より後に置く', () => {
    const isPrefixRoute = RELAY_ROUTES.map(({ path }) => path.endsWith('/*'));

    expect(isPrefixRoute).toEqual(isPrefixRoute.toSorted());
  });

  test('一覧と各経路が凍結されていて、defineRelayRouteの検査を経ている', () => {
    expect(Object.isFrozen(RELAY_ROUTES)).toBe(true);
    for (const route of RELAY_ROUTES) {
      expect(Object.isFrozen(route)).toBe(true);
    }
  });

  test('各経路が中継の接頭辞の下にあり、経路が重複しない', () => {
    const paths = RELAY_ROUTES.map((route) => route.path);

    for (const path of paths) {
      expect(path.startsWith(RELAY_PATH_PREFIX)).toBe(true);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });
});
