import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createSearchPlatformModule } from '../../lib/workers/search/search-platform-module.ts';
import { SEARCH_TARGETS } from '../../lib/workers/search/targets/index.ts';
import { SearchKeywordReextractionJob } from '../application/search/search-keyword-reextraction-job.ts';

export const API_SEARCH_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createSearchPlatformModule(SEARCH_TARGETS, 'api');

export const API_SEARCH_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-search',
  bindings: new ContainerModule(({ bind }) => {
    bind<ScheduledJobHandler>(SEARCH_TYPES.ReextractionJob).to(
      SearchKeywordReextractionJob,
    );
  }),
};
