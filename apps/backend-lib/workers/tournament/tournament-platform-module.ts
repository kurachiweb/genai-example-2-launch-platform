import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type { BracketStore } from '../../core/tournament/ports.ts';
import { D1BracketStore } from './d1-bracket-store.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const TOURNAMENT_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'tournament-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
      .to(D1BracketStore)
      .inSingletonScope();
  }),
};
