import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EVENT_PROFILE_TYPES } from '../application/profile/event-profile-types.ts';
import { OwnedFileErasureHandler } from '../application/profile/owned-file-erasure-handler.ts';
import { OwnedImageQuarantineHandler } from '../application/profile/owned-image-quarantine-handler.ts';
import type { ProfilePurgeStore } from '../application/profile/ports.ts';
import { ProfileErasureHandler } from '../application/profile/profile-erasure-handler.ts';
import { D1ProfilePurgeStore } from '../infrastructure/profile/d1-profile-purge-store.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(PROFILE_PLATFORM_MODULE・EVENT_MEDIA_PLATFORM_MODULE)が登録されている前提で、物理削除と停止・停止解除の波及処理を束縛する
export const EVENT_PROFILE_MODULE: AppModule<Hono<PlatformHonoEnv<EventEnv>>> =
  {
    name: 'event-profile',
    bindings: new ContainerModule(({ bind }) => {
      bind<ProfilePurgeStore>(EVENT_PROFILE_TYPES.ProfilePurgeStore).to(
        D1ProfilePurgeStore,
      );
      bind<UserLifecycleAsyncHandler>(
        EVENT_PROFILE_TYPES.ProfileErasureHandler,
      ).to(ProfileErasureHandler);
      bind<UserLifecycleAsyncHandler>(
        EVENT_PROFILE_TYPES.OwnedFileErasureHandler,
      ).to(OwnedFileErasureHandler);
      bind<UserLifecycleAsyncHandler>(
        EVENT_PROFILE_TYPES.OwnedImageQuarantineHandler,
      ).to(OwnedImageQuarantineHandler);
    }),
  };
