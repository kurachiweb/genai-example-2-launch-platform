import type { KeywordExtractor } from '../../../lib/core/search/ports.ts';
import { DisabledKeywordExtractor } from './disabled-keyword-extractor.ts';
import { GoogleNaturalLanguageExtractor } from './google-natural-language-extractor.ts';

export interface EventKeywordExtractorEnv {
  readonly KEYWORD_EXTRACTOR: 'google-natural-language' | 'disabled';
  readonly GOOGLE_NL_API_KEY?: string;
}

export function createKeywordExtractor(
  env: EventKeywordExtractorEnv,
  fetcher: typeof fetch,
): KeywordExtractor {
  switch (env.KEYWORD_EXTRACTOR) {
    case 'disabled':
      return new DisabledKeywordExtractor();
    case 'google-natural-language':
      if (env.GOOGLE_NL_API_KEY === undefined || env.GOOGLE_NL_API_KEY === '') {
        throw new Error(
          'キーワード抽出に必要な設定GOOGLE_NL_API_KEYがありません。',
        );
      }
      return new GoogleNaturalLanguageExtractor(env.GOOGLE_NL_API_KEY, fetcher);
  }
}
