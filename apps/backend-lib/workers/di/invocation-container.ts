import { Container } from 'inversify';

import { createDatabase, type Database } from '../../../db/client.ts';
import {
  createKeyedHasher,
  type KeyedHasher,
} from '../../core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import {
  type InvocationScopeInfo,
  PLATFORM_TYPES,
} from '../../core/di/identifiers.ts';
import {
  createUlidGenerator,
  type IdGenerator,
} from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import { type Clock, systemClock } from '../../core/time/clock.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import {
  createMessagePublisher,
  type MessagePublisher,
} from '../messaging/queue-publisher.ts';

export interface InvocationScope<E extends PlatformEnv> {
  readonly env: E;
  readonly executionCtx: ExecutionContext;
  readonly info: InvocationScopeInfo;
}

function bindPlatform<E extends PlatformEnv>(
  container: Container,
  scope: InvocationScope<E>,
): void {
  const { env } = scope;
  container.bind<E>(PLATFORM_TYPES.Env).toConstantValue(env);
  container
    .bind<InvocationScope<E>>(PLATFORM_TYPES.InvocationScope)
    .toConstantValue(scope);
  container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(systemClock);
  container
    .bind<Database>(PLATFORM_TYPES.Database)
    .toDynamicValue(() => createDatabase(env.DB))
    .inSingletonScope();
  container
    .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
    .toDynamicValue((context) =>
      createUlidGenerator(context.get<Clock>(PLATFORM_TYPES.Clock)),
    )
    .inSingletonScope();
  container
    .bind<KeyedHasher>(PLATFORM_TYPES.KeyedHasher)
    .toDynamicValue(() => createKeyedHasher(env.HASH_PEPPER))
    .inSingletonScope();
  container
    .bind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher)
    .toDynamicValue((context) =>
      createMessagePublisher(
        env.JOBS_QUEUE,
        MESSAGE_CONTRACTS,
        context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
        context.get<Clock>(PLATFORM_TYPES.Clock),
      ),
    )
    .inSingletonScope();
}

// 環境を指定したAppModuleは既定のAppModuleへ代入できないため、コンテナに必要なbindingsだけを受け取る
export function createInvocationContainer<E extends PlatformEnv>(
  scope: InvocationScope<E>,
  modules: readonly Pick<AppModule, 'bindings'>[],
): Container {
  // jitlessは既定のtrueのまま使う。workerdは実行時のコード生成を禁止する
  const container = new Container({ defaultScope: 'Transient' });
  bindPlatform(container, scope);
  for (const { bindings } of modules) {
    if (bindings !== undefined) {
      container.load(bindings);
    }
  }
  return container;
}
