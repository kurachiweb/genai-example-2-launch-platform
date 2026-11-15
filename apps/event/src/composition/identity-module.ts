import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  SuppressionMaintenance,
  UserAddressDirectory,
} from '../../lib/core/email/ports.ts';
import type { DisposableEmailChecker } from '../../lib/core/identity/disposable-email.ts';
import type { UserLifecycleStore } from '../../lib/core/identity/ports.ts';
import {
  createAsyncLifecycleRegistry,
  type UserLifecycleAsyncHandler,
  type UserLifecycleAsyncRegistration,
} from '../../lib/core/identity/user-lifecycle.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type {
  RecheckDisposableEmailBody,
  RunUserLifecycleBody,
} from '../../lib/core/messaging/contracts/identity.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createCleanupCursorRepository } from '../../lib/workers/email/cleanup-cursor-repository.ts';
import { createSendRecordRepository } from '../../lib/workers/email/send-record-repository.ts';
import { createSuppressionMaintenance } from '../../lib/workers/email/suppression-maintenance.ts';
import { createSuppressionRepository } from '../../lib/workers/email/suppression-repository.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createDisifyClient } from '../../lib/workers/identity/disify-client.ts';
import { D1UserAddressDirectory } from '../../lib/workers/identity/d1-user-address-directory.ts';
import { createUserLifecycleStore } from '../../lib/workers/identity/d1-user-lifecycle-store.ts';
import { DisposableEmailRecheckHandler } from '../application/identity/disposable-email-recheck-handler.ts';
import { EmailSuppressionCleanupHandler } from '../application/identity/email-suppression-cleanup-handler.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import type {
  DisposableStatusStore,
  IdentityPurgeStore,
  UserEmailLookup,
} from '../application/identity/ports.ts';
import { UserLifecycleRunner } from '../application/identity/user-lifecycle-runner.ts';
import { D1DisposableStatusStore } from '../infrastructure/identity/d1-disposable-status-store.ts';
import { D1IdentityPurgeStore } from '../infrastructure/identity/d1-identity-purge-store.ts';
import { D1UserEmailLookup } from '../infrastructure/identity/d1-user-email-lookup.ts';
import type { EventEnv, EventPlatformEnv } from './env-schema.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export interface EventIdentityModuleOptions {
  readonly asyncHandlers: readonly UserLifecycleAsyncRegistration[];
}

// 使い捨てメールアドレスの判定の運営者が、呼び出し元を識別できるようにする
const EXTERNAL_USER_AGENT = 'genai-example-2-event';

export function createEventIdentityModule(
  options: EventIdentityModuleOptions,
): EventAppModule {
  // 名前・順序の重複などの登録の誤りを、最初のメッセージではなくisolateの起動時に検出する
  const registry = createAsyncLifecycleRegistry(options.asyncHandlers);
  return {
    name: 'event-identity',
    bindings: new ContainerModule(({ bind }) => {
      bind<UserLifecycleStore>(EVENT_IDENTITY_TYPES.UserLifecycleStore)
        .toDynamicValue((context) =>
          createUserLifecycleStore(
            context.get<Database>(PLATFORM_TYPES.Database),
            context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
          ),
        )
        .inSingletonScope();
      bind<IdentityPurgeStore>(EVENT_IDENTITY_TYPES.IdentityPurgeStore).to(
        D1IdentityPurgeStore,
      );
      bind<UserEmailLookup>(EVENT_IDENTITY_TYPES.UserEmailLookup).to(
        D1UserEmailLookup,
      );
      bind<DisposableStatusStore>(
        EVENT_IDENTITY_TYPES.DisposableStatusStore,
      ).to(D1DisposableStatusStore);
      bind<DisposableEmailChecker>(EVENT_IDENTITY_TYPES.DisposableEmailChecker)
        .toDynamicValue((context) =>
          createDisifyClient({
            appName: 'event',
            // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、呼び出し時に大域のfetchを引く
            fetch: (input, init) => fetch(input, init),
            apiKey: context.get<EventPlatformEnv>(PLATFORM_TYPES.Env)
              .DISIFY_API_KEY,
            userAgent: EXTERNAL_USER_AGENT,
          }),
        )
        .inSingletonScope();
      bind<UserAddressDirectory>(EMAIL_TYPES.UserAddressDirectory).to(
        D1UserAddressDirectory,
      );
      // 退会の波及処理はdeleteByAddressだけを使い、日次の後始末(runDailyCleanup)はAPIサーバーのジョブが行う
      bind<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance)
        .toDynamicValue((context) => {
          const db = context.get<Database>(PLATFORM_TYPES.Database);
          return createSuppressionMaintenance(
            createSuppressionRepository(
              db,
              context.get<Clock>(PLATFORM_TYPES.Clock),
            ),
            createSendRecordRepository(db),
            context.get<UserAddressDirectory>(EMAIL_TYPES.UserAddressDirectory),
            createCleanupCursorRepository(db),
          );
        })
        .inSingletonScope();
      bind<UserLifecycleAsyncHandler>(
        EVENT_IDENTITY_TYPES.EmailSuppressionCleanupHandler,
      ).to(EmailSuppressionCleanupHandler);
      bind<MessageHandler<RunUserLifecycleBody>>(
        EVENT_IDENTITY_TYPES.UserLifecycleRunner,
      ).toDynamicValue(
        (context) =>
          new UserLifecycleRunner({
            store: context.get<UserLifecycleStore>(
              EVENT_IDENTITY_TYPES.UserLifecycleStore,
            ),
            registry,
            resolver: {
              resolve: (registration) =>
                context.get<UserLifecycleAsyncHandler>(registration.handler),
            },
            purgeStore: context.get<IdentityPurgeStore>(
              EVENT_IDENTITY_TYPES.IdentityPurgeStore,
            ),
            clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          }),
      );
      bind<MessageHandler<RecheckDisposableEmailBody>>(
        EVENT_IDENTITY_TYPES.DisposableEmailRecheckHandler,
      ).to(DisposableEmailRecheckHandler);
    }),
  };
}

export const EVENT_IDENTITY_MODULE: EventAppModule = createEventIdentityModule({
  asyncHandlers: USER_LIFECYCLE_ASYNC_HANDLERS,
});
