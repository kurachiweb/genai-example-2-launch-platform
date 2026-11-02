import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1UserContactDirectory } from './d1-user-contact-directory.ts';
import { IDENTITY_PLATFORM_MODULE } from './identity-platform-module.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from './testing/identity-store-fixtures.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-identity-platform',
        clientIp: undefined,
      },
    },
    [IDENTITY_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('IDENTITY_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      IDENTITY_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(IDENTITY_PLATFORM_MODULE.name).toBe('identity-platform');
    expect('routes' in IDENTITY_PLATFORM_MODULE).toBe(false);
  });

  test('連絡先の照会をD1の実装に解決し、処理単位のD1から利用者の連絡先を引ける', async () => {
    await insertUser(1);

    const directory = createContainer().get<UserContactDirectory>(
      IDENTITY_PLATFORM_TYPES.UserContactDirectory,
    );

    expect(directory).toBeInstanceOf(D1UserContactDirectory);
    await expect(directory.findContact(userIdOf(1))).resolves.toEqual({
      userId: userIdOf(1),
      email: 'user1@mail.example',
      nickname: '利用者1',
      emailVerified: false,
    });
  });

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();
    const identifier = IDENTITY_PLATFORM_TYPES.UserContactDirectory;

    expect(first.get(identifier)).toBe(first.get(identifier));
    expect(second.get(identifier)).not.toBe(first.get(identifier));
  });
});
