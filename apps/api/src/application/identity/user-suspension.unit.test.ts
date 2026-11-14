import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/identity.ts';
import {
  caught,
  NOW,
  OTHER_USER_ID,
  rejectionOf,
  shapeOf,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';
import {
  createUserLifecycleFakes,
  EVENT_ID,
  type UserLifecycleFakeOptions,
} from './testing/user-lifecycle-fakes.ts';
import { StoreUserSuspension, type UserSuspension } from './user-suspension.ts';

function setup(options: UserLifecycleFakeOptions = {}) {
  const fakes = createUserLifecycleFakes(options);
  const suspension: UserSuspension = new StoreUserSuspension(
    fakes.users,
    fakes.committer,
    fakes.publisher,
    fakes.reporter,
  );
  return { suspension, recorded: fakes.recorded };
}

const NOT_FOUND = {
  kind: 'not_found',
  code: 'not_found',
  message: '対象が見つかりません。',
} as const;

const WITHDRAWN_AT = new Date('2026-11-01T00:00:00.000Z');

const ACTIVE_USER = userOf({ lifecycleVersion: 5 });

const SUSPENDED_USER = userOf({
  status: 'suspended',
  lifecycleVersion: 6,
});

const MISSING_TARGETS = [
  ['存在しない', OTHER_USER_ID, ACTIVE_USER],
  ['退会済み', USER_ID, userOf({ deletedAt: WITHDRAWN_AT })],
  [
    '停止中のまま退会済み',
    USER_ID,
    userOf({ status: 'suspended', deletedAt: WITHDRAWN_AT }),
  ],
] as const;

describe('StoreUserSuspension.suspend', () => {
  test('有効な利用者を読み取った版で停止として確定し、非同期の波及処理の実行を送ってchangedを返す', async () => {
    const { suspension, recorded } = setup({ user: ACTIVE_USER });

    const result = await suspension.suspend(USER_ID, NOW);

    expect(result).toBe('changed');
    expect(recorded.transitions).toEqual([
      { kind: 'suspend', userId: USER_ID, expectedVersion: 5, at: NOW },
    ]);
    expect(recorded.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: EVENT_ID },
        options: undefined,
      },
    ]);
  });

  test('停止では既存のセッションに触れず、利用者の読み取り・確定・送信だけを行う', async () => {
    const { suspension, recorded } = setup({ user: ACTIVE_USER });

    await suspension.suspend(USER_ID, NOW);

    expect(recorded.calls).toEqual([
      'users.findById',
      'committer.commit',
      'publisher.publish',
    ]);
  });

  test('既に停止中ならunchangedを返し、確定も送信もしない', async () => {
    const { suspension, recorded } = setup({ user: SUSPENDED_USER });

    const result = await suspension.suspend(USER_ID, NOW);

    expect(result).toBe('unchanged');
    expect(recorded.calls).toEqual(['users.findById']);
  });

  test.each(MISSING_TARGETS)(
    '対象が%sなら404のnot_foundで拒否し、状態を変えない',
    async (_label, userId, user) => {
      const { suspension, recorded } = setup({ user });

      const error = await caught(suspension.suspend(userId, NOW));

      expect(shapeOf(error)).toEqual(NOT_FOUND);
      expect(recorded.calls).toEqual(['users.findById']);
    },
  );

  test('送信に失敗しても停止は確定済みのためchangedを返し、運用者へ通知する', async () => {
    const { suspension, recorded } = setup({
      user: ACTIVE_USER,
      publishError: new Error('Queueへの送信に失敗した'),
    });

    const result = await suspension.suspend(USER_ID, NOW);

    expect(result).toBe('changed');
    expect(recorded.incidents).toEqual([
      { kind: 'lifecycle-publish-failed', eventId: EVENT_ID },
    ]);
  });

  test('版の競合はaccount_state_conflictのまま投げ、送信しない', async () => {
    const conflict = new AppError({
      kind: 'conflict',
      code: 'account_state_conflict',
      message: '処理が重なりました。時間をおいて再度お試しください。',
    });
    const { suspension, recorded } = setup({
      user: ACTIVE_USER,
      commitError: conflict,
    });

    const rejection = await rejectionOf(suspension.suspend(USER_ID, NOW));

    expect(rejection).toBe(conflict);
    expect(recorded.published).toEqual([]);
  });
});

describe('StoreUserSuspension.unsuspend', () => {
  test('停止中の利用者を読み取った版で停止解除として確定し、非同期の波及処理の実行を送ってchangedを返す', async () => {
    const { suspension, recorded } = setup({ user: SUSPENDED_USER });

    const result = await suspension.unsuspend(USER_ID, NOW);

    expect(result).toBe('changed');
    expect(recorded.calls).toEqual([
      'users.findById',
      'committer.commit',
      'publisher.publish',
    ]);
    expect(recorded.transitions).toEqual([
      { kind: 'unsuspend', userId: USER_ID, expectedVersion: 6, at: NOW },
    ]);
    expect(recorded.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: EVENT_ID },
        options: undefined,
      },
    ]);
  });

  test('停止中でなければunchangedを返し、確定も送信もしない', async () => {
    const { suspension, recorded } = setup({ user: ACTIVE_USER });

    const result = await suspension.unsuspend(USER_ID, NOW);

    expect(result).toBe('unchanged');
    expect(recorded.calls).toEqual(['users.findById']);
  });

  test.each(MISSING_TARGETS)(
    '対象が%sなら404のnot_foundで拒否し、停止解除しない',
    async (_label, userId, user) => {
      const { suspension, recorded } = setup({ user });

      const error = await caught(suspension.unsuspend(userId, NOW));

      expect(shapeOf(error)).toEqual(NOT_FOUND);
      expect(recorded.calls).toEqual(['users.findById']);
    },
  );

  test('送信に失敗しても停止解除は確定済みのためchangedを返し、運用者へ通知する', async () => {
    const { suspension, recorded } = setup({
      user: SUSPENDED_USER,
      publishError: new Error('Queueへの送信に失敗した'),
    });

    const result = await suspension.unsuspend(USER_ID, NOW);

    expect(result).toBe('changed');
    expect(recorded.incidents).toEqual([
      { kind: 'lifecycle-publish-failed', eventId: EVENT_ID },
    ]);
  });
});
