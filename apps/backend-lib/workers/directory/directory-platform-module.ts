import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../core/directory/identifiers.ts';
import type {
  DirectoryEntryStore,
  DirectoryListingQuery,
} from '../../core/directory/ports.ts';
import { D1DirectoryEntryStore } from './d1-directory-entry-store.ts';
import { D1DirectoryListing } from './d1-directory-listing.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const DIRECTORY_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'directory-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<DirectoryListingQuery>(DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery)
      .to(D1DirectoryListing)
      .inSingletonScope();
    bind<DirectoryEntryStore>(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
      .to(D1DirectoryEntryStore)
      .inSingletonScope();
  }),
};
