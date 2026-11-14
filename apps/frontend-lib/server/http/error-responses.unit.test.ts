import { describe, expect, test } from 'bun:test';

import { parseGraphQLResponse } from '../../utilities/graphql/graphql-result.ts';
import {
  ERROR_MESSAGES,
  errorEnvelopeResponse,
  type FrontendErrorCode,
  RATE_LIMIT_MESSAGE,
  renderStaticErrorPage,
  type StaticErrorPageInput,
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
} from './error-responses.ts';
import { IP_RATE_LIMIT } from './ip-rate-limit.ts';

interface CodeExpectation {
  readonly status: number;
  readonly message: string;
  readonly expected: boolean;
}

// 文言規則の表・設計の定数・backend-libの共通のエラー形式の定型と同じ文言
const EXPECTATIONS: Readonly<Record<FrontendErrorCode, CodeExpectation>> = {
  rate_limit_exceeded: {
    status: 429,
    message: '操作が集中しています。しばらく待ってから再度お試しください。',
    expected: true,
  },
  csrf_rejected: {
    status: 403,
    message:
      'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
    expected: true,
  },
  not_found: {
    status: 404,
    message: 'お探しの内容は見つかりませんでした。',
    expected: true,
  },
  method_not_allowed: {
    status: 405,
    message:
      'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
    expected: true,
  },
  unsupported_media_type: {
    status: 415,
    message:
      'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
    expected: true,
  },
  upstream_unavailable: {
    status: 503,
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    expected: false,
  },
  upstream_timeout: {
    status: 503,
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    expected: false,
  },
  internal_error: {
    status: 500,
    message: '問題が発生しました。時間をおいて再度お試しください。',
    expected: false,
  },
};

const ALL_CODES = Object.keys(EXPECTATIONS) as FrontendErrorCode[];

const envelopeFor = (code: FrontendErrorCode): Response => {
  switch (code) {
    case 'rate_limit_exceeded':
      return errorEnvelopeResponse({ status: 429, code });
    case 'csrf_rejected':
      return errorEnvelopeResponse({ status: 403, code });
    case 'not_found':
      return errorEnvelopeResponse({ status: 404, code });
    case 'method_not_allowed':
      return errorEnvelopeResponse({ status: 405, code, allow: ['POST'] });
    case 'unsupported_media_type':
      return errorEnvelopeResponse({ status: 415, code });
    case 'upstream_unavailable':
    case 'upstream_timeout':
      return errorEnvelopeResponse({ status: 503, code });
    case 'internal_error':
      return errorEnvelopeResponse({ status: 500, code });
  }
};

describe('文言の定数', () => {
  test('レート制限の文言は文言規則の表と同じ', () => {
    expect(RATE_LIMIT_MESSAGE).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
  });

  test('想定外のエラーの文言は設計の定数と同じ', () => {
    expect(UNEXPECTED_ERROR_MESSAGE).toBe(
      'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
    );
  });

  test('問い合わせの導線が無い側の想定外のエラーの文言は設計の定数と同じ', () => {
    expect(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT).toBe(
      'ページを表示できませんでした。時間をおいて再度お試しください。',
    );
  });

  test('コードごとの文言は、両方のアプリの画面にそのまま出るため問い合わせを促す文を含まない', () => {
    for (const message of Object.values(ERROR_MESSAGES)) {
      expect(message).not.toContain('解決しない場合はお問い合わせください。');
    }
  });

  test('コードごとの文言を固定し、凍結している', () => {
    expect(ERROR_MESSAGES).toStrictEqual(
      Object.fromEntries(
        ALL_CODES.map((code) => [code, EXPECTATIONS[code].message]),
      ) as Record<FrontendErrorCode, string>,
    );
    expect(Object.isFrozen(ERROR_MESSAGES)).toBe(true);
  });

  test('すべての文言が「です・ます」調で末尾に「。」を持つ', () => {
    for (const message of [
      ...Object.values(ERROR_MESSAGES),
      RATE_LIMIT_MESSAGE,
      UNEXPECTED_ERROR_MESSAGE,
      UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
    ]) {
      expect(message).toMatch(/(?:ください|ません|でした)。$/u);
    }
  });
});

describe('errorEnvelopeResponse', () => {
  test.each(ALL_CODES)(
    '%sはコードに対応する状態コードと共通のエラー形式の本文を返す',
    async (code) => {
      const response = envelopeFor(code);

      expect(response.status).toBe(EXPECTATIONS[code].status);
      expect(await response.json()).toStrictEqual({
        error: { code, message: EXPECTATIONS[code].message },
      });
    },
  );

  test.each(ALL_CODES)(
    '%sはJSONの形式とno-storeを示し、Retry-Afterを付けない',
    (code) => {
      const response = envelopeFor(code);

      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Retry-After')).toBe(false);
    },
  );

  test.each(ALL_CODES)(
    '%sの本文は中継の応答の解析で同じコード・文言・想定内かの分類になる',
    async (code) => {
      const response = envelopeFor(code);

      const result = parseGraphQLResponse({
        status: response.status,
        headers: response.headers,
        body: await response.text(),
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe(code);
      expect(result.error.message).toBe(EXPECTATIONS[code].message);
      expect(result.error.status).toBe(EXPECTATIONS[code].status);
      expect(result.error.expected).toBe(EXPECTATIONS[code].expected);
    },
  );

  test('IP制限の超過はRetry-Afterに制限の期間の秒数を付ける', () => {
    const response = errorEnvelopeResponse({
      status: 429,
      code: 'rate_limit_exceeded',
      retryAfterSeconds: IP_RATE_LIMIT.periodSeconds,
    });

    expect(response.headers.get('Retry-After')).toBe('10');
  });

  test.each(['upstream_unavailable', 'upstream_timeout'] as const)(
    '%sは指定された秒数のRetry-Afterを付け、解析で同じ秒数を読み取れる',
    async (code) => {
      const response = errorEnvelopeResponse({
        status: 503,
        code,
        retryAfterSeconds: 5,
      });

      expect(response.headers.get('Retry-After')).toBe('5');
      const result = parseGraphQLResponse({
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      });
      expect(result.ok ? undefined : result.error.retryAfterSeconds).toBe(5);
    },
  );

  test('Retry-Afterに0秒を指定できる', () => {
    const response = errorEnvelopeResponse({
      status: 503,
      code: 'upstream_unavailable',
      retryAfterSeconds: 0,
    });

    expect(response.headers.get('Retry-After')).toBe('0');
  });

  test('405はAllowに受け付けるメソッドを並べる', () => {
    const response = errorEnvelopeResponse({
      status: 405,
      code: 'method_not_allowed',
      allow: ['GET', 'POST'],
    });

    expect(response.headers.get('Allow')).toBe('GET, POST');
  });

  test('405以外はAllowを付けない', () => {
    const response = errorEnvelopeResponse({
      status: 415,
      code: 'unsupported_media_type',
    });

    expect(response.headers.has('Allow')).toBe(false);
  });

  test('本文に内部の詳細を含めない', async () => {
    const response = errorEnvelopeResponse({
      status: 503,
      code: 'upstream_timeout',
      retryAfterSeconds: 5,
    });

    const body = (await response.json()) as { error: object };
    expect(Object.keys(body)).toStrictEqual(['error']);
    expect(Object.keys(body.error)).toStrictEqual(['code', 'message']);
  });

  test('呼び出しごとに別の応答を返す', () => {
    const first = errorEnvelopeResponse({ status: 404, code: 'not_found' });
    const second = errorEnvelopeResponse({ status: 404, code: 'not_found' });

    expect(first).not.toBe(second);
    first.headers.set('X-Test', '1');
    expect(second.headers.has('X-Test')).toBe(false);
  });

  describe('不正な指定', () => {
    test('コードと状態コードが対応しなければRangeErrorを投げる', () => {
      expect(() =>
        errorEnvelopeResponse({
          status: 500,
          code: 'not_found',
        } as never),
      ).toThrow(RangeError);
    });

    test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'Retry-Afterの秒数が%pならRangeErrorを投げる',
      (retryAfterSeconds) => {
        expect(() =>
          errorEnvelopeResponse({
            status: 429,
            code: 'rate_limit_exceeded',
            retryAfterSeconds,
          }),
        ).toThrow(RangeError);
      },
    );

    test('429と503以外にRetry-Afterの秒数を指定するとRangeErrorを投げる', () => {
      expect(() =>
        errorEnvelopeResponse({
          status: 403,
          code: 'csrf_rejected',
          retryAfterSeconds: 10,
        } as never),
      ).toThrow(RangeError);
    });

    test('405でAllowが空ならRangeErrorを投げる', () => {
      expect(() =>
        errorEnvelopeResponse({
          status: 405,
          code: 'method_not_allowed',
          allow: [],
        }),
      ).toThrow(RangeError);
    });

    test.each(['POST, GET', 'GET\r\nX-Injected: 1', ''])(
      'Allowのメソッド名が%pならRangeErrorを投げる',
      (method) => {
        expect(() =>
          errorEnvelopeResponse({
            status: 405,
            code: 'method_not_allowed',
            allow: [method],
          }),
        ).toThrow(RangeError);
      },
    );

    test('405以外にAllowを指定するとRangeErrorを投げる', () => {
      expect(() =>
        errorEnvelopeResponse({
          status: 415,
          code: 'unsupported_media_type',
          allow: ['POST'],
        } as never),
      ).toThrow(RangeError);
    });
  });
});

describe('renderStaticErrorPage', () => {
  const PAGES = [
    {
      name: '429',
      input: { status: 429 },
      message: RATE_LIMIT_MESSAGE,
    },
    {
      name: '問い合わせの導線がある側の500',
      input: { status: 500, contactAvailable: true },
      message: UNEXPECTED_ERROR_MESSAGE,
    },
    {
      name: '問い合わせの導線が無い側の500',
      input: { status: 500, contactAvailable: false },
      message: UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
    },
  ] as const satisfies readonly {
    readonly name: string;
    readonly input: StaticErrorPageInput;
    readonly message: string;
  }[];

  test.each(PAGES)(
    '$nameは状態コードとHTMLの形式・no-storeを示す',
    ({ input }) => {
      const response = renderStaticErrorPage(input);

      expect(response.status).toBe(input.status);
      expect(response.headers.get('Content-Type')).toBe(
        'text/html; charset=utf-8',
      );
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  test.each(PAGES)(
    '$nameは日本語の文書として$messageを見出しに表示する',
    async ({ input, message }) => {
      const html = await renderStaticErrorPage(input).text();

      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="ja">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      );
      expect(html).toContain(`<title>${message}</title>`);
      expect(html).toContain(`<h1>${message}</h1>`);
    },
  );

  test.each(PAGES)(
    '$nameは他方の文言を含まない',
    async ({ input, message }) => {
      const html = await renderStaticErrorPage(input).text();

      for (const other of PAGES) {
        if (other.message !== message) {
          expect(html).not.toContain(`<h1>${other.message}</h1>`);
        }
      }
    },
  );

  test.each(PAGES)(
    '$nameはスクリプトと外部のファイルの参照を含まない',
    async ({ input }) => {
      const html = await renderStaticErrorPage(input).text();

      expect(html).not.toMatch(/<script/iu);
      expect(html).not.toMatch(/<link/iu);
      expect(html).not.toMatch(/<(?:img|iframe|object|embed|source)\b/iu);
      expect(html).not.toMatch(/\b(?:src|href|action|srcset)\s*=/iu);
      expect(html).not.toMatch(/url\(/iu);
      expect(html).not.toMatch(/@import/iu);
      expect(html).not.toMatch(/https?:/iu);
      expect(html).not.toMatch(/\bon[a-z]+\s*=/iu);
    },
  );

  test.each(PAGES)(
    '$nameはスタイルを要素のstyle属性ではなく1つのstyle要素だけで持つ',
    async ({ input }) => {
      const html = await renderStaticErrorPage(input).text();

      expect(html.match(/<style>/gu)).toHaveLength(1);
      expect(html).not.toMatch(/\sstyle\s*=/iu);
    },
  );

  test.each(PAGES)(
    '$nameはスクリプト無しでOSのダークモードの設定に従う',
    async ({ input }) => {
      const html = await renderStaticErrorPage(input).text();

      expect(html).toContain('<meta name="color-scheme" content="light dark">');
      expect(html).toContain('@media (prefers-color-scheme: dark)');
    },
  );

  test('429はRetry-Afterに指定された秒数を付ける', () => {
    const response = renderStaticErrorPage({
      status: 429,
      retryAfterSeconds: IP_RATE_LIMIT.periodSeconds,
    });

    expect(response.headers.get('Retry-After')).toBe('10');
  });

  test.each(PAGES)(
    '$nameは秒数の指定が無ければRetry-Afterを付けない',
    ({ input }) => {
      expect(renderStaticErrorPage(input).headers.has('Retry-After')).toBe(
        false,
      );
    },
  );

  test('問い合わせの導線が無い側の500は、問い合わせを促す文を含まない', async () => {
    const html = await renderStaticErrorPage({
      status: 500,
      contactAvailable: false,
    }).text();

    expect(html).not.toContain('解決しない場合はお問い合わせください。');
    expect(html).not.toContain('問い合わせ');
  });

  test('500にRetry-Afterの秒数を指定するとRangeErrorを投げる', () => {
    expect(() =>
      renderStaticErrorPage({
        status: 500,
        contactAvailable: true,
        retryAfterSeconds: 10,
      } as never),
    ).toThrow(RangeError);
  });

  test('Retry-Afterの秒数が負ならRangeErrorを投げる', () => {
    expect(() =>
      renderStaticErrorPage({ status: 429, retryAfterSeconds: -1 }),
    ).toThrow(RangeError);
  });

  test('呼び出しごとに別の応答を返す', async () => {
    const first = renderStaticErrorPage({
      status: 500,
      contactAvailable: true,
    });
    const second = renderStaticErrorPage({
      status: 500,
      contactAvailable: true,
    });

    expect(first).not.toBe(second);
    expect(await first.text()).toBe(await second.text());
  });
});
