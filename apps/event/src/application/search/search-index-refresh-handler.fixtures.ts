import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { SearchIndexRefreshBody } from '../../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { MessageMeta } from '../../../lib/core/messaging/message-contract.ts';
import type {
  IndexWrite,
  KeywordExtractionOutcome,
  KeywordExtractor,
  SearchIndexStore,
  SearchSourceProvider,
  SearchTargetCatalog,
  StoredIndexState,
} from '../../../lib/core/search/ports.ts';
import type {
  SearchSource,
  SearchTargetInfo,
} from '../../../lib/core/search/search-target.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { SearchIncident, SearchIncidentReporter } from './ports.ts';
import { SearchIndexRefreshHandler } from './search-index-refresh-handler.ts';

export const LOG_CATEGORY = ['event', 'search', 'index'] as const;

export const TARGET_NAME = 'fixture-product';

export const SOURCE_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';

export const NOW = new Date('2030-01-15T12:00:00.000Z');

export const SOURCE_NAME = 'ローンチ用の秘密の製品名';

export const SOURCE_TAGLINE = 'まだ公開していない宣伝文';

export const SOURCE_DESCRIPTION = '## 説明\n\n**非公開**の本文です。';

export const EXTRACTED_KEYWORDS = '抽出した 秘密の キーワード';

export const PREVIOUS_KEYWORDS = '前回の キーワード';

export const FIXTURE_TARGET: SearchTargetInfo = {
  name: TARGET_NAME,
  fields: {
    name: { format: 'plain', textColumn: true, extract: true },
    tagline: { format: 'plain', textColumn: true, extract: true },
    description: { format: 'markdown', textColumn: false, extract: true },
  },
};

export function sourceOf(
  overrides: Partial<Record<'name' | 'tagline' | 'description', string>> & {
    readonly version?: number;
  } = {},
): SearchSource {
  const { version = 1000, ...fields } = overrides;
  return {
    version,
    fields: {
      name: SOURCE_NAME,
      tagline: SOURCE_TAGLINE,
      description: SOURCE_DESCRIPTION,
      ...fields,
    },
  };
}

export function bodyOf(target: string = TARGET_NAME): SearchIndexRefreshBody {
  return { target, sourceId: SOURCE_ID };
}

export function metaOf(attempts = 1): MessageMeta {
  return {
    id: 'message-1',
    type: 'search-index.refresh',
    attempts,
    sentAt: new Date('2030-01-15T11:59:00.000Z'),
  };
}

export interface StoredDocument {
  readonly sourceVersion: number;
  readonly texts: Readonly<Record<string, string>>;
  readonly keywords: string;
  readonly keywordStatus: StoredIndexState['keywordStatus'];
  readonly extractionInputHash: string | null;
  readonly statusChangedAt: Date;
}

export type PortCall =
  | {
      readonly port: 'read';
      readonly target: string;
      readonly sourceId: string;
    }
  | {
      readonly port: 'findState';
      readonly target: string;
      readonly sourceId: string;
    }
  | {
      readonly port: 'upsert';
      readonly target: string;
      readonly sourceId: string;
      readonly write: IndexWrite;
    }
  | {
      readonly port: 'delete';
      readonly target: string;
      readonly sourceId: string;
    }
  | { readonly port: 'extract'; readonly text: string };

export interface HarnessOptions {
  readonly source?: SearchSource | undefined;
  readonly stored?: StoredDocument;
  readonly outcome?: KeywordExtractionOutcome;
  // 元データの削除や対象外への変更が、読み取りと書き込みの間に起きた場合を再現する
  readonly upsertSkipped?: boolean;
}

export interface Harness {
  readonly handler: SearchIndexRefreshHandler;
  readonly calls: PortCall[];
  readonly incidents: SearchIncident[];
  readonly stored: () => StoredDocument | undefined;
}

function stateOf(document: StoredDocument): StoredIndexState {
  return {
    sourceVersion: document.sourceVersion,
    keywordStatus: document.keywordStatus,
    extractionInputHash: document.extractionInputHash ?? undefined,
  };
}

function applyWrite(
  current: StoredDocument | undefined,
  write: IndexWrite,
): StoredDocument {
  return {
    sourceVersion: write.sourceVersion,
    texts: write.texts,
    keywords:
      write.keywords.kind === 'set'
        ? write.keywords.value
        : (current?.keywords ?? ''),
    keywordStatus: write.keywordStatus,
    extractionInputHash: write.extractionInputHash,
    statusChangedAt: write.statusChangedAt,
  };
}

// 保存の偽物は、実際の索引の保存と同じく保存済みの版より古い書き込みを無視し、keepならキーワードの列を保つ
export function createHarness(options: HarnessOptions = {}): Harness {
  const calls: PortCall[] = [];
  const incidents: SearchIncident[] = [];
  let stored = options.stored;
  const source = 'source' in options ? options.source : sourceOf();

  const catalog: SearchTargetCatalog = {
    find: (name) => (name === TARGET_NAME ? FIXTURE_TARGET : undefined),
    names: () => [TARGET_NAME],
  };
  const provider: SearchSourceProvider = {
    read: (target, sourceId) => {
      calls.push({ port: 'read', target, sourceId });
      return Promise.resolve(source);
    },
  };
  const store: SearchIndexStore = {
    findState: (target, sourceId) => {
      calls.push({ port: 'findState', target, sourceId });
      return Promise.resolve(stored && stateOf(stored));
    },
    upsert: (target, sourceId, write) => {
      calls.push({ port: 'upsert', target, sourceId, write });
      if (
        options.upsertSkipped === true ||
        (stored !== undefined && stored.sourceVersion > write.sourceVersion)
      ) {
        return Promise.resolve('skipped');
      }
      stored = applyWrite(stored, write);
      return Promise.resolve('written');
    },
    delete: (target, sourceId) => {
      calls.push({ port: 'delete', target, sourceId });
      stored = undefined;
      return Promise.resolve();
    },
    findSourceIdsForReextraction: () =>
      Promise.reject(new Error('索引の更新の処理は再抽出の候補を読まない')),
  };
  const extractor: KeywordExtractor = {
    extract: (text) => {
      calls.push({ port: 'extract', text });
      return Promise.resolve(
        options.outcome ?? { kind: 'extracted', keywords: EXTRACTED_KEYWORDS },
      );
    },
  };
  const reporter: SearchIncidentReporter = {
    report: (incident) => {
      incidents.push(incident);
    },
  };
  const clock: Clock = { now: () => NOW };

  return {
    handler: new SearchIndexRefreshHandler(
      catalog,
      provider,
      store,
      extractor,
      reporter,
      clock,
    ),
    calls,
    incidents,
    stored: () => stored,
  };
}

export function portsOf(calls: readonly PortCall[]): string[] {
  return calls.map(({ port }) => port);
}

export function upsertsOf(calls: readonly PortCall[]): IndexWrite[] {
  return calls.flatMap((call) => (call.port === 'upsert' ? [call.write] : []));
}

const records: LogRecord[] = [];

export function startLogCapture(): void {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
}

export function stopLogCapture(): void {
  resetSync();
}

export function clearCapturedLogs(): void {
  records.length = 0;
}

export function handlerLogs(): LogRecord[] {
  const expected = LOG_CATEGORY.join('.');
  return records.filter((record) => record.category.join('.') === expected);
}

export function resultLog(): LogRecord {
  const logs = handlerLogs();
  const [log] = logs;
  if (logs.length !== 1 || log === undefined) {
    throw new Error(`結果のログが1件ではありません: ${String(logs.length)}件`);
  }
  return log;
}
