import { describe, expect, test } from 'vitest';

import type { KeywordExtractor } from '../../../lib/core/search/ports.ts';
import { DisabledKeywordExtractor } from './disabled-keyword-extractor.ts';

describe('抽出を無効にしたキーワード抽出', () => {
  test.each(['Cloudflareで東京のローンチを競う', ''])(
    '入力によらず無効の結果を返す(%j)',
    async (text) => {
      const extractor: KeywordExtractor = new DisabledKeywordExtractor();

      expect(await extractor.extract(text)).toStrictEqual({ kind: 'disabled' });
    },
  );
});
