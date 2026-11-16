import { ContainerModule } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type { MatchDirectory, MatchScheduler } from '../../core/match/ports.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  BracketProgression,
  BracketStore,
} from '../../core/tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { D1BracketProgression } from './d1-bracket-progression.ts';
import { D1BracketStore } from './d1-bracket-store.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。進行はマッチの共通の束縛(match-platform)の照会と予定の作成を使い、アプリの名前は遅れのログのカテゴリの先頭になる
export function createTournamentPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'tournament-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
        .to(D1BracketStore)
        .inSingletonScope();
      bind<BracketProgression>(TOURNAMENT_PLATFORM_TYPES.BracketProgression)
        .toDynamicValue(
          (context) =>
            new D1BracketProgression(
              context.get<Database>(PLATFORM_TYPES.Database),
              context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
              context.get<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore),
              context.get<MatchDirectory>(MATCH_PLATFORM_TYPES.MatchDirectory),
              context.get<MatchScheduler>(MATCH_PLATFORM_TYPES.MatchScheduler),
              appName,
            ),
        )
        .inSingletonScope();
    }),
  };
}
