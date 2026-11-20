import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { MODERATION_PLATFORM_TYPES } from '../../core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../core/moderation/ports.ts';
import { D1ModerationRecordStore } from './d1-moderation-record-store.ts';
import type { ModerationRecordStatements } from './moderation-record-statements.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const MODERATION_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'moderation-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<ModerationRecordStore>(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
      .to(D1ModerationRecordStore)
      .inSingletonScope();
    bind<ModerationRecordStatements>(
      MODERATION_PLATFORM_TYPES.ModerationRecordStatements,
    )
      .to(D1ModerationRecordStore)
      .inSingletonScope();
  }),
};
