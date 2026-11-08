import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type { HandleAvailability } from '../application/identity/ports.ts';
import {
  type HandleAvailabilityChecker,
  StoreHandleAvailabilityChecker,
} from '../application/profile/handle-availability-checker.ts';
import {
  type MyProfileReader,
  StoreMyProfileReader,
} from '../application/profile/my-profile-reader.ts';
import type { ProfileStore } from '../application/profile/ports.ts';
import {
  type ProfileEditor,
  StoreProfileEditor,
} from '../application/profile/profile-editor.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import { UserHandleAvailability } from '../application/profile/user-handle-availability.ts';
import { D1ProfileStore } from '../infrastructure/profile/d1-profile-store.ts';

// ファイル(MEDIA_TYPES)と時計(PLATFORM_TYPES)は各機能の共通の束縛を使う
export const PROFILE_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'profile',
  bindings: new ContainerModule(({ bind }) => {
    bind<ProfileStore>(PROFILE_TYPES.ProfileStore).to(D1ProfileStore);
    bind<ProfileEditor>(PROFILE_TYPES.ProfileEditor).to(StoreProfileEditor);
    bind<MyProfileReader>(PROFILE_TYPES.MyProfileReader).to(
      StoreMyProfileReader,
    );
    bind<HandleAvailabilityChecker>(PROFILE_TYPES.HandleAvailabilityChecker).to(
      StoreHandleAvailabilityChecker,
    );
    bind<HandleAvailability>(PROFILE_TYPES.UserHandleAvailability).to(
      UserHandleAvailability,
    );
  }),
};
