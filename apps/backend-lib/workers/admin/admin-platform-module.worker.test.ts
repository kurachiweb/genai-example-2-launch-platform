import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { describe, expect, expectTypeOf, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import { ADMIN_PLATFORM_TYPES } from '../../core/admin/identifiers.ts';
import type { AdminDirectory } from '../../core/admin/ports.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { ADMIN_PLATFORM_MODULE } from './admin-platform-module.ts';
import { D1AdminDirectory } from './d1-admin-directory.ts';

const ADMIN_ID = '01JC0ADMN00000000000000901';
const T0 = new Date('2026-11-01T00:00:00.000Z');

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-admin-platform',
        clientIp: undefined,
      },
    },
    [ADMIN_PLATFORM_MODULE],
  );
}

describe('ADMIN_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      ADMIN_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(ADMIN_PLATFORM_MODULE.name).toBe('admin-platform');
    expect('routes' in ADMIN_PLATFORM_MODULE).toBe(false);
  });

  test('管理者の照会口をD1の実装に解決し、処理単位のD1から有効な管理者の表示用の情報を引ける', async () => {
    await createDatabase(env.DB).insert(admins).values({
      id: ADMIN_ID,
      email: 'admin901@mail.example',
      passwordHash: 'pbkdf2-sha256$test',
      nickname: '管理者901',
      role: 'moderator',
      status: 'active',
      activatedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });

    const directory = createContainer().get<AdminDirectory>(
      ADMIN_PLATFORM_TYPES.AdminDirectory,
    );

    expect(directory).toBeInstanceOf(D1AdminDirectory);
    await expect(directory.findProfiles([ADMIN_ID])).resolves.toEqual(
      new Map([
        [
          ADMIN_ID,
          {
            id: ADMIN_ID,
            nickname: '管理者901',
            title: null,
            avatarFileId: null,
          },
        ],
      ]),
    );
  });

  test('照会口は処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    expect(first.get(ADMIN_PLATFORM_TYPES.AdminDirectory)).toBe(
      first.get(ADMIN_PLATFORM_TYPES.AdminDirectory),
    );
    expect(second.get(ADMIN_PLATFORM_TYPES.AdminDirectory)).not.toBe(
      first.get(ADMIN_PLATFORM_TYPES.AdminDirectory),
    );
  });
});
