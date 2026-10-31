import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SEARCH_INDEX_REFRESH_RETRY } from '../../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { MessageHandlingResult } from '../../../lib/core/messaging/message-contract.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import {
  buildIndexDocument,
  type IndexDocument,
} from '../../../lib/core/search/index-document.ts';
import type {
  IndexWrite,
  KeywordExtractionOutcome,
  KeywordExtractor,
  SearchIndexStore,
  SearchSourceProvider,
  SearchTargetCatalog,
} from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { SearchIncident, SearchIncidentReporter } from './ports.ts';
import {
  bodyOf,
  clearCapturedLogs,
  createHarness,
  EXTRACTED_KEYWORDS,
  FIXTURE_TARGET,
  handlerLogs,
  type HarnessOptions,
  metaOf,
  NOW,
  portsOf,
  PREVIOUS_KEYWORDS,
  resultLog,
  SOURCE_DESCRIPTION,
  SOURCE_ID,
  SOURCE_NAME,
  SOURCE_TAGLINE,
  sourceOf,
  startLogCapture,
  stopLogCapture,
  type StoredDocument,
  TARGET_NAME,
  upsertsOf,
} from './search-index-refresh-handler.fixtures.ts';
import {
  SearchIndexRefreshHandler,
  SearchKeywordExtractionRetryError,
} from './search-index-refresh-handler.ts';
import { EVENT_SEARCH_TYPES } from './search-types.ts';

beforeAll(startLogCapture);
afterAll(stopLogCapture);
beforeEach(clearCapturedLogs);

const DONE: MessageHandlingResult = { kind: 'done' };

const DESIGNED_RESULTS = [
  'extracted',
  'reused',
  'fallback',
  'unsupported',
  'disabled',
  'removed',
  'stale',
  'skipped',
  'retrying',
] as const;

const EARLIER = new Date('2030-01-14T00:00:00.000Z');

const defaultDocument = (): Promise<IndexDocument> =>
  buildIndexDocument(FIXTURE_TARGET, sourceOf());

function storedOf(overrides: Partial<StoredDocument> = {}): StoredDocument {
  return {
    sourceVersion: 900,
    texts: { name: '古い名前', tagline: '古い宣伝文' },
    keywords: PREVIOUS_KEYWORDS,
    keywordStatus: 'extracted',
    extractionInputHash: 'previous-hash',
    statusChangedAt: EARLIER,
    ...overrides,
  };
}

function codePointsOf(text: string): number {
  return Array.from(text).length;
}

async function handleSettled(
  options: HarnessOptions,
  attempts = 1,
): Promise<{
  readonly harness: ReturnType<typeof createHarness>;
  readonly result: MessageHandlingResult | undefined;
  readonly error: unknown;
}> {
  const harness = createHarness(options);
  try {
    const result = await harness.handler.handle(bodyOf(), metaOf(attempts));
    return { harness, result, error: undefined };
  } catch (error) {
    return { harness, result: undefined, error };
  }
}

describe('SearchIndexRefreshHandler', () => {
  describe('未登録の検索対象', () => {
    test('どのポートも呼ばずに、errorログと通知を出して再試行せずに完了する', async () => {
      const { handler, calls, incidents } = createHarness();

      const result = await handler.handle(bodyOf('retired-target'), metaOf(2));

      expect(result).toEqual(DONE);
      expect(calls).toEqual([]);
      expect(incidents).toStrictEqual<SearchIncident[]>([
        { kind: 'unregistered-target', target: 'retired-target' },
      ]);
      const log = resultLog();
      expect(log.level).toBe('error');
      expect(log.properties).toStrictEqual({
        result: 'skipped',
        reason: 'unregistered-target',
        target: 'retired-target',
        sourceId: SOURCE_ID,
        attempts: 2,
      });
    });
  });

  describe('元データが無い場合', () => {
    test('元データが削除済み・対象外なら、索引文書を削除して完了する', async () => {
      const { handler, calls, incidents, stored } = createHarness({
        source: undefined,
        stored: storedOf({ keywordStatus: 'pending' }),
      });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual(DONE);
      expect(calls).toEqual([
        { port: 'read', target: TARGET_NAME, sourceId: SOURCE_ID },
        { port: 'delete', target: TARGET_NAME, sourceId: SOURCE_ID },
      ]);
      expect(stored()).toBeUndefined();
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toStrictEqual({
        result: 'removed',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
      });
    });
  });

  describe('抽出しない計画', () => {
    test('保存済みの版が新しければ、書かずに古い版として完了する', async () => {
      const { handler, calls } = createHarness({
        stored: storedOf({ sourceVersion: 2000 }),
      });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual(DONE);
      expect(portsOf(calls)).toEqual(['read', 'findState']);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toStrictEqual({
        result: 'stale',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
      });
    });

    test('抽出の入力が空なら、外部APIを呼ばずに空のキーワードと抽出済みとハッシュを書く', async () => {
      const source = sourceOf({ name: '', tagline: ' ', description: '' });
      const document = await buildIndexDocument(FIXTURE_TARGET, source);
      const { handler, calls } = createHarness({ source });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual(DONE);
      expect(portsOf(calls)).toEqual(['read', 'findState', 'upsert']);
      expect(upsertsOf(calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: { name: '', tagline: '' },
          keywords: { kind: 'set', value: '' },
          keywordStatus: 'extracted',
          extractionInputHash: document.extractionInputHash,
          statusChangedAt: NOW,
        },
      ]);
      expect(resultLog().properties).toStrictEqual({
        result: 'extracted',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
      });
    });

    test.each([
      ['抽出済み', 'extracted', 'extracted'],
      ['更新待ち', 'pending', 'extracted'],
      ['非対応言語', 'unsupported', 'unsupported'],
    ] as const)(
      '前回の状態が%sで抽出の入力が同じなら、外部APIを呼ばずに前回のキーワードを保つ',
      async (_label, previousStatus, writtenStatus) => {
        const document = await defaultDocument();
        const { handler, calls, stored } = createHarness({
          stored: storedOf({
            keywordStatus: previousStatus,
            extractionInputHash: document.extractionInputHash,
          }),
        });

        const result = await handler.handle(bodyOf(), metaOf());

        expect(result).toEqual(DONE);
        expect(portsOf(calls)).toEqual(['read', 'findState', 'upsert']);
        expect(upsertsOf(calls)).toStrictEqual<IndexWrite[]>([
          {
            sourceVersion: 1000,
            texts: document.texts,
            keywords: { kind: 'keep' },
            keywordStatus: writtenStatus,
            extractionInputHash: document.extractionInputHash,
            statusChangedAt: NOW,
          },
        ]);
        expect(stored()?.keywords).toBe(PREVIOUS_KEYWORDS);
        expect(resultLog().properties).toStrictEqual({
          result: 'reused',
          target: TARGET_NAME,
          sourceId: SOURCE_ID,
          attempts: 1,
        });
      },
    );
  });

  describe('抽出の結果', () => {
    test('抽出に成功すれば、抽出の入力だけを送り、キーワードとハッシュを書いて送った文字数を記録する', async () => {
      const document = await defaultDocument();
      const { handler, calls } = createHarness({
        stored: storedOf({ keywordStatus: 'pending' }),
      });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual(DONE);
      expect(calls).toContainEqual({
        port: 'extract',
        text: document.extractionInput,
      });
      expect(upsertsOf(calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'set', value: EXTRACTED_KEYWORDS },
          keywordStatus: 'extracted',
          extractionInputHash: document.extractionInputHash,
          statusChangedAt: NOW,
        },
      ]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toStrictEqual({
        result: 'extracted',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
        sentCharacters: codePointsOf(document.extractionInput),
      });
    });

    test('送った文字数は、サロゲートペアの文字を1文字と数える', async () => {
      const source = sourceOf({ name: '𠮷野家', tagline: '', description: '' });
      const { handler } = createHarness({ source });

      await handler.handle(bodyOf(), metaOf());

      expect(resultLog().properties).toMatchObject({ sentCharacters: 3 });
    });

    test('一時的な失敗が上限未満なら、元テキストの列を最新にしキーワードを保って書いてから、再試行の例外を投げる', async () => {
      const document = await defaultDocument();
      const { harness, error } = await handleSettled(
        {
          stored: storedOf({ keywordStatus: 'pending' }),
          outcome: { kind: 'temporary-failure', reason: 'rate-limited' },
        },
        SEARCH_INDEX_REFRESH_RETRY.maxAttempts - 1,
      );

      expect(error).toBeInstanceOf(SearchKeywordExtractionRetryError);
      expect((error as Error).name).toBe('SearchKeywordExtractionRetryError');
      expect((error as Error).message).toContain('rate-limited');
      expect(portsOf(harness.calls)).toEqual([
        'read',
        'findState',
        'extract',
        'upsert',
      ]);
      expect(upsertsOf(harness.calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'keep' },
          keywordStatus: 'pending',
          extractionInputHash: null,
          statusChangedAt: NOW,
        },
      ]);
      expect(harness.stored()?.keywords).toBe(PREVIOUS_KEYWORDS);
      expect(harness.incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('warning');
      expect(log.properties).toStrictEqual({
        result: 'retrying',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: SEARCH_INDEX_REFRESH_RETRY.maxAttempts - 1,
        sentCharacters: codePointsOf(document.extractionInput),
        failureReason: 'rate-limited',
      });
    });

    test('一時的な失敗が上限の試行なら、例外にせず抽出の入力で縮退索引を書いて完了する', async () => {
      const document = await defaultDocument();
      const { harness, result, error } = await handleSettled(
        { outcome: { kind: 'temporary-failure', reason: 'timeout' } },
        SEARCH_INDEX_REFRESH_RETRY.maxAttempts,
      );

      expect(error).toBeUndefined();
      expect(result).toEqual(DONE);
      expect(upsertsOf(harness.calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'set', value: document.extractionInput },
          keywordStatus: 'fallback',
          extractionInputHash: null,
          statusChangedAt: NOW,
        },
      ]);
      expect(harness.incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('warning');
      expect(log.properties).toStrictEqual({
        result: 'fallback',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: SEARCH_INDEX_REFRESH_RETRY.maxAttempts,
        sentCharacters: codePointsOf(document.extractionInput),
        failureReason: 'timeout',
      });
    });

    test('非対応言語なら、再試行せずに抽出の入力とハッシュで非対応言語の索引を書く', async () => {
      const document = await defaultDocument();
      const { harness, result } = await handleSettled({
        outcome: { kind: 'unsupported-language', languageCode: 'xx' },
      });

      expect(result).toEqual(DONE);
      expect(upsertsOf(harness.calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'set', value: document.extractionInput },
          keywordStatus: 'unsupported',
          extractionInputHash: document.extractionInputHash,
          statusChangedAt: NOW,
        },
      ]);
      expect(harness.incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toStrictEqual({
        result: 'unsupported',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
        sentCharacters: codePointsOf(document.extractionInput),
        languageCode: 'xx',
      });
    });

    test('非対応言語で言語が分からなければ、言語の属性を出さない', async () => {
      await handleSettled({
        outcome: { kind: 'unsupported-language', languageCode: undefined },
      });

      expect(resultLog().properties).not.toHaveProperty('languageCode');
    });

    test('抽出が無効なら、外部APIへ送っていないため送った文字数を出さずに無効の索引を書く', async () => {
      const document = await defaultDocument();
      const { harness, result } = await handleSettled({
        outcome: { kind: 'disabled' },
      });

      expect(result).toEqual(DONE);
      expect(upsertsOf(harness.calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'set', value: document.extractionInput },
          keywordStatus: 'disabled',
          extractionInputHash: null,
          statusChangedAt: NOW,
        },
      ]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toStrictEqual({
        result: 'disabled',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
      });
    });

    test('設定の誤りなら、縮退索引を書き、種類と検索対象と状態コードだけで通知して完了する', async () => {
      const document = await defaultDocument();
      const { harness, result } = await handleSettled({
        outcome: { kind: 'configuration-error', status: 403 },
      });

      expect(result).toEqual(DONE);
      expect(upsertsOf(harness.calls)).toStrictEqual<IndexWrite[]>([
        {
          sourceVersion: 1000,
          texts: document.texts,
          keywords: { kind: 'set', value: document.extractionInput },
          keywordStatus: 'fallback',
          extractionInputHash: null,
          statusChangedAt: NOW,
        },
      ]);
      expect(harness.incidents).toStrictEqual<SearchIncident[]>([
        { kind: 'extractor-misconfigured', target: TARGET_NAME, status: 403 },
      ]);
      const log = resultLog();
      expect(log.level).toBe('error');
      expect(log.properties).toStrictEqual({
        result: 'fallback',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
        sentCharacters: codePointsOf(document.extractionInput),
        status: 403,
      });
    });
  });

  describe('条件で書かれなかった場合', () => {
    test.each<[string, HarnessOptions]>([
      ['抽出に成功した', {}],
      [
        '一時的な失敗が上限未満の',
        { outcome: { kind: 'temporary-failure', reason: 'server-error' } },
      ],
    ])(
      '%s書き込みが元データの削除・対象外・新しい版で書かれなければ、再試行せずに完了する',
      async (_label, options) => {
        const { harness, result, error } = await handleSettled({
          ...options,
          upsertSkipped: true,
        });

        expect(error).toBeUndefined();
        expect(result).toEqual(DONE);
        expect(portsOf(harness.calls)).toEqual([
          'read',
          'findState',
          'extract',
          'upsert',
        ]);
        const log = resultLog();
        expect(log.level).toBe('info');
        expect(log.properties).toMatchObject({
          result: 'skipped',
          target: TARGET_NAME,
          sourceId: SOURCE_ID,
        });
      },
    );

    test('前回のキーワードを使う書き込みが書かれなくても、完了する', async () => {
      const document = await defaultDocument();
      const { harness, result } = await handleSettled({
        stored: storedOf({ extractionInputHash: document.extractionInputHash }),
        upsertSkipped: true,
      });

      expect(result).toEqual(DONE);
      expect(resultLog().properties).toStrictEqual({
        result: 'skipped',
        target: TARGET_NAME,
        sourceId: SOURCE_ID,
        attempts: 1,
      });
      expect(harness.stored()?.statusChangedAt).toBe(EARLIER);
    });

    test('設定の誤りは書かれなくても通知する', async () => {
      const { harness } = await handleSettled({
        outcome: { kind: 'configuration-error', status: 401 },
        upsertSkipped: true,
      });

      expect(harness.incidents).toStrictEqual<SearchIncident[]>([
        { kind: 'extractor-misconfigured', target: TARGET_NAME, status: 401 },
      ]);
      expect(resultLog().properties).toMatchObject({
        result: 'skipped',
        status: 401,
      });
    });
  });

  describe('重複の配信', () => {
    test('同じ本文を2回処理しても、外部APIは1回だけ呼ばれ、索引文書は1回処理した場合と同じになる', async () => {
      const once = createHarness();
      await once.handler.handle(bodyOf(), metaOf());
      const twice = createHarness();

      await twice.handler.handle(bodyOf(), metaOf());
      await twice.handler.handle(bodyOf(), metaOf(2));

      expect(twice.stored()).toStrictEqual(once.stored());
      expect(portsOf(twice.calls).filter((port) => port === 'extract')).toEqual(
        ['extract'],
      );
    });

    test('同じ保存の状態から同じ本文を処理すると、同じ書き込みになる', async () => {
      const first = createHarness({ stored: storedOf() });
      const second = createHarness({ stored: storedOf() });

      await first.handler.handle(bodyOf(), metaOf());
      await second.handler.handle(bodyOf(), metaOf());

      expect(upsertsOf(second.calls)).toStrictEqual(upsertsOf(first.calls));
    });
  });

  describe('ログ', () => {
    const scenarios: [string, HarnessOptions, number][] = [
      ['抽出', {}, 1],
      ['削除', { source: undefined }, 1],
      ['古い版', { stored: storedOf({ sourceVersion: 5000 }) }, 1],
      [
        '再試行',
        { outcome: { kind: 'temporary-failure', reason: 'network' } },
        1,
      ],
      [
        '縮退',
        { outcome: { kind: 'temporary-failure', reason: 'network' } },
        SEARCH_INDEX_REFRESH_RETRY.maxAttempts,
      ],
      [
        '非対応言語',
        { outcome: { kind: 'unsupported-language', languageCode: 'xx' } },
        1,
      ],
      ['無効', { outcome: { kind: 'disabled' } }, 1],
      [
        '設定の誤り',
        { outcome: { kind: 'configuration-error', status: 200 } },
        1,
      ],
      ['書かれなかった', { upsertSkipped: true }, 1],
    ];

    test.each(scenarios)(
      '%sの結果のログは1件で、結果の値が設計の一覧のいずれかであり、本文とキーワードを含まない',
      async (_label, options, attempts) => {
        const { error } = await handleSettled(options, attempts);

        const log = resultLog();
        expect(DESIGNED_RESULTS).toContain(
          log.properties.result as (typeof DESIGNED_RESULTS)[number],
        );
        const serialized = JSON.stringify([
          log.message,
          log.properties,
          error instanceof Error ? error.message : null,
        ]);
        for (const secret of [
          SOURCE_NAME,
          SOURCE_TAGLINE,
          '非公開',
          SOURCE_DESCRIPTION,
          EXTRACTED_KEYWORDS,
          '抽出した',
          PREVIOUS_KEYWORDS,
        ]) {
          expect(serialized).not.toContain(secret);
        }
      },
    );

    test('結果のログは処理の結果を表す定型の文言で出す', async () => {
      await handleSettled({});

      expect(handlerLogs().map(({ message }) => message.join(''))).toEqual([
        '索引の更新を終えました',
      ]);
    });
  });

  describe('依存の注入', () => {
    test('検索の識別子と基盤の時計の識別子で、コンストラクタ引数を解決できる', async () => {
      const incidents: SearchIncident[] = [];
      const container = new Container();
      container
        .bind<SearchTargetCatalog>(SEARCH_TYPES.TargetCatalog)
        .toConstantValue({
          find: () => undefined,
          names: () => [],
        });
      container
        .bind<SearchSourceProvider>(SEARCH_TYPES.SourceProvider)
        .toConstantValue({ read: () => Promise.resolve(undefined) });
      container
        .bind<SearchIndexStore>(SEARCH_TYPES.IndexStore)
        .toConstantValue({} as SearchIndexStore);
      container
        .bind<KeywordExtractor>(SEARCH_TYPES.KeywordExtractor)
        .toConstantValue({
          extract: (): Promise<KeywordExtractionOutcome> =>
            Promise.resolve({ kind: 'disabled' }),
        });
      container
        .bind<SearchIncidentReporter>(EVENT_SEARCH_TYPES.SearchIncidentReporter)
        .toConstantValue({ report: (incident) => incidents.push(incident) });
      container
        .bind<Clock>(PLATFORM_TYPES.Clock)
        .toConstantValue({ now: () => NOW });
      container.bind(SEARCH_TYPES.RefreshHandler).to(SearchIndexRefreshHandler);

      const handler = container.get<SearchIndexRefreshHandler>(
        SEARCH_TYPES.RefreshHandler,
      );
      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual(DONE);
      expect(incidents).toStrictEqual<SearchIncident[]>([
        { kind: 'unregistered-target', target: TARGET_NAME },
      ]);
    });
  });
});
