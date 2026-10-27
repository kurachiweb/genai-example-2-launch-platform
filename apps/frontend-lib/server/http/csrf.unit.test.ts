import { describe, expect, test } from 'bun:test';

import {
  type CsrfRejectReason,
  type CsrfVerdict,
  requiresCsrfCheck,
  verifyCsrf,
} from './csrf.ts';

const APP_URL = 'https://app.example/_bff/graphql';
const APP_ORIGIN = 'https://app.example';

const requestOf = (
  headers: Readonly<Record<string, string>>,
  url: string = APP_URL,
): Request => new Request(url, { method: 'POST', headers });

const rejectedWith = (reason: CsrfRejectReason): CsrfVerdict => ({
  allowed: false,
  reason,
});

describe('requiresCsrfCheck', () => {
  const check = (method: string, url: string): boolean =>
    requiresCsrfCheck(new Request(url, { method }), new URL(url));

  test.each(['GET', 'HEAD', 'OPTIONS'])(
    'サーバー関数以外への%sは検証の対象外とする',
    (method) => {
      expect(check(method, 'https://app.example/items')).toBe(false);
    },
  );

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%sは経路を問わず検証の対象とする',
    (method) => {
      expect(check(method, 'https://app.example/items')).toBe(true);
      expect(check(method, APP_URL)).toBe(true);
    },
  );

  test('未知のメソッドも検証の対象とする', () => {
    expect(check('PROPFIND', 'https://app.example/items')).toBe(true);
  });

  test.each(['GET', 'HEAD', 'OPTIONS', 'POST'])(
    'サーバー関数の呼び出しは%sでも検証の対象とする',
    (method) => {
      expect(check(method, 'https://app.example/_serverFn/abc123')).toBe(true);
    },
  );

  test.each([
    ['_を%5Fにした経路', 'https://app.example/%5FserverFn/abc'],
    ['_を小文字の%5fにした経路', 'https://app.example/%5fserverFn/abc'],
    ['FをエンコードしたFの経路', 'https://app.example/_server%46n/abc'],
  ])(
    'パーセントエンコードした経路のサーバー関数もGETで検証の対象とする(%s)',
    (_, url) => {
      expect(check('GET', url)).toBe(true);
    },
  );

  test('クエリにサーバー関数の経路を含むだけのGETは検証の対象外とする', () => {
    expect(
      check('GET', 'https://app.example/items?next=/_serverFn/abc123'),
    ).toBe(false);
  });
});

describe('verifyCsrf', () => {
  describe('Sec-Fetch-Siteがある場合はその値だけで判定する', () => {
    test('same-originは許す', () => {
      expect(
        verifyCsrf(requestOf({ 'Sec-Fetch-Site': 'same-origin' })),
      ).toEqual({ allowed: true });
    });

    test.each([
      'same-site',
      'cross-site',
      'none',
      '',
      'SAME-ORIGIN',
      'unknown',
    ])('「%s」はクロスサイトとして拒否する', (value) => {
      expect(verifyCsrf(requestOf({ 'Sec-Fetch-Site': value }))).toEqual(
        rejectedWith('cross_site_fetch'),
      );
    });

    test('Originが一致してもSec-Fetch-Siteがcross-siteなら拒否する', () => {
      expect(
        verifyCsrf(
          requestOf({ 'Sec-Fetch-Site': 'cross-site', Origin: APP_ORIGIN }),
        ),
      ).toEqual(rejectedWith('cross_site_fetch'));
    });

    test('same-originならOriginを見ない', () => {
      expect(
        verifyCsrf(
          requestOf({
            'Sec-Fetch-Site': 'same-origin',
            Origin: 'https://evil.example',
          }),
        ),
      ).toEqual({ allowed: true });
    });
  });

  describe('Sec-Fetch-Siteが無い場合はOriginを要求のURLのオリジンと比べる', () => {
    test('一致すれば許す', () => {
      expect(verifyCsrf(requestOf({ Origin: APP_ORIGIN }))).toEqual({
        allowed: true,
      });
    });

    test('既定以外のポートを含むオリジンが一致すれば許す', () => {
      expect(
        verifyCsrf(
          requestOf(
            { Origin: 'http://localhost:3000' },
            'http://localhost:3000/_bff/graphql',
          ),
        ),
      ).toEqual({ allowed: true });
    });

    test.each([
      ['別のサイト', 'https://evil.example'],
      ['サブドメイン', 'https://sub.app.example'],
      ['同じホストの別のスキーム', 'http://app.example'],
      ['同じホストの別のポート', 'https://app.example:8443'],
      ['既定のポートを明示した表記', 'https://app.example:443'],
      ['末尾のスラッシュ', 'https://app.example/'],
      ['経路を含む表記', 'https://app.example/_bff/graphql'],
      ['大文字のホスト', 'https://APP.example'],
      ['大文字のスキーム', 'HTTPS://app.example'],
      ['不透明なオリジンのnull', 'null'],
      ['空の値', ''],
      ['複数の値', `${APP_ORIGIN}, https://evil.example`],
      ['接頭辞が一致する別のホスト', 'https://app.example.evil.example'],
    ])('%sは不一致として拒否する(%s)', (_, origin) => {
      expect(verifyCsrf(requestOf({ Origin: origin }))).toEqual(
        rejectedWith('origin_mismatch'),
      );
    });
  });

  describe('Refererでは判定しない', () => {
    test('両方の欠落はヘッダーの欠落として拒否する', () => {
      expect(verifyCsrf(requestOf({}))).toEqual(
        rejectedWith('missing_headers'),
      );
    });

    test('同じオリジンのRefererだけの要求はヘッダーの欠落として拒否する', () => {
      expect(verifyCsrf(requestOf({ Referer: `${APP_ORIGIN}/items` }))).toEqual(
        rejectedWith('missing_headers'),
      );
    });

    test('Originが不一致なら同じオリジンのRefererがあっても拒否する', () => {
      expect(
        verifyCsrf(
          requestOf({
            Origin: 'https://evil.example',
            Referer: `${APP_ORIGIN}/items`,
          }),
        ),
      ).toEqual(rejectedWith('origin_mismatch'));
    });
  });

  test('拒否の結果はallowedと3種のうち1つの理由だけを持つ', () => {
    const rejected = [
      requestOf({}),
      requestOf({ Referer: `${APP_ORIGIN}/items` }),
      requestOf({ 'Sec-Fetch-Site': 'cross-site' }),
      requestOf({ 'Sec-Fetch-Site': 'same-site' }),
      requestOf({ 'Sec-Fetch-Site': 'none' }),
      requestOf({ Origin: 'https://evil.example' }),
      requestOf({ Origin: 'null' }),
    ].map((request) => verifyCsrf(request));

    for (const verdict of rejected) {
      expect(Object.keys(verdict).toSorted()).toEqual(['allowed', 'reason']);
      expect(verdict.allowed).toBe(false);
      expect(verdict.allowed ? undefined : verdict.reason).toBeOneOf([
        'missing_headers',
        'cross_site_fetch',
        'origin_mismatch',
      ]);
    }
  });
});
