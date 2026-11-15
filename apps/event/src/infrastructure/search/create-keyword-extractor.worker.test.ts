import { env } from 'cloudflare:workers';
import { describe, expect, test, vi } from 'vitest';

import {
  createKeywordExtractor,
  type EventKeywordExtractorEnv,
} from './create-keyword-extractor.ts';
import { DisabledKeywordExtractor } from './disabled-keyword-extractor.ts';
import { GoogleNaturalLanguageExtractor } from './google-natural-language-extractor.ts';

const API_KEY = 'factory-google-nl-api-key-must-not-leak';

function createFetcher() {
  const spy = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() =>
    Promise.resolve(
      Response.json({
        entities: [{ name: 'Cloudflare', type: 'ORGANIZATION' }],
        languageCode: 'en',
        languageSupported: true,
      }),
    ),
  );
  return spy as typeof spy & typeof fetch;
}

function apiKeyHeaderOf(fetcher: ReturnType<typeof createFetcher>) {
  const [input, init] = fetcher.mock.calls[0] ?? [];
  return new Request(input ?? '', init).headers.get('x-goog-api-key');
}

describe('環境の値によるキーワード抽出の実装の選択', () => {
  test('Workers統合テストの環境ではGoogle Cloud Natural Languageをテスト用のキーで呼ぶ', async () => {
    const fetcher = createFetcher();

    const extractor = createKeywordExtractor(env, fetcher);
    const outcome = await extractor.extract('Cloudflare launch');

    expect(extractor).toBeInstanceOf(GoogleNaturalLanguageExtractor);
    expect(outcome).toStrictEqual({
      kind: 'extracted',
      keywords: 'Cloudflare',
    });
    expect(apiKeyHeaderOf(fetcher)).toBe(env.GOOGLE_NL_API_KEY);
  });

  test('google-natural-languageなら環境のキーを使う', async () => {
    const fetcher = createFetcher();

    await createKeywordExtractor(
      {
        KEYWORD_EXTRACTOR: 'google-natural-language',
        GOOGLE_NL_API_KEY: API_KEY,
      },
      fetcher,
    ).extract('Cloudflare launch');

    expect(apiKeyHeaderOf(fetcher)).toBe(API_KEY);
  });

  test('disabledなら外部APIを呼ばず、キーがあっても無効の結果を返す', async () => {
    const fetcher = createFetcher();

    const extractor = createKeywordExtractor(
      { KEYWORD_EXTRACTOR: 'disabled', GOOGLE_NL_API_KEY: API_KEY },
      fetcher,
    );
    const outcome = await extractor.extract('Cloudflare launch');

    expect(extractor).toBeInstanceOf(DisabledKeywordExtractor);
    expect(outcome).toStrictEqual({ kind: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('disabledならキーが無くても作れる', () => {
    expect(() =>
      createKeywordExtractor(
        { KEYWORD_EXTRACTOR: 'disabled' },
        createFetcher(),
      ),
    ).not.toThrow();
  });

  test.each<[string, EventKeywordExtractorEnv]>([
    ['無い', { KEYWORD_EXTRACTOR: 'google-natural-language' }],
    [
      '空である',
      { KEYWORD_EXTRACTOR: 'google-natural-language', GOOGLE_NL_API_KEY: '' },
    ],
  ])(
    'google-natural-languageでキーが%s設定は、欠けたキー名を示して作成を拒む',
    (_label, extractorEnv) => {
      expect(() =>
        createKeywordExtractor(extractorEnv, createFetcher()),
      ).toThrow('GOOGLE_NL_API_KEY');
    },
  );
});
