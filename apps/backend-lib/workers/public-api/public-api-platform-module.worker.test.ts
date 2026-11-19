import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import { PUBLIC_API_PLATFORM_TYPES } from '../../core/public-api/identifiers.ts';
import type { ApiKeyExport } from '../../core/public-api/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import {
  after,
  insertUser,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1ApiKeyExport } from './d1-api-key-export.ts';
import { PUBLIC_API_PLATFORM_MODULE } from './public-api-platform-module.ts';
import { clearApiKeyTables, insertApiKey } from './testing/api-key-fixtures.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-public-api-platform',
        clientIp: undefined,
      },
    },
    [PUBLIC_API_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await clearApiKeyTables();
});

describe('PUBLIC_API_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      PUBLIC_API_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(PUBLIC_API_PLATFORM_MODULE.name).toBe('public-api-platform');
    expect('routes' in PUBLIC_API_PLATFORM_MODULE).toBe(false);
  });

  test('データエクスポートのAPIキーの照会をD1の実装に解決し、処理単位のD1から利用者のキーを引ける', async () => {
    await insertUser(1);
    await insertApiKey(1, 1, { name: '連携用', createdAt: after(1000) });

    const apiKeyExport = createContainer().get<ApiKeyExport>(
      PUBLIC_API_PLATFORM_TYPES.ApiKeyExport,
    );

    expect(apiKeyExport).toBeInstanceOf(D1ApiKeyExport);
    await expect(apiKeyExport.listByUser(userIdOf(1))).resolves.toMatchObject([
      { name: '連携用', createdAt: after(1000) },
    ]);
  });

  test('ApiKeyExportは処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();
    const identifier = PUBLIC_API_PLATFORM_TYPES.ApiKeyExport;

    expect(first.get(identifier)).toBe(first.get(identifier));
    expect(second.get(identifier)).not.toBe(first.get(identifier));
  });
});
