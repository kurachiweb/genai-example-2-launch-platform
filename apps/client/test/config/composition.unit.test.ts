import { describe, expect, test } from 'bun:test';

import {
  BASE_SECURITY_POLICY_SOURCES,
  mergeSecurityPolicySources,
} from '../../lib/server/http/security-policy.ts';
import { RELAY_PATH_PREFIX } from '../../lib/server/relay/relay-contract.ts';
import { GRAPHQL_RELAY_ROUTE } from '../../lib/server/relay/relay-route.ts';
import { WEB_ANALYTICS_BEACON_SRC } from '../../lib/start/observability/web-analytics.ts';
import { CLIENT_PROFILE } from '../../src/composition/app-profile.ts';
import { RELAY_ROUTES } from '../../src/composition/relay-routes.ts';
import { CLIENT_SECURITY_POLICY } from '../../src/composition/security-policy.ts';

const WEB_ANALYTICS_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com';

const WEB_ANALYTICS_REPORT_ORIGIN = 'https://cloudflareinsights.com';

describe('CLIENT_PROFILE', () => {
  test('利用者側として、利用者のセッションのCookieの名前とアクセス解析ありを持つ', () => {
    expect(CLIENT_PROFILE.caller).toBe('client');
    expect(CLIENT_PROFILE.sessionCookieName).toBe('__Host-ls_session');
    expect(CLIENT_PROFILE.webAnalytics).toBe(true);
  });

  test('prodだけ検索エンジンへの登録を許す', () => {
    expect(CLIENT_PROFILE.indexable('prod')).toBe(true);
    expect(CLIENT_PROFILE.indexable('staging')).toBe(false);
    expect(CLIENT_PROFILE.indexable('local')).toBe(false);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(CLIENT_PROFILE)).toBe(true);
  });
});

describe('CLIENT_SECURITY_POLICY', () => {
  test('Web Analyticsの計測スクリプトの読み込み先と送信先だけを許可先に加える', () => {
    expect(CLIENT_SECURITY_POLICY).toEqual({
      scriptSrc: [WEB_ANALYTICS_SCRIPT_ORIGIN],
      connectSrc: [WEB_ANALYTICS_REPORT_ORIGIN],
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
    expect(merged.connectSrc).toContain(WEB_ANALYTICS_REPORT_ORIGIN);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.scriptSrc)).toBe(true);
    expect(Object.isFrozen(CLIENT_SECURITY_POLICY.connectSrc)).toBe(true);
  });
});

describe('RELAY_ROUTES', () => {
  test('初版はGraphQLの中継の経路だけを持つ', () => {
    expect(RELAY_ROUTES).toEqual([GRAPHQL_RELAY_ROUTE]);
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
