import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type { HandleAvailability } from '../application/identity/ports.ts';
import type { InquirerProfiles } from '../application/inquiry/ports.ts';
import {
  type HandleAvailabilityChecker,
  StoreHandleAvailabilityChecker,
} from '../application/profile/handle-availability-checker.ts';
import {
  type MyProfileReader,
  StoreMyProfileReader,
} from '../application/profile/my-profile-reader.ts';
import {
  type FollowListReader,
  StoreFollowListReader,
} from '../application/profile/follow-list-reader.ts';
import {
  type FollowService,
  StoreFollowService,
} from '../application/profile/follow-service.ts';
import type {
  FollowStore,
  ProfileStore,
  PublicProfileStore,
} from '../application/profile/ports.ts';
import {
  type ProfileEditor,
  StoreProfileEditor,
} from '../application/profile/profile-editor.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import {
  DefaultPublicProfileReader,
  type PublicProfileReader,
} from '../application/profile/public-profile-reader.ts';
import { UserHandleAvailability } from '../application/profile/user-handle-availability.ts';
import { D1FollowStore } from '../infrastructure/profile/d1-follow-store.ts';
import { D1ProfileStore } from '../infrastructure/profile/d1-profile-store.ts';
import { ProfileInquirerProfiles } from '../infrastructure/profile/profile-inquirer-profiles.ts';
import { D1PublicProfileStore } from '../infrastructure/profile/d1-public-profile-store.ts';

// ファイル(MEDIA_TYPES)・時計とID生成(PLATFORM_TYPES)・閲覧者の確認(IDENTITY_PLATFORM_TYPES)・ハンドルの解決(PROFILE_PLATFORM_TYPES)・Ultrasの判定(ULTRAS_TYPES)は各機能の共通の束縛を使う
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
    bind<PublicProfileStore>(PROFILE_TYPES.PublicProfileStore).to(
      D1PublicProfileStore,
    );
    bind<PublicProfileReader>(PROFILE_TYPES.PublicProfileReader).to(
      DefaultPublicProfileReader,
    );
    bind<InquirerProfiles>(PROFILE_TYPES.ProfileInquirerProfiles).to(
      ProfileInquirerProfiles,
    );
    bind<FollowStore>(PROFILE_TYPES.FollowStore).to(D1FollowStore);
    bind<FollowService>(PROFILE_TYPES.FollowService).to(StoreFollowService);
    bind<FollowListReader>(PROFILE_TYPES.FollowListReader).to(
      StoreFollowListReader,
    );
  }),
};
