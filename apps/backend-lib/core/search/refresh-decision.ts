import type { IndexDocument } from './index-document.ts';
import type {
  IndexWrite,
  KeywordExtractionOutcome,
  StoredIndexState,
} from './ports.ts';

export type RefreshPlan =
  | { readonly kind: 'skip-stale' }
  | { readonly kind: 'store-empty' }
  | {
      readonly kind: 'reuse-keywords';
      readonly status: 'extracted' | 'unsupported';
    }
  | { readonly kind: 'extract' };

export interface ExtractionDecision {
  readonly write: IndexWrite;
  readonly retry: boolean;
  readonly notify: boolean;
}

export interface ExtractionDecisionInput {
  readonly outcome: KeywordExtractionOutcome;
  readonly document: IndexDocument;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly now: Date;
}

// ハッシュはextractedとunsupportedの時だけ保存され、ドメインの更新待ちの印は状態だけをpendingにしてハッシュを残す。pendingの前の状態は残らないため、多数を占める抽出済みとして扱う
const reusableStatus = (
  current: StoredIndexState,
  document: IndexDocument,
): 'extracted' | 'unsupported' | undefined => {
  if (current.extractionInputHash !== document.extractionInputHash) {
    return undefined;
  }
  switch (current.keywordStatus) {
    case 'extracted':
    case 'pending': {
      return 'extracted';
    }
    case 'unsupported': {
      return 'unsupported';
    }
    case 'fallback':
    case 'disabled': {
      return undefined;
    }
  }
};

export function planRefresh(
  current: StoredIndexState | undefined,
  document: IndexDocument,
): RefreshPlan {
  if (current !== undefined && current.sourceVersion > document.sourceVersion) {
    return { kind: 'skip-stale' };
  }
  if (document.extractionInput === '') {
    return { kind: 'store-empty' };
  }
  const status =
    current === undefined ? undefined : reusableStatus(current, document);
  return status === undefined
    ? { kind: 'extract' }
    : { kind: 'reuse-keywords', status };
}

type DecidedColumns = Pick<
  IndexWrite,
  'keywords' | 'keywordStatus' | 'extractionInputHash'
> &
  Omit<ExtractionDecision, 'write'>;

// 縮退索引はキーワードの代わりに抽出の入力をキーワードの列へ入れる
const degradedKeywords = (document: IndexDocument): IndexWrite['keywords'] => ({
  kind: 'set',
  value: document.extractionInput,
});

const decideColumns = ({
  outcome,
  document,
  attempts,
  maxAttempts,
}: ExtractionDecisionInput): DecidedColumns => {
  switch (outcome.kind) {
    case 'extracted': {
      return {
        keywords: { kind: 'set', value: outcome.keywords },
        keywordStatus: 'extracted',
        extractionInputHash: document.extractionInputHash,
        retry: false,
        notify: false,
      };
    }
    case 'unsupported-language': {
      return {
        keywords: degradedKeywords(document),
        keywordStatus: 'unsupported',
        extractionInputHash: document.extractionInputHash,
        retry: false,
        notify: false,
      };
    }
    case 'disabled': {
      return {
        keywords: degradedKeywords(document),
        keywordStatus: 'disabled',
        extractionInputHash: null,
        retry: false,
        notify: false,
      };
    }
    case 'temporary-failure': {
      return attempts < maxAttempts
        ? {
            keywords: { kind: 'keep' },
            keywordStatus: 'pending',
            extractionInputHash: null,
            retry: true,
            notify: false,
          }
        : {
            keywords: degradedKeywords(document),
            keywordStatus: 'fallback',
            extractionInputHash: null,
            retry: false,
            notify: false,
          };
    }
    case 'configuration-error': {
      return {
        keywords: degradedKeywords(document),
        keywordStatus: 'fallback',
        extractionInputHash: null,
        retry: false,
        notify: true,
      };
    }
  }
};

export function decideAfterExtraction(
  input: ExtractionDecisionInput,
): ExtractionDecision {
  const { keywords, keywordStatus, extractionInputHash, retry, notify } =
    decideColumns(input);
  return {
    write: {
      sourceVersion: input.document.sourceVersion,
      texts: input.document.texts,
      keywords,
      keywordStatus,
      extractionInputHash,
      statusChangedAt: input.now,
    },
    retry,
    notify,
  };
}
