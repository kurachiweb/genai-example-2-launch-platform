import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { D1UserContactDirectory } from './d1-user-contact-directory.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const IDENTITY_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'identity-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserContactDirectory>(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
      .to(D1UserContactDirectory)
      .inSingletonScope();
  }),
};
