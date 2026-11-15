import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { UserHandleResolution } from '../../../lib/core/profile/ports.ts';
import { StoreFollowService } from './follow-service.ts';
import {
  createFakeFollowStore,
  createFakeUserProfileDirectory,
  currentUserOf,
  fixedClock,
  PROFILE_NOW,
  summaryOf,
  TARGET_FOLLOW_ID,
  TARGET_USER_ID,
  USER_ID,
  type FakeFollowStoreOptions,
} from './testing/profile-fakes.ts';

const currentOf = (): UserHandleResolution => ({
  kind: 'current',
  user: summaryOf(),
});

function setup(
  resolution: UserHandleResolution,
  storeOptions: FakeFollowStoreOptions = {},
) {
  const calls: string[] = [];
  const directory = createFakeUserProfileDirectory(calls, resolution);
  const store = createFakeFollowStore(calls, storeOptions);
  const service = new StoreFollowService(
    directory,
    store,
    { generate: () => TARGET_FOLLOW_ID },
    fixedClock,
  );
  return { calls, directory, store, service };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

describe('StoreFollowService.follow', () => {
  test('現在のハンドルの相手を、IDと時刻を付けて記録し、現在のハンドルと可視のフォロワー数を返す', async () => {
    const { store, directory, service } = setup(currentOf(), {
      followerCount: 3,
    });

    const state = await service.follow(currentUserOf(), 'Bob');

    expect(directory.resolved).toEqual(['Bob']);
    expect(store.inserts).toEqual([
      {
        id: TARGET_FOLLOW_ID,
        followerId: USER_ID,
        followeeId: TARGET_USER_ID,
        now: PROFILE_NOW,
      },
    ]);
    expect(state).toEqual({ handle: 'bob', following: true, followerCount: 3 });
    expect(store.countQueries).toEqual([TARGET_USER_ID]);
  });

  test('旧ハンドルの相手は保有者として解決し、結果には現在のハンドルを返す', async () => {
    const { store, service } = setup(
      { kind: 'previous', user: summaryOf({ handle: 'bob-new' }) },
      { followerCount: 1 },
    );

    const state = await service.follow(currentUserOf(), 'bob-old');

    expect(store.inserts[0]?.followeeId).toBe(TARGET_USER_ID);
    expect(state).toEqual({
      handle: 'bob-new',
      following: true,
      followerCount: 1,
    });
  });

  test('既にフォロー中でも成功し、フォロー中として返す', async () => {
    const { service } = setup(currentOf(), {
      insertResult: 'exists',
      followerCount: 2,
    });

    const state = await service.follow(currentUserOf(), 'bob');

    expect(state).toEqual({ handle: 'bob', following: true, followerCount: 2 });
  });

  test('存在しないハンドルはfollow_target_unavailableで拒否し、記録しない', async () => {
    const { store, service } = setup({ kind: 'none' });

    expect(await codeOf(service.follow(currentUserOf(), 'nobody'))).toBe(
      'follow_target_unavailable',
    );
    expect(store.inserts).toEqual([]);
  });

  test('停止中の相手はfollow_target_unavailableで拒否し、記録しない', async () => {
    const { store, service } = setup({
      kind: 'current',
      user: summaryOf({ suspended: true }),
    });

    expect(await codeOf(service.follow(currentUserOf(), 'bob'))).toBe(
      'follow_target_unavailable',
    );
    expect(store.inserts).toEqual([]);
  });

  test('自分自身は現在のハンドルでも旧ハンドルでもcannot_follow_selfで拒否し、記録しない', async () => {
    for (const kind of ['current', 'previous'] as const) {
      const { store, service } = setup({
        kind,
        user: summaryOf({ userId: USER_ID, handle: 'alice' }),
      });

      expect(await codeOf(service.follow(currentUserOf(), 'alice'))).toBe(
        'cannot_follow_self',
      );
      expect(store.inserts).toEqual([]);
    }
  });

  test('同時の停止・退会で記録できなかった場合はfollow_target_unavailableで拒否し、数は数えない', async () => {
    const { store, service } = setup(currentOf(), {
      insertResult: 'target-unavailable',
    });

    expect(await codeOf(service.follow(currentUserOf(), 'bob'))).toBe(
      'follow_target_unavailable',
    );
    expect(store.countQueries).toEqual([]);
  });

  test('ストアの障害はそのまま送出する', async () => {
    const { store, service } = setup(currentOf());
    store.insertIfAbsent = () => Promise.reject(new Error('d1 down'));

    const error = await service
      .follow(currentUserOf(), 'bob')
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error('d1 down'));
  });
});

describe('StoreFollowService.unfollow', () => {
  test('相手のフォローを解除し、フォローしていない状態と可視のフォロワー数を返す', async () => {
    const { store, service } = setup(currentOf(), { followerCount: 4 });

    const state = await service.unfollow(currentUserOf(), 'bob');

    expect(store.deletes).toEqual([
      { followerId: USER_ID, followeeId: TARGET_USER_ID },
    ]);
    expect(state).toEqual({
      handle: 'bob',
      following: false,
      followerCount: 4,
    });
  });

  test('旧ハンドルでも解除でき、結果には現在のハンドルを返す', async () => {
    const { service } = setup({
      kind: 'previous',
      user: summaryOf({ handle: 'bob-new' }),
    });

    const state = await service.unfollow(currentUserOf(), 'bob-old');

    expect(state.handle).toBe('bob-new');
  });

  test('停止中の相手も解決して解除できる', async () => {
    const { store, service } = setup({
      kind: 'current',
      user: summaryOf({ suspended: true }),
    });

    const state = await service.unfollow(currentUserOf(), 'bob');

    expect(store.deletes).toHaveLength(1);
    expect(state.following).toBe(false);
  });

  test('フォローしていない相手でも成功する', async () => {
    const { store, service } = setup(currentOf());

    await service.unfollow(currentUserOf(), 'bob');
    await service.unfollow(currentUserOf(), 'bob');

    expect(store.deletes).toHaveLength(2);
  });

  test('存在しないハンドルはfollow_target_unavailableで拒否し、削除しない', async () => {
    const { store, service } = setup({ kind: 'none' });

    expect(await codeOf(service.unfollow(currentUserOf(), 'nobody'))).toBe(
      'follow_target_unavailable',
    );
    expect(store.deletes).toEqual([]);
  });
});
