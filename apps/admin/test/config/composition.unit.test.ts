import { describe, expect, test } from 'bun:test';

import { CLIENT_PROFILE } from '../../../client/src/composition/app-profile.ts';
import {
  BASE_SECURITY_POLICY_SOURCES,
  mergeSecurityPolicySources,
} from '../../lib/server/http/security-policy.ts';
import { RELAY_PATH_PREFIX } from '../../lib/server/relay/relay-contract.ts';
import { GRAPHQL_RELAY_ROUTE } from '../../lib/server/relay/relay-route.ts';
import { ADMIN_PROFILE } from '../../src/composition/app-profile.ts';
import { RELAY_ROUTES } from '../../src/composition/relay-routes.ts';
import { ADMIN_SECURITY_POLICY } from '../../src/composition/security-policy.ts';

describe('ADMIN_PROFILE', () => {
  test('管理者側として、管理者のセッションのCookieの名前とアクセス解析なしを持つ', () => {
    expect(ADMIN_PROFILE.caller).toBe('admin');
    expect(ADMIN_PROFILE.sessionCookieName).toBe('__Host-ls_admin_session');
    expect(ADMIN_PROFILE.webAnalytics).toBe(false);
  });

  test('利用者側とセッションのCookieの名前が異なる', () => {
    expect(ADMIN_PROFILE.sessionCookieName).not.toBe(
      CLIENT_PROFILE.sessionCookieName,
    );
  });

  test('prodを含むすべての環境で検索エンジンへの登録を許さない', () => {
    expect(ADMIN_PROFILE.indexable('prod')).toBe(false);
    expect(ADMIN_PROFILE.indexable('staging')).toBe(false);
    expect(ADMIN_PROFILE.indexable('local')).toBe(false);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(ADMIN_PROFILE)).toBe(true);
  });
});

describe('ADMIN_SECURITY_POLICY', () => {
  test('追加の許可先を持たない', () => {
    expect(ADMIN_SECURITY_POLICY).toEqual({});
  });

  test('基本の許可先と合成でき、合成後は基本の許可先と同じになる', () => {
    expect(
      mergeSecurityPolicySources(
        BASE_SECURITY_POLICY_SOURCES,
        ADMIN_SECURITY_POLICY,
      ),
    ).toEqual(mergeSecurityPolicySources(BASE_SECURITY_POLICY_SOURCES, {}));
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(ADMIN_SECURITY_POLICY)).toBe(true);
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
