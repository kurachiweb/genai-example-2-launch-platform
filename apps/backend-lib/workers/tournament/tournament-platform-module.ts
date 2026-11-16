import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  BracketProgression,
  BracketStore,
} from '../../core/tournament/ports.ts';
import { D1BracketProgression } from './d1-bracket-progression.ts';
import { D1BracketStore } from './d1-bracket-store.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。進行はマッチの共通の束縛(match-platform)の照会と予定の作成を使う
export const TOURNAMENT_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'tournament-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
      .to(D1BracketStore)
      .inSingletonScope();
    bind<BracketProgression>(TOURNAMENT_PLATFORM_TYPES.BracketProgression)
      .to(D1BracketProgression)
      .inSingletonScope();
  }),
};
