import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { SearchIndexRefreshBody } from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import type { KeywordExtractor } from '../../lib/core/search/ports.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createSearchPlatformModule } from '../../lib/workers/search/search-platform-module.ts';
import { SEARCH_TARGETS } from '../../lib/workers/search/targets/index.ts';
import type { SearchIncidentReporter } from '../application/search/ports.ts';
import { SearchIndexRefreshHandler } from '../application/search/search-index-refresh-handler.ts';
import { EVENT_SEARCH_TYPES } from '../application/search/search-types.ts';
import { createKeywordExtractor } from '../infrastructure/search/create-keyword-extractor.ts';
import { SentrySearchIncidentReporter } from '../infrastructure/search/sentry-search-incident-reporter.ts';
import type { EventEnv } from './env-schema.ts';

export const EVENT_SEARCH_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = createSearchPlatformModule(SEARCH_TARGETS, 'event');

export const EVENT_SEARCH_MODULE: AppModule<Hono<PlatformHonoEnv<EventEnv>>> = {
  name: 'event-search',
  bindings: new ContainerModule(({ bind }) => {
    bind<KeywordExtractor>(SEARCH_TYPES.KeywordExtractor)
      .toDynamicValue((context) =>
        createKeywordExtractor(
          context.get<EventEnv>(PLATFORM_TYPES.Env),
          fetch,
        ),
      )
      .inSingletonScope();
    bind<SearchIncidentReporter>(EVENT_SEARCH_TYPES.SearchIncidentReporter).to(
      SentrySearchIncidentReporter,
    );
    bind<MessageHandler<SearchIndexRefreshBody>>(
      SEARCH_TYPES.RefreshHandler,
    ).to(SearchIndexRefreshHandler);
  }),
};
