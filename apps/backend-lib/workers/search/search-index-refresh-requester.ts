import type { Logger } from '@logtape/logtape';
import { captureException, withScope } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from '../../core/messaging/contracts/search-index-refresh.ts';
import type {
  SearchIndexRefreshRequester,
  SearchTargetCatalog,
} from '../../core/search/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import { SearchTargetRegistryError } from './search-target-definition.ts';

export class QueueSearchIndexRefreshRequester implements SearchIndexRefreshRequester {
  private readonly logger: Logger;

  constructor(
    private readonly publisher: MessagePublisher,
    private readonly catalog: SearchTargetCatalog,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'search', 'refresh']);
  }

  async requestRefresh(target: string, sourceId: string): Promise<void> {
    if (this.catalog.find(target) === undefined) {
      throw new SearchTargetRegistryError(
        `検索対象${target}は登録されていません。`,
      );
    }
    try {
      await this.publisher.publish(SEARCH_INDEX_REFRESH_MESSAGE, {
        target,
        sourceId,
      });
    } catch (error) {
      // 契約に合わない本文などの送信前の検証の失敗は、日次の再抽出で要求し直しても同じ結果になる呼び出し側の誤りのため、記録で済ませずに伝える
      if (error instanceof MessagePublishError) {
        throw error;
      }
      // 送れなかった元データは更新待ちの印が残るため、日次の再抽出が更新を要求し直す
      this.logger.error('索引の更新の要求を送れませんでした', {
        error,
        target,
        sourceId,
      });
      withScope((scope) => {
        scope.setTag('search_target', target);
        captureException(error);
      });
    }
  }
}
