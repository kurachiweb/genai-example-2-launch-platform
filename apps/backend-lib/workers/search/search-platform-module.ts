import { ContainerModule } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../core/search/identifiers.ts';
import type {
  SearchIndexRefreshRequester,
  SearchIndexStore,
  SearchSourceProvider,
} from '../../core/search/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import { QueueSearchIndexRefreshRequester } from './search-index-refresh-requester.ts';
import { D1SearchIndexRepository } from './search-index-repository.ts';
import {
  createSearchIndexStatements,
  type SearchIndexStatements,
} from './search-index-statements.ts';
import { RegistrySearchSourceProvider } from './search-source-provider.ts';
import {
  createSearchTargetRegistry,
  type SearchTargetDefinition,
  type SearchTargetRegistry,
} from './search-target-definition.ts';

// 検索対象の登録の誤りを、最初の処理単位ではなくモジュールを作るisolateの起動時に検出する
export function createSearchPlatformModule(
  targets: readonly SearchTargetDefinition[],
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  const registry = createSearchTargetRegistry(targets);

  return {
    name: 'search-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<SearchTargetRegistry>(SEARCH_TYPES.TargetCatalog).toConstantValue(
        registry,
      );
      bind<SearchIndexStore>(SEARCH_TYPES.IndexStore)
        .to(D1SearchIndexRepository)
        .inSingletonScope();
      bind<SearchSourceProvider>(SEARCH_TYPES.SourceProvider)
        .to(RegistrySearchSourceProvider)
        .inSingletonScope();
      bind<SearchIndexRefreshRequester>(SEARCH_TYPES.RefreshRequester)
        .toDynamicValue(
          (context) =>
            new QueueSearchIndexRefreshRequester(
              context.get<MessagePublisher>(PLATFORM_TYPES.MessagePublisher),
              registry,
              appName,
            ),
        )
        .inSingletonScope();
      bind<SearchIndexStatements>(SEARCH_TYPES.IndexStatements)
        .toDynamicValue((context) =>
          createSearchIndexStatements(
            context.get<Database>(PLATFORM_TYPES.Database),
            registry,
          ),
        )
        .inSingletonScope();
    }),
  };
}
