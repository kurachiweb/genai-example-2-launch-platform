import { describe, expect, mock, test } from 'bun:test';

import { ANALYZE_ENTITIES_ENDPOINT } from '../lib/core/search/natural-language-protocol.ts';
import {
  EXIT_KEY_MISSING,
  runKeywordExtractionSmoke,
  SMOKE_SAMPLES,
} from './smoke-keyword-extraction.ts';

const API_KEY = 'smoke-google-nl-api-key-must-not-leak';

type FetcherImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function createFetcher(respond: FetcherImplementation) {
  const spy = mock<FetcherImplementation>(respond);
  return { fetcher: spy as typeof spy & typeof fetch, spy };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function entitiesResponse(names: readonly string[]): Response {
  return jsonResponse({
    entities: names.map((name) => ({ name, type: 'OTHER' })),
    languageCode: 'ja',
    languageSupported: true,
  });
}

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    output: {
      stdout: { write: (text: string) => stdout.push(text) },
      stderr: { write: (text: string) => stderr.push(text) },
    },
    stdoutText: () => stdout.join(''),
    stderrText: () => stderr.join(''),
  };
}

async function runWith(
  env: Readonly<Record<string, string | undefined>>,
  respond: FetcherImplementation,
) {
  const { fetcher, spy } = createFetcher(respond);
  const captured = captureOutput();
  const exitCode = await runKeywordExtractionSmoke({
    env,
    fetcher,
    ...captured.output,
  });
  return { exitCode, spy, ...captured };
}

const INJECTED = { GOOGLE_NL_API_KEY: API_KEY };

function requestOf(
  spy: ReturnType<typeof createFetcher>['spy'],
  index: number,
) {
  const [input, init] = spy.mock.calls[index] ?? [];
  return new Request(input ?? '', init);
}

describe('runKeywordExtractionSmoke', () => {
  test.each([
    ['注入されていない', {}],
    ['空の値で注入された', { GOOGLE_NL_API_KEY: '' }],
  ])(
    'キーが%sとき、外部APIを呼ばずに登録と注入の手順を案内して終了コード2を返す',
    async (_label, env) => {
      const { exitCode, spy, stderrText, stdoutText } = await runWith(env, () =>
        Promise.resolve(entitiesResponse([])),
      );

      expect(exitCode).toBe(EXIT_KEY_MISSING);
      expect(EXIT_KEY_MISSING).toBe(2);
      expect(spy).not.toHaveBeenCalled();
      expect(stdoutText()).toBe('');
      const guidance = stderrText();
      expect(guidance).toContain('GOOGLE_NL_API_KEY');
      expect(guidance).toContain('Infisical');
      expect(guidance).toContain('`staging`');
      expect(guidance).toContain('フォルダ`/`');
      expect(guidance).toContain(
        'infisical --telemetry=false run --env staging -- bun run smoke:keyword-extraction',
      );
    },
  );

  test('キーが注入されたとき、日本語と英語の固定の短文をキーのヘッダー付きで外部APIへ送る', async () => {
    const { spy } = await runWith(INJECTED, () =>
      Promise.resolve(entitiesResponse(['東京'])),
    );

    expect(SMOKE_SAMPLES.map((sample) => sample.languageCode)).toEqual([
      'ja',
      'en',
    ]);
    expect(spy).toHaveBeenCalledTimes(SMOKE_SAMPLES.length);
    const requests = SMOKE_SAMPLES.map((_sample, index) =>
      requestOf(spy, index),
    );
    for (const [index, request] of requests.entries()) {
      expect(request.url).toBe(ANALYZE_ENTITIES_ENDPOINT);
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-goog-api-key')).toBe(API_KEY);
      expect(await request.json()).toEqual({
        document: { type: 'PLAIN_TEXT', content: SMOKE_SAMPLES[index]?.text },
        encodingType: 'UTF8',
      });
    }
  });

  test('全ての短文で抽出できたとき、抽出の結果・言語・キーワードの数を表示して終了コード0を返す', async () => {
    const responses = [
      entitiesResponse(['東京', 'スカイツリー', '墨田区']),
      entitiesResponse(['Cloudflare', 'JavaScript']),
    ];
    const { exitCode, stdoutText, stderrText } = await runWith(INJECTED, () =>
      Promise.resolve(responses.shift() ?? entitiesResponse([])),
    );

    expect(exitCode).toBe(0);
    expect(stderrText()).toBe('');
    const report = stdoutText();
    expect(report).toContain('日本語(ja): 結果 extracted、キーワード3件');
    expect(report).toContain('英語(en): 結果 extracted、キーワード2件');
    expect(report).toContain('全ての短文でキーワードを抽出できました');
  });

  test('抽出した語が無いとき、キーワードの数を0件と表示する', async () => {
    const { exitCode, stdoutText } = await runWith(INJECTED, () =>
      Promise.resolve(entitiesResponse([])),
    );

    expect(exitCode).toBe(0);
    expect(stdoutText()).toContain('日本語(ja): 結果 extracted、キーワード0件');
  });

  test('応答に`languageSupported: true`が無く非対応言語に分類されたとき、判定された言語と応答の形の確認を案内して終了コード1を返す', async () => {
    const { exitCode, stdoutText, stderrText } = await runWith(INJECTED, () =>
      Promise.resolve(jsonResponse({ entities: [], languageCode: 'ja' })),
    );

    expect(exitCode).toBe(1);
    expect(stdoutText()).toContain(
      '日本語(ja): 結果 unsupported-language、判定された言語 ja',
    );
    expect(stderrText()).toContain('languageSupported: true');
  });

  test('言語の400で判定された言語が分からないとき、判定された言語を不明と表示する', async () => {
    const { exitCode, stdoutText } = await runWith(INJECTED, () =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: 'The language sq is not supported for entity analysis.',
            },
          },
          400,
        ),
      ),
    );

    expect(exitCode).toBe(1);
    expect(stdoutText()).toContain(
      '英語(en): 結果 unsupported-language、判定された言語 不明',
    );
  });

  test('キーの誤りなどの設定の誤りのとき、状態コードを表示して終了コード1を返す', async () => {
    const { exitCode, stdoutText, stderrText } = await runWith(INJECTED, () =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: 'API key not valid.',
            },
          },
          403,
        ),
      ),
    );

    expect(exitCode).toBe(1);
    expect(stdoutText()).toContain(
      '日本語(ja): 結果 configuration-error、状態コード403',
    );
    expect(stderrText()).toContain('抽出できなかった短文があります');
    expect(stderrText()).not.toContain('languageSupported');
  });

  test('一時的な失敗のとき、失敗の種類を表示して終了コード1を返す', async () => {
    const { exitCode, stdoutText } = await runWith(INJECTED, () =>
      Promise.reject(new TypeError('fetch failed')),
    );

    expect(exitCode).toBe(1);
    expect(stdoutText()).toContain(
      '日本語(ja): 結果 temporary-failure、種類 network',
    );
  });

  test('どの結果でもキーの値を表示しない', async () => {
    const cases: FetcherImplementation[] = [
      () => Promise.resolve(entitiesResponse(['東京'])),
      () => Promise.resolve(jsonResponse({ error: { code: 401 } }, 401)),
      () => Promise.reject(new TypeError(`fetch failed ${API_KEY}`)),
    ];
    for (const respond of cases) {
      const { stdoutText, stderrText } = await runWith(INJECTED, respond);
      expect(stdoutText()).not.toContain(API_KEY);
      expect(stderrText()).not.toContain(API_KEY);
    }
  });
});
