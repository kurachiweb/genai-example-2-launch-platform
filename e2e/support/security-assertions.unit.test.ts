import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type CspViolation,
  findParserBlockingScriptTags,
  findScriptTagsWithoutNonce,
  findSecurityHeaderProblems,
  installCspViolationRecorder,
  readCspViolations,
  readParserBlockingScriptSources,
  scriptNonceOf,
  scriptTagsFromHost,
  staticScriptUrlsOf,
} from './security-assertions.ts';

const NONCE = 'nB8YjDxI4/WguAZf7/HvfA==';

const PAGE_CSP = `default-src 'self'; script-src 'self' 'nonce-${NONCE}' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;

const NON_PAGE_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=()',
  'cache-control': 'no-store',
};

const pageHeaders = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string>> =>
  withOverrides(
    { ...COMMON_HEADERS, 'content-security-policy': PAGE_CSP },
    overrides,
  );

const nonPageHeaders = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string>> =>
  withOverrides(
    { ...COMMON_HEADERS, 'content-security-policy': NON_PAGE_CSP },
    overrides,
  );

function withOverrides(
  base: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries({ ...base, ...overrides }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

describe('findSecurityHeaderProblems', () => {
  test('ページの応答に必要なヘッダーがすべて揃っていれば問題は無い', () => {
    expect(findSecurityHeaderProblems(pageHeaders(), 'page')).toEqual([]);
  });

  test('ページ以外の応答はnonceの無いCSPでも問題は無い', () => {
    expect(findSecurityHeaderProblems(nonPageHeaders(), 'non-page')).toEqual(
      [],
    );
  });

  test('静的なファイルの応答は長期のキャッシュを許し、no-storeを求めない', () => {
    const headers = nonPageHeaders({
      'cache-control': 'public, max-age=31536000, immutable',
    });

    expect(findSecurityHeaderProblems(headers, 'static-file')).toEqual([]);
  });

  test('静的なファイルの応答でもCache-Control以外の共通のヘッダーを求める', () => {
    const headers = nonPageHeaders({
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': undefined,
      'content-security-policy': "default-src 'none'",
    });

    expect(findSecurityHeaderProblems(headers, 'static-file')).toEqual([
      'X-Content-Type-Optionsがありません',
      "Content-Security-Policyにframe-ancestors 'none'がありません",
    ]);
  });

  test('ヘッダー名の大文字と小文字を区別しない', () => {
    const headers = Object.fromEntries(
      Object.entries(pageHeaders()).map(([name, value]) => [
        name.toUpperCase(),
        value,
      ]),
    );

    expect(findSecurityHeaderProblems(headers, 'page')).toEqual([]);
  });

  test.each([
    ['strict-transport-security', 'Strict-Transport-Security'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['referrer-policy', 'Referrer-Policy'],
    ['permissions-policy', 'Permissions-Policy'],
    ['cache-control', 'Cache-Control'],
    ['content-security-policy', 'Content-Security-Policy'],
  ])('%sが無ければヘッダー名を挙げる', (name, displayName) => {
    const problems = findSecurityHeaderProblems(
      pageHeaders({ [name]: undefined }),
      'page',
    );

    expect(problems.some((problem) => problem.includes(displayName))).toBe(
      true,
    );
  });

  test.each([
    ['strict-transport-security', 'includeSubDomains'],
    ['x-content-type-options', 'sniff'],
    ['referrer-policy', 'no-referrer'],
    ['permissions-policy', ''],
    ['cache-control', 'no-cache'],
  ])('%sの値が要件と違えば問題として挙げる', (name, value) => {
    expect(
      findSecurityHeaderProblems(pageHeaders({ [name]: value }), 'page'),
    ).toHaveLength(1);
  });

  test("CSPにframe-ancestors 'none'が無ければ問題として挙げる", () => {
    const problems = findSecurityHeaderProblems(
      pageHeaders({
        'content-security-policy': PAGE_CSP.replace(
          "; frame-ancestors 'none'",
          '',
        ),
      }),
      'page',
    );

    expect(problems).toEqual([
      "Content-Security-Policyにframe-ancestors 'none'がありません",
    ]);
  });

  test('ページの応答のCSPのscript-srcにnonceが無ければ問題として挙げる', () => {
    const problems = findSecurityHeaderProblems(
      pageHeaders({
        'content-security-policy': PAGE_CSP.replace(` 'nonce-${NONCE}'`, ''),
      }),
      'page',
    );

    expect(problems).toEqual([
      'Content-Security-Policyのscript-srcにnonceがありません',
    ]);
  });

  test.each(["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'"])(
    'ページの応答のCSPのscript-srcに%sがあれば問題として挙げる',
    (source) => {
      const problems = findSecurityHeaderProblems(
        pageHeaders({
          'content-security-policy': PAGE_CSP.replace(
            "script-src 'self'",
            `script-src 'self' ${source}`,
          ),
        }),
        'page',
      );

      expect(problems).toEqual([
        `Content-Security-Policyのscript-srcに${source}があります`,
      ]);
    },
  );
});

describe('scriptNonceOf', () => {
  test('script-srcのnonceの値を返す', () => {
    expect(scriptNonceOf(PAGE_CSP)).toBe(NONCE);
  });

  test('script-src以外の指示子のnonceは返さない', () => {
    expect(
      scriptNonceOf(`default-src 'self'; style-src 'nonce-${NONCE}'`),
    ).toBeUndefined();
  });

  test('空の指示子を読み飛ばし、重なったscript-srcは最初のものを使う', () => {
    expect(
      scriptNonceOf("; script-src 'nonce-first';; script-src 'nonce-second';"),
    ).toBe('first');
  });

  test('script-srcが無ければundefinedを返す', () => {
    expect(scriptNonceOf(NON_PAGE_CSP)).toBeUndefined();
  });
});

describe('findScriptTagsWithoutNonce', () => {
  test('すべてのscript要素が同じnonceを持てば空の配列を返す', () => {
    const html = `<head><script nonce="${NONCE}">a()</script><script type="module" async="" src="/entry.js" nonce="${NONCE}"></script></head><body><script nonce='${NONCE}' data-tsr-stream-part="">b()</script></body>`;

    expect(findScriptTagsWithoutNonce(html, NONCE)).toEqual([]);
  });

  test('nonceの無いscript要素と値の違うscript要素の開始タグを返す', () => {
    const html = `<script nonce="${NONCE}">a()</script><script src="/plain.js"></script><SCRIPT nonce="other">b()</SCRIPT>`;

    expect(findScriptTagsWithoutNonce(html, NONCE)).toEqual([
      '<script src="/plain.js">',
      '<SCRIPT nonce="other">',
    ]);
  });

  test('scriptで始まる別の要素名を対象にしない', () => {
    const html = '<scripts></scripts><script-like></script-like>';

    expect(findScriptTagsWithoutNonce(html, NONCE)).toEqual([]);
  });
});

describe('findParserBlockingScriptTags', () => {
  test('async・defer・モジュールの外部スクリプトとインラインのスクリプトは対象にしない', () => {
    const html = [
      '<script>inline()</script>',
      '<script src="/a.js" async></script>',
      '<script src="https://static.cloudflareinsights.com/beacon.min.js" defer=""></script>',
      '<script type="module" src="/entry.js"></script>',
      '<script type="MODULE" src="/upper.js"></script>',
    ].join('');

    expect(findParserBlockingScriptTags(html)).toEqual([]);
  });

  test('asyncもdeferも無い古典的な外部スクリプトの開始タグを返す', () => {
    const html =
      '<script src="https://browser.sentry-cdn.example/bundle.min.js" crossorigin="anonymous"></script><script type="text/javascript" src=/b.js></script>';

    expect(findParserBlockingScriptTags(html)).toEqual([
      '<script src="https://browser.sentry-cdn.example/bundle.min.js" crossorigin="anonymous">',
      '<script type="text/javascript" src=/b.js>',
    ]);
  });
});

describe('staticScriptUrlsOf', () => {
  test('同じオリジンのscript要素のsrcとmodulepreloadのhrefを絶対URLで返す', () => {
    const html = [
      '<link rel="stylesheet" href="/assets/styles.css">',
      '<link rel="modulepreload" href="/assets/index.js">',
      '<script type="module" async="" src="/assets/index.js"></script>',
      '<script src="https://static.cloudflareinsights.com/beacon.min.js" defer></script>',
      '<script>inline()</script>',
      '<link rel="modulepreload" href="chunk.js">',
    ].join('');

    expect(
      staticScriptUrlsOf(html, 'http://localhost:48044/system/status'),
    ).toEqual([
      'http://localhost:48044/assets/index.js',
      'http://localhost:48044/system/chunk.js',
    ]);
  });

  test('Viteの開発サーバーが変換して配信するモジュールはビルドの成果物ではないため含めない', () => {
    const html = [
      '<link rel="modulepreload" href="/@id/virtual:tanstack-start-dev-client-entry">',
      '<script type="module" async="" src="/@id/virtual:tanstack-start-dev-client-entry"></script>',
      '<script type="module" src="/@vite/client"></script>',
    ].join('');

    expect(
      staticScriptUrlsOf(html, 'http://localhost:48044/system/status'),
    ).toEqual([]);
  });
});

describe('scriptTagsFromHost', () => {
  test('指定したホストから読み込むscript要素のdeferとnonceを返す', () => {
    const html = [
      `<script nonce="${NONCE}">inline()</script>`,
      `<script src="https://static.cloudflareinsights.com/beacon.min.js" defer="" data-cf-beacon="{}" nonce="${NONCE}"></script>`,
      '<script src="https://static.cloudflareinsights.com/other.js" async></script>',
      '<script src="https://cloudflareinsights.com.example/beacon.min.js" defer></script>',
      '<script type="module" src="/assets/index.js"></script>',
    ].join('');

    expect(scriptTagsFromHost(html, 'static.cloudflareinsights.com')).toEqual([
      {
        source: `<script src="https://static.cloudflareinsights.com/beacon.min.js" defer="" data-cf-beacon="{}" nonce="${NONCE}">`,
        defer: true,
        nonce: NONCE,
      },
      {
        source:
          '<script src="https://static.cloudflareinsights.com/other.js" async>',
        defer: false,
        nonce: undefined,
      },
    ]);
  });

  test('該当するscript要素が無ければ空の配列を返す', () => {
    expect(
      scriptTagsFromHost(
        '<script type="module" src="/assets/index.js"></script>',
        'static.cloudflareinsights.com',
      ),
    ).toEqual([]);
  });
});

interface FakeScript {
  readonly src: string;
  readonly async: boolean;
  readonly defer: boolean;
  readonly type: string;
}

let globalKeysBeforeTest: ReadonlySet<PropertyKey> = new Set();

// 偽のdocumentと、記録の関数がglobalThisへ置いた値を、テストごとに取り除く
beforeEach(() => {
  globalKeysBeforeTest = new Set(Reflect.ownKeys(globalThis));
});

afterEach(() => {
  for (const key of Reflect.ownKeys(globalThis)) {
    if (!globalKeysBeforeTest.has(key)) {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

const setGlobal = (key: string, value: unknown): void => {
  Reflect.set(globalThis, key, value);
};

// ページの関数をブラウザに送らず、この実行環境のglobalThisに対して呼び出す偽のページ
const fakePage = {
  addInitScript: async <Arg>(
    script: (arg: Arg) => unknown,
    arg: Arg,
  ): Promise<void> => {
    script(arg);
    await Promise.resolve();
  },
  evaluate: async <R, Arg>(
    pageFunction: (arg: Arg) => R | Promise<R>,
    arg: Arg,
  ): Promise<R> => pageFunction(arg),
};

const violationEvent = (violation: CspViolation): Event =>
  Object.assign(new Event('securitypolicyviolation'), violation);

describe('CSPの違反の記録', () => {
  test('記録を始めた後に起きた違反を起きた順に返す', async () => {
    const document = new EventTarget();
    setGlobal('document', document);
    const first: CspViolation = {
      effectiveDirective: 'script-src-elem',
      blockedURI: 'inline',
      sourceFile: 'http://localhost:48044/system/status',
      lineNumber: 1,
      sample: 'alert(1)',
    };
    const second: CspViolation = {
      effectiveDirective: 'script-src',
      blockedURI: 'eval',
      sourceFile: 'http://localhost:48044/assets/index.js',
      lineNumber: 10,
      sample: '',
    };

    await installCspViolationRecorder(fakePage);
    document.dispatchEvent(violationEvent(first));
    document.dispatchEvent(violationEvent(second));

    expect(await readCspViolations(fakePage)).toEqual([first, second]);
  });

  test('違反が起きていなければ空の配列を返す', async () => {
    setGlobal('document', new EventTarget());

    await installCspViolationRecorder(fakePage);

    expect(await readCspViolations(fakePage)).toEqual([]);
  });

  test('記録を始めていないページでは違反が無いと取り違えないよう例外を投げる', async () => {
    const rejection: unknown = await readCspViolations(fakePage).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(String(rejection)).toContain('CSPの違反の記録が始まっていません');
  });
});

describe('readParserBlockingScriptSources', () => {
  test('文書のうちasync・defer・モジュールのいずれでもない外部スクリプトのURLを返す', async () => {
    const scripts: readonly FakeScript[] = [
      {
        src: 'http://localhost:48044/a.js',
        async: true,
        defer: false,
        type: '',
      },
      {
        src: 'https://static.cloudflareinsights.com/beacon.min.js',
        async: false,
        defer: true,
        type: '',
      },
      {
        src: 'http://localhost:48044/entry.js',
        async: false,
        defer: false,
        type: 'module',
      },
      {
        src: 'https://blocking.example/sync.js',
        async: false,
        defer: false,
        type: 'text/javascript',
      },
    ];
    setGlobal('document', {
      querySelectorAll: (selector: string) =>
        selector === 'script[src]' ? scripts : [],
    });

    expect(await readParserBlockingScriptSources(fakePage)).toEqual([
      'https://blocking.example/sync.js',
    ]);
  });
});
