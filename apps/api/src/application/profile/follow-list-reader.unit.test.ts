import { describe, expect, test } from 'bun:test';

import { StoreFollowListReader } from './follow-list-reader.ts';
import type { FollowEntryView } from './ports.ts';
import {
  createFakeFollowStore,
  currentUserOf,
  summaryOf,
  TARGET_FOLLOW_ID,
  USER_ID,
} from './testing/profile-fakes.ts';

const entryOf = (followId: string, handle: string): FollowEntryView => ({
  followId,
  user: summaryOf({ handle }),
  followedAt: new Date('2027-03-01T00:00:00.000Z'),
});

describe('StoreFollowListReader.list', () => {
  test('セッションの本人の一覧を、方向・件数・位置をそのまま渡して読む', async () => {
    const calls: string[] = [];
    const store = createFakeFollowStore(calls);
    const reader = new StoreFollowListReader(store);
    const after = { t: 1_800_000_000_000, id: TARGET_FOLLOW_ID };

    await reader.list(currentUserOf(), {
      direction: 'followers',
      first: 20,
      after,
    });

    expect(store.listQueries).toEqual([
      { userId: USER_ID, direction: 'followers', first: 20, after },
    ]);
  });

  test('先頭からの一覧は位置を持たずに読む', async () => {
    const store = createFakeFollowStore([]);
    const reader = new StoreFollowListReader(store);

    await reader.list(currentUserOf(), {
      direction: 'following',
      first: 5,
      after: undefined,
    });

    expect(store.listQueries[0]?.after).toBeUndefined();
    expect(store.listQueries[0]?.direction).toBe('following');
  });

  test('ストアが返したfirst+1件までの行を切り詰めずにそのまま返す', async () => {
    const entries = [
      entryOf('01JC0FOLLOW0000000000000003', 'a'),
      entryOf('01JC0FOLLOW0000000000000002', 'b'),
      entryOf('01JC0FOLLOW0000000000000001', 'c'),
    ];
    const reader = new StoreFollowListReader(
      createFakeFollowStore([], { entries }),
    );

    const rows = await reader.list(currentUserOf(), {
      direction: 'following',
      first: 2,
      after: undefined,
    });

    expect(rows).toEqual(entries);
  });

  test('0件なら空の配列を返す', async () => {
    const reader = new StoreFollowListReader(createFakeFollowStore([]));

    const rows = await reader.list(currentUserOf(), {
      direction: 'followers',
      first: 20,
      after: undefined,
    });

    expect(rows).toEqual([]);
  });
});
