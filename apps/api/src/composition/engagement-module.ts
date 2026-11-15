import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  DirectoryEngagementTargetResolver,
  type EngagementTargetResolver,
} from '../application/engagement/engagement-target-resolver.ts';
import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';

// コメントと評価のストア・文の部品(ENGAGEMENT_PLATFORM_MODULE)とプロダクトの照会(PRODUCT_PLATFORM_MODULE)は各モジュールの束縛を使う
export const ENGAGEMENT_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'engagement',
  bindings: new ContainerModule(({ bind }) => {
    bind<EngagementTargetResolver>(
      ENGAGEMENT_TYPES.EngagementTargetResolver,
    ).to(DirectoryEngagementTargetResolver);
  }),
};
