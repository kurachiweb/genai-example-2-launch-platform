import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../lib/core/identity/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1UserContactDirectory } from '../../lib/workers/identity/d1-user-contact-directory.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { MODULES } from './modules.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('APIサーバーのidentityの共通の束縛', () => {
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
});
