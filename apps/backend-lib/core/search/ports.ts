import type { KeywordStatus } from './keyword-status.ts';
import type { SearchSource, SearchTargetInfo } from './search-target.ts';

export interface StoredIndexState {
  readonly sourceVersion: number;
  readonly keywordStatus: KeywordStatus;
  readonly extractionInputHash: string | undefined;
}

export interface IndexWrite {
  readonly sourceVersion: number;
  readonly texts: Readonly<Record<string, string>>;
  readonly keywords:
    | { readonly kind: 'set'; readonly value: string }
    | { readonly kind: 'keep' };
  readonly keywordStatus: KeywordStatus;
  readonly extractionInputHash: string | null;
  readonly statusChangedAt: Date;
}

export interface SearchIndexStore {
  findState(
    target: string,
    sourceId: string,
  ): Promise<StoredIndexState | undefined>;
  // 保存済みの版より古い書き込みや、元データが無い・対象外の書き込みはskippedになる
  upsert(
    target: string,
    sourceId: string,
    write: IndexWrite,
  ): Promise<'written' | 'skipped'>;
  delete(target: string, sourceId: string): Promise<void>;
  findSourceIdsForReextraction(
    target: string,
    pendingBefore: Date,
    limit: number,
  ): Promise<readonly string[]>;
}

export interface SearchSourceProvider {
  read(target: string, sourceId: string): Promise<SearchSource | undefined>;
}

export interface SearchTargetCatalog {
  find(name: string): SearchTargetInfo | undefined;
  names(): readonly string[];
}

export interface SearchIndexRefreshRequester {
  // 未登録の検索対象と契約に合わない本文は要求し直しても失敗する呼び出し側の誤りのため例外にする。それ以外の送信の失敗は、ドメインの書き込みを索引の更新の失敗で止めないため記録して例外にしない
  requestRefresh(target: string, sourceId: string): Promise<void>;
}

export type KeywordExtractionOutcome =
  | { readonly kind: 'extracted'; readonly keywords: string }
  | {
      readonly kind: 'unsupported-language';
      readonly languageCode: string | undefined;
    }
  | {
      readonly kind: 'temporary-failure';
      readonly reason: 'network' | 'timeout' | 'rate-limited' | 'server-error';
    }
  | { readonly kind: 'configuration-error'; readonly status: number }
  | { readonly kind: 'disabled' };

export interface KeywordExtractor {
  extract(text: string): Promise<KeywordExtractionOutcome>;
}
