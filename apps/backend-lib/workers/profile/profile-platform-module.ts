import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PROFILE_PLATFORM_TYPES } from '../../core/profile/identifiers.ts';
import type {
  FollowerDirectory,
  FollowExport,
  ProfileExport,
  UserProfileDirectory,
} from '../../core/profile/ports.ts';
import { D1FollowDirectory } from './d1-follow-directory.ts';
import { D1ProfileExport } from './d1-profile-export.ts';
import { D1UserProfileDirectory } from './d1-user-profile-directory.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const PROFILE_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'profile-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserProfileDirectory>(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
      .to(D1UserProfileDirectory)
      .inSingletonScope();
    bind<ProfileExport>(PROFILE_PLATFORM_TYPES.ProfileExport)
      .to(D1ProfileExport)
      .inSingletonScope();
    bind<FollowExport>(PROFILE_PLATFORM_TYPES.FollowExport)
      .to(D1FollowDirectory)
      .inSingletonScope();
    bind<FollowerDirectory>(PROFILE_PLATFORM_TYPES.FollowerDirectory)
      .to(D1FollowDirectory)
      .inSingletonScope();
  }),
};
