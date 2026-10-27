import { describe, expect, test } from 'bun:test';

import {
  BASE_SECURITY_POLICY_SOURCES,
  buildPageContentSecurityPolicy,
  buildPermissionsPolicy,
  mergeSecurityPolicySources,
  NON_PAGE_CONTENT_SECURITY_POLICY,
  runtimeSecurityPolicySources,
  type SecurityPolicySources,
} from './security-policy.ts';

const NONCE = 'q0Zx4mT3bY8vR2kL9pW1sA==';
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const IMAGES_ORIGIN = 'https://images.example';
const SENTRY_DSN = 'https://public-key@o1.ingest.sentry.example/42';
const SENTRY_ORIGIN = 'https://o1.ingest.sentry.example';

// api-gatewayのSECURITY_HEADERSのPermissions-Policyと同じ値
const API_GATEWAY_PERMISSIONS_POLICY =
  'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()';

const directivesOf = (policy: string): ReadonlyMap<string, readonly string[]> =>
  new Map(
    policy.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values] as const;
    }),
  );

const pagePolicy = (
  sources: SecurityPolicySources = {},
  upgradeInsecureRequests = false,
): string =>
  buildPageContentSecurityPolicy({
    nonce: NONCE,
    sources,
    upgradeInsecureRequests,
  });

describe('buildPageContentSecurityPolicy', () => {
  test('許可先が無ければ設計のディレクティブだけを順に並べる', () => {
    expect(pagePolicy()).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "manifest-src 'self'",
      ].join('; '),
    );
  });

  test('要求のnonceをscript-srcだけに入れる', () => {
    const directives = directivesOf(pagePolicy());

    const withNonce = [...directives].filter(([, values]) =>
      values.includes(`'nonce-${NONCE}'`),
    );

    expect(withNonce.map(([name]) => name)).toEqual(['script-src']);
  });

  test('許可先をディレクティブごとに既定の値の後へ加える', () => {
    const directives = directivesOf(
      pagePolicy({
        scriptSrc: ['https://script.example'],
        styleSrc: ['https://style.example'],
        imgSrc: [IMAGES_ORIGIN],
        fontSrc: ['https://font.example'],
        connectSrc: [SENTRY_ORIGIN],
        frameSrc: [TURNSTILE_ORIGIN],
        formAction: ['https://form.example'],
      }),
    );

    expect(directives.get('script-src')).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      'https://script.example',
    ]);
    expect(directives.get('style-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://style.example',
    ]);
    expect(directives.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      IMAGES_ORIGIN,
    ]);
    expect(directives.get('font-src')).toEqual([
      "'self'",
      'https://font.example',
    ]);
    expect(directives.get('connect-src')).toEqual(["'self'", SENTRY_ORIGIN]);
    expect(directives.get('frame-src')).toEqual([TURNSTILE_ORIGIN]);
    expect(directives.get('form-action')).toEqual([
      "'self'",
      'https://form.example',
    ]);
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });

  test("許可先の'self'や重複を既定の値と重ねない", () => {
    const directives = directivesOf(
      pagePolicy({
        connectSrc: ["'self'", SENTRY_ORIGIN, SENTRY_ORIGIN],
        frameSrc: ["'self'"],
      }),
    );

    expect(directives.get('connect-src')).toEqual(["'self'", SENTRY_ORIGIN]);
    expect(directives.get('frame-src')).toEqual(["'self'"]);
  });

  test('デプロイ先の環境だけ安全でない通信の格上げを末尾に付ける', () => {
    expect(pagePolicy({}, true)).toBe(
      `${pagePolicy({}, false)}; upgrade-insecure-requests`,
    );
    expect(
      directivesOf(pagePolicy({}, false)).has('upgrade-insecure-requests'),
    ).toBe(false);
  });

  test("既定と環境ごとの許可先を合わせても'strict-dynamic'・'unsafe-eval'・*を含まない", () => {
    const sources = mergeSecurityPolicySources(
      BASE_SECURITY_POLICY_SOURCES,
      runtimeSecurityPolicySources({ IMAGES_ORIGIN, SENTRY_DSN }),
      {
        scriptSrc: ['https://static.cloudflareinsights.com'],
        connectSrc: ['https://cloudflareinsights.com'],
      },
    );

    const values = [...directivesOf(pagePolicy(sources, true)).values()].flat();

    expect(values).not.toContain("'strict-dynamic'");
    expect(values).not.toContain("'unsafe-eval'");
    expect(values.some((value) => value.includes('*'))).toBe(false);
  });

  test.each([
    ['空文字列', ''],
    ['引用符と区切りを含む値', "abc' 'unsafe-eval'; script-src *"],
    ['空白を含む値', 'abc def'],
    ['改行を含む値', 'abc\r\ndef'],
  ])('nonceがbase64の形でなければ例外にする(%s)', (_, nonce) => {
    expect(() =>
      buildPageContentSecurityPolicy({
        nonce,
        sources: {},
        upgradeInsecureRequests: false,
      }),
    ).toThrow();
  });

  test('不正な許可先を含めば例外にする', () => {
    expect(() => pagePolicy({ scriptSrc: ['*'] })).toThrow();
  });
});

describe('NON_PAGE_CONTENT_SECURITY_POLICY', () => {
  test('すべてを拒否し、埋め込みを禁じるapi-gatewayの既定のCSPと同じ値を持つ', () => {
    expect(NON_PAGE_CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });
});

describe('BASE_SECURITY_POLICY_SOURCES', () => {
  test('bot判定(Turnstile)のスクリプトと埋め込みだけを許可する', () => {
    expect(BASE_SECURITY_POLICY_SOURCES).toEqual({
      scriptSrc: [TURNSTILE_ORIGIN],
      frameSrc: [TURNSTILE_ORIGIN],
    });
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(BASE_SECURITY_POLICY_SOURCES)).toBe(true);
    expect(Object.isFrozen(BASE_SECURITY_POLICY_SOURCES.scriptSrc)).toBe(true);
    expect(Object.isFrozen(BASE_SECURITY_POLICY_SOURCES.frameSrc)).toBe(true);
  });
});

describe('runtimeSecurityPolicySources', () => {
  test('画像配信のオリジンをimg-srcへ、SentryのDSNのオリジンだけをconnect-srcへ入れる', () => {
    expect(runtimeSecurityPolicySources({ IMAGES_ORIGIN, SENTRY_DSN })).toEqual(
      { imgSrc: [IMAGES_ORIGIN], connectSrc: [SENTRY_ORIGIN] },
    );
  });

  test('DSNが無ければconnect-srcへ何も入れない', () => {
    expect(
      runtimeSecurityPolicySources({ IMAGES_ORIGIN, SENTRY_DSN: undefined }),
    ).toEqual({ imgSrc: [IMAGES_ORIGIN] });
  });

  test('URLとして解釈できないDSNはSentryが送信しないためconnect-srcへ何も入れない', () => {
    expect(
      runtimeSecurityPolicySources({ IMAGES_ORIGIN, SENTRY_DSN: 'not a url' }),
    ).toEqual({ imgSrc: [IMAGES_ORIGIN] });
  });

  test('ローカルの画像配信のオリジンも合成で受け付けられる', () => {
    const sources = runtimeSecurityPolicySources({
      IMAGES_ORIGIN: 'http://localhost:48043',
      SENTRY_DSN: undefined,
    });

    expect(mergeSecurityPolicySources(sources).imgSrc).toEqual([
      'http://localhost:48043',
    ]);
  });

  test('凍結されている', () => {
    const sources = runtimeSecurityPolicySources({ IMAGES_ORIGIN, SENTRY_DSN });

    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(sources.imgSrc)).toBe(true);
    expect(Object.isFrozen(sources.connectSrc)).toBe(true);
  });
});

describe('mergeSecurityPolicySources', () => {
  test('ディレクティブごとに最初に現れた順の和集合を作り、重複を除く', () => {
    const merged = mergeSecurityPolicySources(
      { scriptSrc: ['https://a.example', 'https://b.example'] },
      {
        scriptSrc: ['https://b.example', 'https://c.example'],
        imgSrc: [IMAGES_ORIGIN],
      },
      { scriptSrc: ['https://a.example'], imgSrc: [IMAGES_ORIGIN] },
    );

    expect(merged).toEqual({
      scriptSrc: [
        'https://a.example',
        'https://b.example',
        'https://c.example',
      ],
      imgSrc: [IMAGES_ORIGIN],
    });
  });

  test('Permissions-Policyの許可先を機能ごとに合成し、重複を除く', () => {
    const merged = mergeSecurityPolicySources(
      { permissions: { payment: ['self', '"https://pay.example"'] } },
      {
        permissions: {
          payment: ['"https://pay.example"'],
          fullscreen: ['self'],
        },
      },
    );

    expect(merged).toEqual({
      permissions: {
        payment: ['self', '"https://pay.example"'],
        fullscreen: ['self'],
      },
    });
  });

  test('引数が無ければ空の許可先を返す', () => {
    expect(mergeSecurityPolicySources()).toEqual({});
  });

  test('結果は凍結されている', () => {
    const merged = mergeSecurityPolicySources({
      scriptSrc: ['https://a.example'],
      permissions: { payment: ['self'] },
    });

    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.scriptSrc)).toBe(true);
    expect(Object.isFrozen(merged.permissions)).toBe(true);
    expect(Object.isFrozen(merged.permissions?.payment)).toBe(true);
  });

  test.each([
    "'self'",
    'https://a.example',
    'https://sub.a-b.example',
    'http://localhost:48043',
  ])('許可先の値%sを受け付ける', (value) => {
    expect(mergeSecurityPolicySources({ connectSrc: [value] })).toEqual({
      connectSrc: [value],
    });
  });

  test.each([
    ['ワイルドカード', '*'],
    ['ホストのワイルドカード', 'https://*.example'],
    ['スキームだけ', 'https:'],
    ['data:', 'data:'],
    ['blob:', 'blob:'],
    ["'unsafe-inline'", "'unsafe-inline'"],
    ["'unsafe-eval'", "'unsafe-eval'"],
    ["'strict-dynamic'", "'strict-dynamic'"],
    ["'none'", "'none'"],
    ['nonce', "'nonce-abc'"],
    ['引用符の無いself', 'self'],
    ['localhost以外のhttp', 'http://a.example'],
    ['ポートの無いlocalhost', 'http://localhost'],
    ['パス付き', 'https://a.example/path'],
    ['末尾のスラッシュ', 'https://a.example/'],
    ['利用者情報付き', 'https://user@a.example'],
    ['大文字のホスト', 'https://A.example'],
    ['空白で区切った複数の値', "'self' https://a.example"],
    ['ディレクティブの区切りを含む値', 'https://a.example; script-src *'],
    ['空文字列', ''],
  ])('不正な許可先の値を例外にする(%s)', (_, value) => {
    expect(() => mergeSecurityPolicySources({ scriptSrc: [value] })).toThrow();
  });

  test.each([
    'styleSrc',
    'imgSrc',
    'fontSrc',
    'connectSrc',
    'frameSrc',
    'formAction',
  ] as const)('%sの不正な許可先も例外にする', (directive) => {
    expect(() => mergeSecurityPolicySources({ [directive]: ['*'] })).toThrow();
  });

  test.each(['self', '"https://pay.example"', '"http://localhost:48044"'])(
    'Permissions-Policyの許可先%sを受け付ける',
    (value) => {
      expect(
        mergeSecurityPolicySources({ permissions: { payment: [value] } }),
      ).toEqual({ permissions: { payment: [value] } });
    },
  );

  test.each([
    ['ワイルドカード', '*'],
    ['引用符で囲んだワイルドカード', '"*"'],
    ["CSPの書き方の'self'", "'self'"],
    ['引用符の無いオリジン', 'https://pay.example'],
    ['localhost以外のhttp', '"http://pay.example"'],
    ['src', 'src'],
    ['括弧を含む値', '()'],
    ['空文字列', ''],
  ])('Permissions-Policyの不正な許可先を例外にする(%s)', (_, value) => {
    expect(() =>
      mergeSecurityPolicySources({ permissions: { payment: [value] } }),
    ).toThrow();
  });

  test('未知の機能のPermissions-Policyを例外にする', () => {
    const permissions = JSON.parse('{"bluetooth":["self"]}') as NonNullable<
      SecurityPolicySources['permissions']
    >;

    expect(() => mergeSecurityPolicySources({ permissions })).toThrow();
  });
});

describe('buildPermissionsPolicy', () => {
  test('許可が無ければすべての機能を拒否するapi-gatewayと同じ値を返す', () => {
    expect(buildPermissionsPolicy({})).toBe(API_GATEWAY_PERMISSIONS_POLICY);
  });

  test('登録された機能だけに許可先を入れ、他の機能と並び順を保つ', () => {
    expect(
      buildPermissionsPolicy({
        permissions: { payment: ['self', '"https://pay.example"'] },
      }),
    ).toBe(
      API_GATEWAY_PERMISSIONS_POLICY.replace(
        'payment=()',
        'payment=(self "https://pay.example")',
      ),
    );
  });

  test('許可先の重複を除く', () => {
    expect(
      buildPermissionsPolicy({ permissions: { fullscreen: ['self', 'self'] } }),
    ).toContain('fullscreen=(self)');
  });

  test('不正な許可先を含めば例外にする', () => {
    expect(() =>
      buildPermissionsPolicy({ permissions: { camera: ['*'] } }),
    ).toThrow();
  });
});
