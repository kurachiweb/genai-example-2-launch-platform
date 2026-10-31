import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  SEARCH_INDEX_REFRESH_RETRY,
  type SearchIndexRefreshBody,
} from '../../../lib/core/messaging/contracts/search-index-refresh.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import {
  buildIndexDocument,
  type IndexDocument,
} from '../../../lib/core/search/index-document.ts';
import type { KeywordStatus } from '../../../lib/core/search/keyword-status.ts';
import type {
  IndexWrite,
  KeywordExtractionOutcome,
  KeywordExtractor,
  SearchIndexStore,
  SearchSourceProvider,
  SearchTargetCatalog,
} from '../../../lib/core/search/ports.ts';
import {
  decideAfterExtraction,
  planRefresh,
} from '../../../lib/core/search/refresh-decision.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { SearchIncidentReporter } from './ports.ts';
import { EVENT_SEARCH_TYPES } from './search-types.ts';

const logger = getAppLogger(['event', 'search', 'index']);

const RESULT_MESSAGE = '索引の更新を終えました';

type RefreshResult =
  | 'extracted'
  | 'reused'
  | 'fallback'
  | 'unsupported'
  | 'disabled'
  | 'removed'
  | 'stale'
  | 'skipped'
  | 'retrying';

type LogLevel = 'info' | 'warning' | 'error';

interface HandlingContext {
  readonly target: string;
  readonly sourceId: string;
  readonly attempts: number;
}

// 本文とキーワードを出さないよう、ログの属性は識別子・結果・数値・外部APIの分類の値だけで組む
type LogDetails = Readonly<Record<string, string | number>>;

const MAX_BMP_CODE_POINT = 0xff_ff;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const RESULT_BY_STATUS: Readonly<Record<KeywordStatus, RefreshResult>> = {
  extracted: 'extracted',
  unsupported: 'unsupported',
  disabled: 'disabled',
  fallback: 'fallback',
  pending: 'retrying',
};

type TemporaryFailureReason = Extract<
  KeywordExtractionOutcome,
  { kind: 'temporary-failure' }
>['reason'];

export class SearchKeywordExtractionRetryError extends Error {
  override readonly name = 'SearchKeywordExtractionRetryError';

  constructor(reason: TemporaryFailureReason) {
    super(
      `キーワード抽出の外部APIの一時的な失敗のため、索引の更新を再試行します: ${reason}`,
    );
  }
}

// 外部APIの料金は文字数で決まるため、UTF-16の長さではなくコードポイントで数える
function countCodePoints(text: string): number {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    index += (text.codePointAt(index) ?? 0) > MAX_BMP_CODE_POINT ? 2 : 1;
    count += 1;
  }
  return count;
}

function detailsOf(
  outcome: KeywordExtractionOutcome,
  input: string,
): LogDetails {
  if (outcome.kind === 'disabled') {
    return {};
  }
  const sentCharacters = countCodePoints(input);
  switch (outcome.kind) {
    case 'extracted':
      return { sentCharacters };
    case 'unsupported-language':
      return outcome.languageCode === undefined
        ? { sentCharacters }
        : { sentCharacters, languageCode: outcome.languageCode };
    case 'temporary-failure':
      return { sentCharacters, failureReason: outcome.reason };
    case 'configuration-error':
      return { sentCharacters, status: outcome.status };
  }
}

// 抽出の入力が空ならキーワードも空で確定し、同じ入力の間は抽出し直す必要が無いため抽出済みとする
function emptyKeywordsWrite(document: IndexDocument, now: Date): IndexWrite {
  return {
    sourceVersion: document.sourceVersion,
    texts: document.texts,
    keywords: { kind: 'set', value: '' },
    keywordStatus: 'extracted',
    extractionInputHash: document.extractionInputHash,
    statusChangedAt: now,
  };
}

function reusedKeywordsWrite(
  document: IndexDocument,
  status: 'extracted' | 'unsupported',
  now: Date,
): IndexWrite {
  return {
    sourceVersion: document.sourceVersion,
    texts: document.texts,
    keywords: { kind: 'keep' },
    keywordStatus: status,
    extractionInputHash: document.extractionInputHash,
    statusChangedAt: now,
  };
}

@injectable()
export class SearchIndexRefreshHandler implements MessageHandler<SearchIndexRefreshBody> {
  constructor(
    @inject(SEARCH_TYPES.TargetCatalog)
    private readonly catalog: SearchTargetCatalog,
    @inject(SEARCH_TYPES.SourceProvider)
    private readonly provider: SearchSourceProvider,
    @inject(SEARCH_TYPES.IndexStore)
    private readonly store: SearchIndexStore,
    @inject(SEARCH_TYPES.KeywordExtractor)
    private readonly extractor: KeywordExtractor,
    @inject(EVENT_SEARCH_TYPES.SearchIncidentReporter)
    private readonly incidents: SearchIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(
    body: SearchIndexRefreshBody,
    meta: MessageMeta,
  ): Promise<MessageHandlingResult> {
    const context: HandlingContext = {
      target: body.target,
      sourceId: body.sourceId,
      attempts: meta.attempts,
    };
    const target = this.catalog.find(body.target);
    // 登録の誤りは再試行しても直らないため、処理せずに運用者へ知らせる
    if (target === undefined) {
      this.incidents.report({
        kind: 'unregistered-target',
        target: body.target,
      });
      return this.finish(
        context,
        'skipped',
        { reason: 'unregistered-target' },
        'error',
      );
    }
    const source = await this.provider.read(body.target, body.sourceId);
    if (source === undefined) {
      await this.store.delete(body.target, body.sourceId);
      return this.finish(context, 'removed');
    }
    const document = await buildIndexDocument(target, source);
    const plan = planRefresh(
      await this.store.findState(body.target, body.sourceId),
      document,
    );
    switch (plan.kind) {
      case 'skip-stale':
        return this.finish(context, 'stale');
      case 'store-empty':
        return this.writeWithoutExtraction(
          context,
          emptyKeywordsWrite(document, this.clock.now()),
          'extracted',
        );
      case 'reuse-keywords':
        return this.writeWithoutExtraction(
          context,
          reusedKeywordsWrite(document, plan.status, this.clock.now()),
          'reused',
        );
      case 'extract':
        return this.extract(context, document);
    }
  }

  private async writeWithoutExtraction(
    context: HandlingContext,
    write: IndexWrite,
    result: RefreshResult,
  ): Promise<MessageHandlingResult> {
    const written = await this.store.upsert(
      context.target,
      context.sourceId,
      write,
    );
    return this.finish(context, written === 'written' ? result : 'skipped');
  }

  private async extract(
    context: HandlingContext,
    document: IndexDocument,
  ): Promise<MessageHandlingResult> {
    const outcome = await this.extractor.extract(document.extractionInput);
    const decision = decideAfterExtraction({
      outcome,
      document,
      attempts: context.attempts,
      maxAttempts: SEARCH_INDEX_REFRESH_RETRY.maxAttempts,
      now: this.clock.now(),
    });
    const written = await this.store.upsert(
      context.target,
      context.sourceId,
      decision.write,
    );
    // 設定の誤りは索引文書の有無に関わらず全ての更新で起きるため、書かれなかった場合も知らせる
    if (decision.notify && outcome.kind === 'configuration-error') {
      this.incidents.report({
        kind: 'extractor-misconfigured',
        target: context.target,
        status: outcome.status,
      });
    }
    const details = detailsOf(outcome, document.extractionInput);
    // 書かれなかったのは元データの削除・対象外・新しい版のためで、再試行しても書く対象が無い
    if (written === 'skipped') {
      return this.finish(context, 'skipped', details);
    }
    const result = RESULT_BY_STATUS[decision.write.keywordStatus];
    const level: LogLevel = decision.notify
      ? 'error'
      : result === 'fallback' || result === 'retrying'
        ? 'warning'
        : 'info';
    if (decision.retry && outcome.kind === 'temporary-failure') {
      this.log(context, result, details, level);
      throw new SearchKeywordExtractionRetryError(outcome.reason);
    }
    return this.finish(context, result, details, level);
  }

  private finish(
    context: HandlingContext,
    result: RefreshResult,
    details: LogDetails = {},
    level: LogLevel = 'info',
  ): MessageHandlingResult {
    this.log(context, result, details, level);
    return DONE;
  }

  private log(
    context: HandlingContext,
    result: RefreshResult,
    details: LogDetails,
    level: LogLevel,
  ): void {
    const properties = { result, ...context, ...details };
    switch (level) {
      case 'error':
        logger.error(RESULT_MESSAGE, properties);
        return;
      case 'warning':
        logger.warn(RESULT_MESSAGE, properties);
        return;
      case 'info':
        logger.info(RESULT_MESSAGE, properties);
    }
  }
}
