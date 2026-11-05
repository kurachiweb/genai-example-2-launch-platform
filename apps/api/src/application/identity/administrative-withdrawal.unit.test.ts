import { describe, expect, test } from 'bun:test';

import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/identity.ts';
import type {
  AuthenticatedPrincipal,
  Principal,
} from '../../../lib/core/session/session-view.ts';
import {
  type AdministrativeWithdrawal,
  type AdministrativeWithdrawalCommand,
  StoreAdministrativeWithdrawal,
} from './administrative-withdrawal.ts';
import {
  caught,
  NOW,
  OTHER_USER_ID,
  shapeOf,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';
import {
  createUserLifecycleFakes,
  EVENT_ID,
  type UserLifecycleFakeOptions,
} from './testing/user-lifecycle-fakes.ts';

function setup(options: UserLifecycleFakeOptions = {}) {
  const fakes = createUserLifecycleFakes(options);
  const withdrawal: AdministrativeWithdrawal =
    new StoreAdministrativeWithdrawal(
      fakes.users,
      fakes.committer,
      fakes.publisher,
      fakes.reporter,
    );
  return { withdrawal, recorded: fakes.recorded };
}

const ADMIN_OPERATOR: AuthenticatedPrincipal = {
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: '01JADMIN000000000000000001',
  sessionId: '01JADMINSESSION00000000001',
};

const commandOf = (
  overrides: Partial<AdministrativeWithdrawalCommand> = {},
): AdministrativeWithdrawalCommand => ({
  userId: USER_ID,
  caller: 'admin',
  operator: ADMIN_OPERATOR,
  at: NOW,
  ...overrides,
});

const FORBIDDEN = {
  kind: 'forbidden',
  code: 'forbidden',
  message: 'この操作はできません。',
} as const;

const NOT_FOUND = {
  kind: 'not_found',
  code: 'not_found',
  message: '対象が見つかりません。',
} as const;

const NOT_ADMIN_REQUESTS: readonly (readonly [
  string,
  Partial<AdministrativeWithdrawalCommand>,
])[] = [
  ['呼び出し元が利用者側', { caller: 'client' }],
  ['呼び出し元が不明な文字列', { caller: 'Admin' }],
  [
    '主体が利用者のセッション',
    {
      operator: {
        ...ADMIN_OPERATOR,
        subjectKind: 'user',
        subjectId: OTHER_USER_ID,
      },
    },
  ],
  ['主体が未ログイン', { operator: { kind: 'anonymous' } satisfies Principal }],
  [
    '利用者側の呼び出し元と利用者のセッション',
    {
      caller: 'client',
      operator: { ...ADMIN_OPERATOR, subjectKind: 'user', subjectId: USER_ID },
    },
  ],
];

describe('StoreAdministrativeWithdrawal.withdraw', () => {
  test('管理者側の呼び出し元と管理者のセッションなら、本人確認とbot判定なしで対象の版により退会を確定し、非同期の波及処理の実行を送る', async () => {
    const { withdrawal, recorded } = setup({
      user: userOf({ lifecycleVersion: 4 }),
    });

    await withdrawal.withdraw(commandOf());

    expect(recorded.calls).toEqual([
      'users.findById',
      'committer.commit',
      'publisher.publish',
    ]);
    expect(recorded.lookups).toEqual([USER_ID]);
    expect(recorded.transitions).toEqual([
      { kind: 'withdraw', userId: USER_ID, expectedVersion: 4, at: NOW },
    ]);
    expect(recorded.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: EVENT_ID },
        options: undefined,
      },
    ]);
    expect(recorded.reAuthentications).toEqual([]);
  });

  test('停止中の利用者も退会させる', async () => {
    const { withdrawal, recorded } = setup({
      user: userOf({ status: 'suspended', lifecycleVersion: 1 }),
    });

    await withdrawal.withdraw(commandOf());

    expect(recorded.transitions).toEqual([
      { kind: 'withdraw', userId: USER_ID, expectedVersion: 1, at: NOW },
    ]);
  });

  test.each(NOT_ADMIN_REQUESTS)(
    '%sの要求は403のforbiddenで拒否し、利用者を読まず状態を変えない',
    async (_label, overrides) => {
      const { withdrawal, recorded } = setup();

      const error = await caught(withdrawal.withdraw(commandOf(overrides)));

      expect(shapeOf(error)).toEqual(FORBIDDEN);
      expect(recorded.calls).toEqual([]);
    },
  );

  test.each([
    ['存在しない', OTHER_USER_ID, undefined],
    [
      '退会済み',
      USER_ID,
      userOf({ deletedAt: new Date('2026-11-01T00:00:00.000Z') }),
    ],
    [
      '停止中のまま退会済み',
      USER_ID,
      userOf({
        status: 'suspended',
        deletedAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ],
  ] as const)(
    '対象が%sなら404のnot_foundで拒否し、状態を変えない',
    async (_label, userId, user) => {
      const { withdrawal, recorded } = setup({ user });

      const error = await caught(withdrawal.withdraw(commandOf({ userId })));

      expect(shapeOf(error)).toEqual(NOT_FOUND);
      expect(recorded.calls).toEqual(['users.findById']);
    },
  );

  test('送信に失敗しても本人の退会と同じく成功として返し、運用者へ通知する', async () => {
    const { withdrawal, recorded } = setup({
      publishError: new Error('Queueへの送信に失敗した'),
    });

    await withdrawal.withdraw(commandOf());

    expect(recorded.incidents).toEqual([
      { kind: 'lifecycle-publish-failed', eventId: EVENT_ID },
    ]);
  });
});
