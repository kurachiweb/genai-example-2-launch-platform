import { describe, expect, test } from 'bun:test';

import type { IndexDocument } from './index-document.ts';
import type { KeywordStatus } from './keyword-status.ts';
import type {
  IndexWrite,
  KeywordExtractionOutcome,
  StoredIndexState,
} from './ports.ts';
import { decideAfterExtraction, planRefresh } from './refresh-decision.ts';

const DOCUMENT_HASH = 'a'.repeat(64);
const PREVIOUS_HASH = 'b'.repeat(64);
const MAX_ATTEMPTS = 5;
const NOW = new Date('2026-10-31T03:00:00.000Z');

const DOCUMENT: IndexDocument = {
  sourceVersion: 1_793_000_000_000,
  texts: { name: 'launch stadium', tagline: '最新の要約' },
  extractionInput: 'launch stadium\n\n最新の要約',
  extractionInputHash: DOCUMENT_HASH,
};

const storedState = (
  overrides: Partial<StoredIndexState> = {},
): StoredIndexState => ({
  sourceVersion: DOCUMENT.sourceVersion - 1,
  keywordStatus: 'pending',
  extractionInputHash: DOCUMENT_HASH,
  ...overrides,
});

describe('planRefresh', () => {
  test('索引文書が無ければ抽出する', () => {
    expect(planRefresh(undefined, DOCUMENT)).toEqual({ kind: 'extract' });
  });

  test('保存済みの版が新しければ書かない', () => {
    const current = storedState({
      sourceVersion: DOCUMENT.sourceVersion + 1,
      keywordStatus: 'extracted',
    });

    expect(planRefresh(current, DOCUMENT)).toEqual({ kind: 'skip-stale' });
  });

  test('保存済みの版が新しければ、抽出の入力が空でも書かない', () => {
    const current = storedState({ sourceVersion: DOCUMENT.sourceVersion + 1 });

    expect(planRefresh(current, { ...DOCUMENT, extractionInput: '' })).toEqual({
      kind: 'skip-stale',
    });
  });

  test('保存済みの版と同じ版は古い版として扱わない', () => {
    const current = storedState({
      sourceVersion: DOCUMENT.sourceVersion,
      keywordStatus: 'extracted',
    });

    expect(planRefresh(current, DOCUMENT)).toEqual({
      kind: 'reuse-keywords',
      status: 'extracted',
    });
  });

  test('抽出の入力が空なら、索引文書が無くても抽出せずに空で書く', () => {
    expect(
      planRefresh(undefined, { ...DOCUMENT, extractionInput: '' }),
    ).toEqual({ kind: 'store-empty' });
  });

  test('抽出の入力が空なら、前回のハッシュと同じでも空で書く', () => {
    const current = storedState({ keywordStatus: 'extracted' });

    expect(planRefresh(current, { ...DOCUMENT, extractionInput: '' })).toEqual({
      kind: 'store-empty',
    });
  });

  test('抽出済みでハッシュが同じなら、抽出済みのまま前回のキーワードを使う', () => {
    const current = storedState({ keywordStatus: 'extracted' });

    expect(planRefresh(current, DOCUMENT)).toEqual({
      kind: 'reuse-keywords',
      status: 'extracted',
    });
  });

  test('非対応言語でハッシュが同じなら、非対応言語のまま前回のキーワードを使う', () => {
    const current = storedState({ keywordStatus: 'unsupported' });

    expect(planRefresh(current, DOCUMENT)).toEqual({
      kind: 'reuse-keywords',
      status: 'unsupported',
    });
  });

  test('更新待ちの印でハッシュが残っていれば、抽出済みとして前回のキーワードを使う', () => {
    const current = storedState({ keywordStatus: 'pending' });

    expect(planRefresh(current, DOCUMENT)).toEqual({
      kind: 'reuse-keywords',
      status: 'extracted',
    });
  });

  test.each<KeywordStatus>(['fallback', 'disabled'])(
    '状態が%sなら、ハッシュが同じでも抽出する',
    (keywordStatus) => {
      const current = storedState({ keywordStatus });

      expect(planRefresh(current, DOCUMENT)).toEqual({ kind: 'extract' });
    },
  );

  test.each<KeywordStatus>(['pending', 'extracted', 'unsupported'])(
    '状態が%sでハッシュが異なれば抽出する',
    (keywordStatus) => {
      const current = storedState({
        keywordStatus,
        extractionInputHash: PREVIOUS_HASH,
      });

      expect(planRefresh(current, DOCUMENT)).toEqual({ kind: 'extract' });
    },
  );

  test('前回のハッシュが無ければ抽出する', () => {
    const current = storedState({ extractionInputHash: undefined });

    expect(planRefresh(current, DOCUMENT)).toEqual({ kind: 'extract' });
  });
});

const decide = (outcome: KeywordExtractionOutcome, attempts = 1) =>
  decideAfterExtraction({
    outcome,
    document: DOCUMENT,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
    now: NOW,
  });

const expectedWrite = (
  write: Pick<IndexWrite, 'keywords' | 'keywordStatus' | 'extractionInputHash'>,
): IndexWrite => ({
  sourceVersion: DOCUMENT.sourceVersion,
  texts: DOCUMENT.texts,
  statusChangedAt: NOW,
  ...write,
});

describe('decideAfterExtraction', () => {
  test('抽出済みなら、抽出したキーワードとハッシュを保存し、再試行も通知もしない', () => {
    const decision = decide({
      kind: 'extracted',
      keywords: 'Launch Stadium ガイド',
    });

    expect(decision).toEqual({
      write: expectedWrite({
        keywords: { kind: 'set', value: 'Launch Stadium ガイド' },
        keywordStatus: 'extracted',
        extractionInputHash: DOCUMENT_HASH,
      }),
      retry: false,
      notify: false,
    });
  });

  test('非対応言語なら、抽出の入力で縮退索引とし、ハッシュを保存して再抽出の対象にしない', () => {
    const decision = decide({
      kind: 'unsupported-language',
      languageCode: 'sq',
    });

    expect(decision).toEqual({
      write: expectedWrite({
        keywords: { kind: 'set', value: DOCUMENT.extractionInput },
        keywordStatus: 'unsupported',
        extractionInputHash: DOCUMENT_HASH,
      }),
      retry: false,
      notify: false,
    });
  });

  test('抽出を無効にした環境なら、抽出の入力で索引し、ハッシュを保存しない', () => {
    expect(decide({ kind: 'disabled' })).toEqual({
      write: expectedWrite({
        keywords: { kind: 'set', value: DOCUMENT.extractionInput },
        keywordStatus: 'disabled',
        extractionInputHash: null,
      }),
      retry: false,
      notify: false,
    });
  });

  test.each([1, MAX_ATTEMPTS - 1])(
    '一時的な失敗で試行%i回目なら、前回のキーワードを保って更新待ちにし、再試行する',
    (attempts) => {
      const decision = decide(
        { kind: 'temporary-failure', reason: 'rate-limited' },
        attempts,
      );

      expect(decision).toEqual({
        write: expectedWrite({
          keywords: { kind: 'keep' },
          keywordStatus: 'pending',
          extractionInputHash: null,
        }),
        retry: true,
        notify: false,
      });
    },
  );

  test.each([MAX_ATTEMPTS, MAX_ATTEMPTS + 1])(
    '一時的な失敗で試行%i回目なら、抽出の入力で縮退索引とし、再試行しない',
    (attempts) => {
      const decision = decide(
        { kind: 'temporary-failure', reason: 'server-error' },
        attempts,
      );

      expect(decision).toEqual({
        write: expectedWrite({
          keywords: { kind: 'set', value: DOCUMENT.extractionInput },
          keywordStatus: 'fallback',
          extractionInputHash: null,
        }),
        retry: false,
        notify: false,
      });
    },
  );

  test('設定の誤りなら、試行が上限未満でも縮退索引とし、再試行せずに通知する', () => {
    const decision = decide({ kind: 'configuration-error', status: 403 }, 1);

    expect(decision).toEqual({
      write: expectedWrite({
        keywords: { kind: 'set', value: DOCUMENT.extractionInput },
        keywordStatus: 'fallback',
        extractionInputHash: null,
      }),
      retry: false,
      notify: true,
    });
  });

  test.each<KeywordExtractionOutcome>([
    { kind: 'extracted', keywords: 'キーワード' },
    { kind: 'unsupported-language', languageCode: undefined },
    { kind: 'disabled' },
    { kind: 'temporary-failure', reason: 'network' },
    { kind: 'configuration-error', status: 401 },
  ])('結果が$kindでも、元テキストの列と版は常に最新の値を書く', (outcome) => {
    const { write } = decide(outcome);

    expect(write.texts).toEqual(DOCUMENT.texts);
    expect(write.sourceVersion).toBe(DOCUMENT.sourceVersion);
    expect(write.statusChangedAt).toEqual(NOW);
  });
});
