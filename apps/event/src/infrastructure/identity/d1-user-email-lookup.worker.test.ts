import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  db,
  emailOf,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1UserEmailLookup } from './d1-user-email-lookup.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1UserEmailLookup', () => {
  test('退会済みの利用者のメールアドレスも返す', async () => {
    await insertUser(1, { deletedAt: after(1000) });
    await insertUser(2);

    const lookup = new D1UserEmailLookup(db);

    await expect(lookup.findEmail(userIdOf(1))).resolves.toBe(emailOf(1));
    await expect(lookup.findEmail(userIdOf(2))).resolves.toBe(emailOf(2));
  });

  test('利用者の行が無ければundefinedを返す', async () => {
    await expect(
      new D1UserEmailLookup(db).findEmail(userIdOf(9)),
    ).resolves.toBeUndefined();
  });

  test('D1の失敗はそのまま投げる', async () => {
    await expect(
      new D1UserEmailLookup(createFailingDatabase()).findEmail(userIdOf(1)),
    ).rejects.toThrow();
  });
});
