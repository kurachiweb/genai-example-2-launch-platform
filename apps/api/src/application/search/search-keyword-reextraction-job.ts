import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { ScheduledJobHandler } from '../../../lib/core/scheduling/cron-registry.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type {
  SearchIndexRefreshRequester,
  SearchIndexStore,
  SearchTargetCatalog,
} from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export const REEXTRACTION_PENDING_TIMEOUT_MS = 3_600_000;
// 外部APIの毎分の要求の上限に対し、1日の再抽出が通常の索引の更新を押し出さない件数に抑える
export const REEXTRACTION_LIMIT_PER_TARGET = 200;

const logger = getAppLogger(['api', 'search', 'reextraction']);

export class SearchKeywordReextractionError extends Error {
  override readonly name = 'SearchKeywordReextractionError';
}

interface TargetResult {
  readonly target: string;
  readonly status: 'completed' | 'lookup-failed';
  readonly found: number;
  readonly requested: number;
  readonly failed: number;
}

interface TargetOutcome {
  readonly result: TargetResult;
  readonly errors: readonly unknown[];
}

@injectable()
export class SearchKeywordReextractionJob implements ScheduledJobHandler {
  constructor(
    @inject(SEARCH_TYPES.TargetCatalog)
    private readonly catalog: SearchTargetCatalog,
    @inject(SEARCH_TYPES.IndexStore)
    private readonly store: SearchIndexStore,
    @inject(SEARCH_TYPES.RefreshRequester)
    private readonly requester: SearchIndexRefreshRequester,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const pendingBefore = new Date(
      this.clock.now().getTime() - REEXTRACTION_PENDING_TIMEOUT_MS,
    );
    const outcomes: TargetOutcome[] = [];
    for (const target of this.catalog.names()) {
      outcomes.push(await this.reextract(target, pendingBefore));
    }

    const targets = outcomes.map(({ result }) => result);
    const requested = sum(targets.map((result) => result.requested));
    const failed = sum(targets.map((result) => result.failed));
    logger.info('検索のキーワードの日次の再抽出を要求しました', {
      targets,
      requested,
      failed,
    });

    const [firstError] = outcomes.flatMap(({ errors }) => errors);
    if (firstError !== undefined) {
      const lookupFailed = targets.filter(
        ({ status }) => status === 'lookup-failed',
      ).length;
      // 1件ごとの失敗はログに残したうえで、まとめて1件の例外にしてディスパッチャからエラートラッキングへ送る
      throw new SearchKeywordReextractionError(
        `日次の再抽出で${String(failed)}件の更新の要求と${String(lookupFailed)}件の検索対象の候補の取得に失敗しました`,
        { cause: firstError },
      );
    }
  }

  private async reextract(
    target: string,
    pendingBefore: Date,
  ): Promise<TargetOutcome> {
    let sourceIds: readonly string[];
    try {
      sourceIds = await this.store.findSourceIdsForReextraction(
        target,
        pendingBefore,
        REEXTRACTION_LIMIT_PER_TARGET,
      );
    } catch (error) {
      logger.error('再抽出の候補を取得できませんでした', { error, target });
      return {
        result: {
          target,
          status: 'lookup-failed',
          found: 0,
          requested: 0,
          failed: 0,
        },
        errors: [error],
      };
    }

    // 未登録の検索対象や契約に合わない本文は要求の部品が例外で伝えるため、1件ごとに捕まえて残りの要求を止めない
    const errors: unknown[] = [];
    for (const sourceId of sourceIds) {
      try {
        await this.requester.requestRefresh(target, sourceId);
      } catch (error) {
        logger.error('再抽出の更新を要求できませんでした', {
          error,
          target,
          sourceId,
        });
        errors.push(error);
      }
    }
    return {
      result: {
        target,
        status: 'completed',
        found: sourceIds.length,
        requested: sourceIds.length - errors.length,
        failed: errors.length,
      },
      errors,
    };
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
