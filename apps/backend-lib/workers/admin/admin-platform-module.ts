import { ContainerModule } from 'inversify';

import { ADMIN_PLATFORM_TYPES } from '../../core/admin/identifiers.ts';
import type { AdminDirectory } from '../../core/admin/ports.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { D1AdminDirectory } from './d1-admin-directory.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const ADMIN_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'admin-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
      .to(D1AdminDirectory)
      .inSingletonScope();
  }),
};
