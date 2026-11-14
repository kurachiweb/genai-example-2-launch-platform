import { describe, expect, test } from 'bun:test';

import {
  WEB_ANALYTICS_BEACON_SRC,
  webAnalyticsHeadScript,
} from './web-analytics.ts';

describe('webAnalyticsHeadScript', () => {
  test('トークンがあれば計測スクリプトを遅延読み込みする定義を返す', () => {
    const script = webAnalyticsHeadScript('0123456789abcdef0123456789abcdef');

    expect(script).toEqual({
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      defer: true,
      'data-cf-beacon': '{"token":"0123456789abcdef0123456789abcdef"}',
    });
    expect(WEB_ANALYTICS_BEACON_SRC).toBe(
      'https://static.cloudflareinsights.com/beacon.min.js',
    );
  });

  test('トークンの記号はJSONとしてエスケープし、属性の値を壊さない', () => {
    const script = webAnalyticsHeadScript('a"b\\c');

    expect(script?.['data-cf-beacon']).toBe('{"token":"a\\"b\\\\c"}');
    expect(JSON.parse(script?.['data-cf-beacon'] ?? '{}') as unknown).toEqual({
      token: 'a"b\\c',
    });
  });

  test.each([
    ['undefined', undefined],
    ['空文字', ''],
  ])(
    'トークンが無い(%s)プロファイルでは計測スクリプトを読み込まない',
    (_label, token) => {
      expect(webAnalyticsHeadScript(token)).toBeUndefined();
    },
  );

  test('返す定義は凍結されている', () => {
    const script = webAnalyticsHeadScript('token');

    expect(script).toBeDefined();
    expect(Object.isFrozen(script)).toBe(true);
  });
});
