import { afterEach, describe, expect, test, vi } from 'vitest';

import { ANALYZE_ENTITIES_ENDPOINT } from '../../../lib/core/search/natural-language-protocol.ts';
import type { KeywordExtractionOutcome } from '../../../lib/core/search/ports.ts';
import { GoogleNaturalLanguageExtractor } from './google-natural-language-extractor.ts';

const API_KEY = 'test-google-nl-api-key-must-not-leak';

const TEXT = 'Cloudflareで東京のローンチを競う';

type FetcherImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function createFetcher(respond: FetcherImplementation) {
  const spy = vi.fn<FetcherImplementation>(respond);
  return { fetcher: spy as typeof spy & typeof fetch, spy };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respondWith(response: () => Response) {
  return createFetcher(() => Promise.resolve(response()));
}

function googleError(status: string, message: string, code: number) {
  return { error: { code, status, message } };
}

// 打ち切りの信号を受けるまで応答せず、信号の理由で失敗する通信を再現する
function waitForAbort(_input: RequestInfo | URL, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

async function extractWith(
  fetcher: typeof fetch,
  timeoutMs?: number,
): Promise<KeywordExtractionOutcome> {
  return new GoogleNaturalLanguageExtractor(
    API_KEY,
    fetcher,
    timeoutMs,
  ).extract(TEXT);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Google Cloud Natural Languageのキーワード抽出の要求', () => {
  test('エンティティ分析のエンドポイントへ、キーをヘッダーに入れて本文だけを送る', async () => {
    const { fetcher, spy } = respondWith(() =>
      jsonResponse({ languageCode: 'ja', languageSupported: true }, 200),
    );

    await extractWith(fetcher);

    expect(spy).toHaveBeenCalledTimes(1);
    const [input, init] = spy.mock.calls[0] ?? [];
    const request = new Request(input ?? '', init);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(ANALYZE_ENTITIES_ENDPOINT);
    expect(request.url).not.toContain(API_KEY);
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('x-goog-api-key')).toBe(API_KEY);
    expect(await request.json()).toStrictEqual({
      document: { type: 'PLAIN_TEXT', content: TEXT },
      encodingType: 'UTF8',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('受け取ったfetchを別のオブジェクトのメソッドとして呼ばない', async () => {
    const { fetcher, spy } = respondWith(() =>
      jsonResponse({ languageSupported: true }, 200),
    );

    await extractWith(fetcher);

    expect(spy.mock.contexts).toEqual([undefined]);
  });

  test('打ち切りの時間の既定は10秒である', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetcher } = respondWith(() =>
      jsonResponse({ languageSupported: true }, 200),
    );

    await extractWith(fetcher);

    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});

describe('Google Cloud Natural Languageの応答の分類', () => {
  test('200の対応言語の応答はエンティティを選別したキーワードにする', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse(
        {
          entities: [
            { name: 'Cloudflare', type: 'ORGANIZATION' },
            { name: '東京', type: 'LOCATION' },
            { name: '2026', type: 'NUMBER' },
          ],
          languageCode: 'ja',
          languageSupported: true,
        },
        200,
      ),
    );

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'extracted',
      keywords: 'Cloudflare 東京',
    });
  });

  test('200でlanguageSupportedが無い応答は非対応言語にする', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse({ entities: [], languageCode: 'sq' }, 200),
    );

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'unsupported-language',
      languageCode: 'sq',
    });
  });

  test('200で本文がJSONでない応答は状態コード200の設定の誤りにする', async () => {
    const { fetcher } = respondWith(
      () => new Response('<html>not json</html>', { status: 200 }),
    );

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'configuration-error',
      status: 200,
    });
  });

  test.each<[string, number, unknown, KeywordExtractionOutcome]>([
    [
      '言語を理由とする400',
      400,
      googleError(
        'INVALID_ARGUMENT',
        'The language sq is not supported for entity analysis.',
        400,
      ),
      { kind: 'unsupported-language', languageCode: undefined },
    ],
    [
      'その他の400',
      400,
      googleError('INVALID_ARGUMENT', 'Invalid document content.', 400),
      { kind: 'configuration-error', status: 400 },
    ],
    [
      '401',
      401,
      googleError('UNAUTHENTICATED', 'API key not valid.', 401),
      { kind: 'configuration-error', status: 401 },
    ],
    [
      '403',
      403,
      googleError('PERMISSION_DENIED', 'API has not been used.', 403),
      { kind: 'configuration-error', status: 403 },
    ],
    [
      '429',
      429,
      googleError('RESOURCE_EXHAUSTED', 'Quota exceeded.', 429),
      { kind: 'temporary-failure', reason: 'rate-limited' },
    ],
    [
      '500',
      500,
      googleError('INTERNAL', 'Internal error.', 500),
      { kind: 'temporary-failure', reason: 'server-error' },
    ],
    [
      '503',
      503,
      googleError('UNAVAILABLE', 'The service is unavailable.', 503),
      { kind: 'temporary-failure', reason: 'server-error' },
    ],
  ])('%sの応答を分類する', async (_label, status, body, expected) => {
    const { fetcher } = respondWith(() => jsonResponse(body, status));

    expect(await extractWith(fetcher)).toStrictEqual(expected);
  });

  test('本文がJSONでない500はサーバー側の一時的な失敗にする', async () => {
    const { fetcher } = respondWith(
      () => new Response('Bad Gateway', { status: 502 }),
    );

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'temporary-failure',
      reason: 'server-error',
    });
  });
});

describe('Google Cloud Natural Languageの通信の失敗', () => {
  test('打ち切りの時間を過ぎた要求は時間切れの一時的な失敗にする', async () => {
    const { fetcher } = createFetcher(waitForAbort);

    expect(await extractWith(fetcher, 5)).toStrictEqual({
      kind: 'temporary-failure',
      reason: 'timeout',
    });
  });

  test('通信の例外は通信の一時的な失敗にする', async () => {
    const { fetcher } = createFetcher(() =>
      Promise.reject(new TypeError('Network connection lost.')),
    );

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'temporary-failure',
      reason: 'network',
    });
  });

  test('応答の本文を読む途中の失敗は通信の一時的な失敗にする', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('stream reset'));
      },
    });
    const { fetcher } = respondWith(() => new Response(body, { status: 200 }));

    expect(await extractWith(fetcher)).toStrictEqual({
      kind: 'temporary-failure',
      reason: 'network',
    });
  });
});

describe('Google Cloud Natural LanguageのキーとAPIの秘匿', () => {
  test('キーを含む通信の例外も、例外にせずキーを含まない結果にし、ログへ出さない', async () => {
    const consoleCalls = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ];
    const { fetcher } = createFetcher(() =>
      Promise.reject(new Error(`request failed with key ${API_KEY}`)),
    );

    const outcome = await extractWith(fetcher);

    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    for (const spy of consoleCalls) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test('キーを含む誤りの応答も、キーを含まない結果にする', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse(
        googleError('UNAUTHENTICATED', `API key ${API_KEY} not valid.`, 401),
        401,
      ),
    );

    const outcome = await extractWith(fetcher);

    expect(outcome).toStrictEqual({ kind: 'configuration-error', status: 401 });
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
  });
});
