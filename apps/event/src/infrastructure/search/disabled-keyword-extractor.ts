import type {
  KeywordExtractionOutcome,
  KeywordExtractor,
} from '../../../lib/core/search/ports.ts';

export class DisabledKeywordExtractor implements KeywordExtractor {
  extract(): Promise<KeywordExtractionOutcome> {
    return Promise.resolve({ kind: 'disabled' });
  }
}
