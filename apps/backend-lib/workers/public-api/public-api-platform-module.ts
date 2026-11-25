import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PUBLIC_API_PLATFORM_TYPES } from '../../core/public-api/identifiers.ts';
import type { ApiKeyExport } from '../../core/public-api/ports.ts';
import { D1ApiKeyExport } from './d1-api-key-export.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const PUBLIC_API_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'public-api-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<ApiKeyExport>(PUBLIC_API_PLATFORM_TYPES.ApiKeyExport)
      .to(D1ApiKeyExport)
      .inSingletonScope();
  }),
};
