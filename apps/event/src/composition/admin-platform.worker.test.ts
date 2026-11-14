import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../db/client.ts';
import { admins } from '../../db/schema/admin/admins.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../lib/core/admin/ports.ts';
import { D1AdminDirectory } from '../../lib/workers/admin/d1-admin-directory.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const ADMIN_ID = '01JC0ADMN00000000000000801';
const DELETED_ADMIN_ID = '01JC0ADMN00000000000000802';
const T0 = new Date('2026-11-01T00:00:00.000Z');

const db = createDatabase(env.DB);

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
  await db.delete(admins);
});

describe('イベントサーバーの管理者の共通の束縛', () => {
  test('処理単位のコンテナから管理者の照会口をD1の実装に解決し、有効な管理者の表示用の情報だけを引ける', async () => {
    await db.insert(admins).values({
      id: ADMIN_ID,
      email: 'admin801@mail.example',
      passwordHash: 'pbkdf2-sha256$test',
      nickname: '管理者801',
      title: '運営',
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
    await expect(
      directory.findProfiles([ADMIN_ID, DELETED_ADMIN_ID]),
    ).resolves.toEqual(
      new Map([
        [
          ADMIN_ID,
          {
            id: ADMIN_ID,
            nickname: '管理者801',
            title: '運営',
            avatarFileId: null,
          },
        ],
      ]),
    );
  });
});
