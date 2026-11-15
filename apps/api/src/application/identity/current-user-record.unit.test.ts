import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { loadCurrentUserRecord } from './current-user-record.ts';
import type { UserAccountStore, UserRecord } from './ports.ts';
import {
  currentOf,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';

function storeOf(stored: UserRecord | undefined) {
  const reads: string[] = [];
  const users: Pick<UserAccountStore, 'findById'> = {
    findById(userId) {
      reads.push(userId);
      return Promise.resolve(stored?.id === userId ? stored : undefined);
    },
  };
  return { users, reads };
}

const viewOf = (user: UserRecord): CurrentUser => {
  const { principal } = currentOf(user);
  return {
    principal,
    user: {
      id: user.id,
      pseudonymousId: user.pseudonymousId,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      deletedAt: user.deletedAt,
      email: user.email,
      nickname: user.nickname,
      handle: user.handle,
    },
  };
};

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('loadCurrentUserRecord', () => {
  test('ログイン中の利用者を保存済みの記録として読み直し、パスワードのハッシュと版を返す', async () => {
    const stored = userOf({ lifecycleVersion: 3 });
    const { users, reads } = storeOf(stored);

    const record = await loadCurrentUserRecord(users, viewOf(stored));

    expect(record).toBe(stored);
    expect(record.passwordHash).toBe(stored.passwordHash);
    expect(record.lifecycleVersion).toBe(3);
    expect(reads).toEqual([USER_ID]);
  });

  test('停止中でも読み直せる', async () => {
    const stored = userOf({ status: 'suspended' });
    const { users } = storeOf(stored);

    expect(await loadCurrentUserRecord(users, viewOf(stored))).toBe(stored);
  });

  test.each([
    ['読み直す間に消えた', undefined],
    [
      '読み直す間に退会した',
      userOf({ deletedAt: new Date('2026-11-01T00:00:00.000Z') }),
    ],
  ])('%s利用者は未ログインとして拒む', async (_label, stored) => {
    const { users } = storeOf(stored);

    const error = await catchError(
      loadCurrentUserRecord(users, viewOf(userOf())),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'unauthenticated',
      code: 'unauthenticated',
    });
  });
});
