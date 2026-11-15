import { describe, expect, expectTypeOf, test } from 'bun:test';

import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { users } from '../../../db/schema/identity/users.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import {
  AUTH_TOKEN_PURPOSES,
  type AuthTokenPurpose,
} from '../../domain/identity/auth-token-purpose.ts';
import type { AccountStatus } from '../../domain/identity/user-account.ts';

// domainはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とdomainの型の一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('利用者のテーブル定義の値の一覧', () => {
  test('トークンの用途の列の値がdomainのトークンの用途の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof userAuthTokens.purpose.enumValues)[number]
    >().toEqualTypeOf<AuthTokenPurpose>();
    expect([...userAuthTokens.purpose.enumValues]).toEqual([
      ...AUTH_TOKEN_PURPOSES,
    ]);
  });

  test('利用者の状態の列の値がdomainの利用者の状態の型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof users.status.enumValues)[number]
    >().toEqualTypeOf<AccountStatus>();
    expect([...users.status.enumValues].toSorted()).toEqual([
      'active',
      'suspended',
    ]);
  });

  test('使い捨て判定の列の値が共通ライブラリの判定の状態の型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof users.disposableEmailStatus.enumValues)[number]
    >().toEqualTypeOf<DisposableEmailStatus>();
    expect([...users.disposableEmailStatus.enumValues].toSorted()).toEqual([
      'disposable',
      'regular',
      'undetermined',
    ]);
  });
});
