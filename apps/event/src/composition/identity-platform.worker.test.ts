import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type {
  AccountExport,
  AdminUserDirectory,
  UserContactDirectory,
} from '../../lib/core/identity/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1AccountExport } from '../../lib/workers/identity/d1-account-export.ts';
import { D1AdminUserDirectory } from '../../lib/workers/identity/d1-admin-user-directory.ts';
import { D1UserContactDirectory } from '../../lib/workers/identity/d1-user-contact-directory.ts';
import {
  after,
  clearIdentityTables,
  insertTotpCredential,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearIdentityTables();
});

describe('イベントサーバーのidentityの共通の束縛', () => {
  test('処理単位のコンテナから利用者の連絡先の照会をD1の実装に解決し、連絡先を引ける', async () => {
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

  test('処理単位のコンテナからデータエクスポートのアカウントの部分の照会をD1の実装に解決し、アカウントの部分と仮名化IDを引ける', async () => {
    await insertUser(1, { emailVerifiedAt: after(1000) });
    await insertTotpCredential(1, { enabledAt: after(2000) });

    const accountExport = createContainer().get<AccountExport>(
      IDENTITY_PLATFORM_TYPES.AccountExport,
    );

    expect(accountExport).toBeInstanceOf(D1AccountExport);
    await expect(accountExport.find(userIdOf(1))).resolves.toEqual({
      userId: userIdOf(1),
      pseudonymousId: 'pseudonymous-1',
      email: 'user1@mail.example',
      emailVerifiedAt: after(1000),
      registeredAt: T0,
      mfaEnabled: true,
    });
  });

  test('処理単位のコンテナから管理画面の利用者の照会をD1の実装に解決し、利用者の検索・引き当て・登録者数の数え上げができる', async () => {
    await insertUser(1, { createdAt: after(1000) });
    await insertUser(2, { createdAt: after(3000), deletedAt: after(4000) });

    const directory = createContainer().get<AdminUserDirectory>(
      IDENTITY_PLATFORM_TYPES.AdminUserDirectory,
    );

    expect(directory).toBeInstanceOf(D1AdminUserDirectory);
    await expect(directory.search({}, { limit: 50 })).resolves.toMatchObject({
      users: [{ userId: userIdOf(1), registeredAt: after(1000) }],
      nextCursor: null,
    });
    await expect(
      directory.findByIds([userIdOf(1), userIdOf(2)]),
    ).resolves.toHaveProperty('size', 1);
    await expect(
      directory.findByEmail('USER1@mail.example'),
    ).resolves.toMatchObject({ userId: userIdOf(1) });
    await expect(directory.countRegisteredAt(after(3500))).resolves.toBe(2);
  });
});
