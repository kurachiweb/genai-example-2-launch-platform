import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchEventDispatcher,
  MatchEventStore,
  MatchExport,
  MatchScheduler,
  SupporterDirectory,
  UpvoteExport,
} from '../../core/match/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import {
  D1MatchDirectory,
  D1SupporterDirectory,
} from './d1-match-directory.ts';
import { D1MatchEventStore } from './d1-match-event-store.ts';
import { D1MatchExport, D1UpvoteExport } from './d1-match-export.ts';
import { D1MatchScheduler } from './d1-match-scheduler.ts';
import { QueueMatchEventDispatcher } from './queue-match-event-dispatcher.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。アプリの名前はイベントの送信の失敗のログのカテゴリの先頭になる
export function createMatchPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'match-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<MatchDirectory>(MATCH_PLATFORM_TYPES.MatchDirectory)
        .to(D1MatchDirectory)
        .inSingletonScope();
      bind<SupporterDirectory>(MATCH_PLATFORM_TYPES.SupporterDirectory)
        .to(D1SupporterDirectory)
        .inSingletonScope();
      bind<MatchScheduler>(MATCH_PLATFORM_TYPES.MatchScheduler)
        .to(D1MatchScheduler)
        .inSingletonScope();
      bind<MatchEventStore>(MATCH_PLATFORM_TYPES.MatchEventStore)
        .to(D1MatchEventStore)
        .inSingletonScope();
      bind<MatchEventDispatcher>(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
        .toDynamicValue(
          (context) =>
            new QueueMatchEventDispatcher(
              context.get<MessagePublisher>(PLATFORM_TYPES.MessagePublisher),
              appName,
            ),
        )
        .inSingletonScope();
      bind<MatchExport>(MATCH_PLATFORM_TYPES.MatchExport)
        .to(D1MatchExport)
        .inSingletonScope();
      bind<UpvoteExport>(MATCH_PLATFORM_TYPES.UpvoteExport)
        .to(D1UpvoteExport)
        .inSingletonScope();
    }),
  };
}
