import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { UpvoteStore } from '../application/match/ports.ts';
import {
  StoreUpvoteService,
  type UpvoteService,
} from '../application/match/upvote-service.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { AccountMatchClosureSyncHandler } from '../infrastructure/match/account-match-closure-sync-handler.ts';
import { D1UpvoteStore } from '../infrastructure/match/d1-upvote-store.ts';

export const API_MATCH_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createMatchPlatformModule('api');

// データベースとID生成(PLATFORM_TYPES)は基盤の束縛を使う
export const API_MATCH_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-match',
  bindings: new ContainerModule(({ bind }) => {
    bind<UpvoteStore>(MATCH_TYPES.UpvoteStore).to(D1UpvoteStore);
    bind<UpvoteService>(MATCH_TYPES.UpvoteService).to(StoreUpvoteService);
    bind<UserLifecycleSyncHandler>(
      MATCH_TYPES.AccountMatchClosureSyncHandler,
    ).to(AccountMatchClosureSyncHandler);
  }),
};
