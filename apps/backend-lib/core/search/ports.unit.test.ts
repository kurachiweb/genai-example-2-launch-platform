import { describe, expect, test } from 'bun:test';

import type {
  IndexWrite,
  KeywordExtractionOutcome,
  SearchIndexRefreshRequester,
  SearchTargetCatalog,
  StoredIndexState,
} from './ports.ts';
import type { SearchTargetInfo } from './search-target.ts';

describe('KeywordExtractionOutcome', () => {
  test('抽出済み・非対応言語・一時的な失敗・設定の誤り・無効の5種の結果を持つ', () => {
    const kinds = {
      extracted: true,
      'unsupported-language': true,
      'temporary-failure': true,
      'configuration-error': true,
      disabled: true,
    } as const satisfies Record<KeywordExtractionOutcome['kind'], true>;

    expect(Object.keys(kinds)).toHaveLength(5);
  });

  test('一時的な失敗は通信・時間切れ・上限超過・サーバー側の失敗の理由だけを持つ', () => {
    const reasons = {
      network: true,
      timeout: true,
      'rate-limited': true,
      'server-error': true,
    } as const satisfies Record<
      Extract<
        KeywordExtractionOutcome,
        { kind: 'temporary-failure' }
      >['reason'],
      true
    >;

    expect(Object.keys(reasons)).toHaveLength(4);
  });

  test('抽出済みでない結果はキーワードを持てない', () => {
    const outcome: KeywordExtractionOutcome = {
      kind: 'disabled',
      // @ts-expect-error 無効の結果にキーワードは無い
      keywords: 'a',
    };

    expect(outcome.kind).toBe('disabled');
  });
});

describe('IndexWrite', () => {
  test('キーワードの列は新しい値の設定か前回の値の維持のどちらかで指定する', () => {
    const write: IndexWrite = {
      sourceVersion: 2,
      texts: { title: 'launch' },
      keywords: { kind: 'keep' },
      keywordStatus: 'fallback',
      extractionInputHash: null,
      statusChangedAt: new Date('2026-10-31T00:00:00.000Z'),
    };

    expect(write.keywords).toEqual({ kind: 'keep' });
  });

  test('維持の指定には値を持てない', () => {
    const write: IndexWrite = {
      sourceVersion: 2,
      texts: {},
      // @ts-expect-error 前回の値を保つ指定に新しい値は無い
      keywords: { kind: 'keep', value: 'a' },
      keywordStatus: 'pending',
      extractionInputHash: null,
      statusChangedAt: new Date('2026-10-31T00:00:00.000Z'),
    };

    expect(write.keywordStatus).toBe('pending');
  });
});

describe('StoredIndexState', () => {
  test('抽出の入力のハッシュが無い状態を未定義で表す', () => {
    const state: StoredIndexState = {
      sourceVersion: 1,
      keywordStatus: 'pending',
      extractionInputHash: undefined,
    };

    expect(state.extractionInputHash).toBeUndefined();
  });
});

describe('SearchTargetCatalog', () => {
  test('名前で検索対象を引き、登録した名前の一覧を返す', () => {
    const product: SearchTargetInfo = {
      name: 'product',
      fields: { title: { format: 'plain', textColumn: true, extract: true } },
    };
    const catalog: SearchTargetCatalog = {
      find: (name) => (name === product.name ? product : undefined),
      names: () => [product.name],
    };

    expect(catalog.find('product')).toBe(product);
    expect(catalog.find('unknown')).toBeUndefined();
    expect(catalog.names()).toEqual(['product']);
  });
});

describe('SearchIndexRefreshRequester', () => {
  test('検索対象の名前と元データの識別子で更新を要求する', async () => {
    const requested: (readonly [string, string])[] = [];
    const requester: SearchIndexRefreshRequester = {
      requestRefresh: (target, sourceId) => {
        requested.push([target, sourceId]);
        return Promise.resolve();
      },
    };

    await requester.requestRefresh('product', 'source-1');

    expect(requested).toEqual([['product', 'source-1']]);
  });
});
