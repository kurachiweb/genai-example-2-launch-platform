import { describe, expect, test } from 'vitest';

import { userFollows } from '../../../../../db/schema/follow/user-follows.ts';
import {
  insertUser,
  T0,
  db,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
  followUser,
  installProfileGraphQLTest,
  issueUserSession,
  unfollowUser,
} from '../../../../../test/support/profile-graphql-operations.ts';

const ALICE = 1;
const BOB = 2;

const FOLLOW_BOT_TOKEN = botTokenFor('follow');

const HANDLE_TOO_LONG_MESSAGE = 'ハンドルは25文字以内で入力してください。';
const HANDLE_FORMAT_MESSAGE =
  'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。';

installProfileGraphQLTest();

async function insertAlice(): Promise<string> {
  await insertUser(ALICE, {
    handle: 'alice',
    nickname: 'アリス',
    emailVerifiedAt: T0,
  });
  return issueUserSession(ALICE);
}

// 規則に合わない値をハンドルに持つ相手を置き、検証を通り抜ければユースケースがその相手を見つけて書き込む状態にする
async function insertBobWithHandle(handle: string): Promise<void> {
  await insertUser(BOB, { handle, nickname: 'ボブ' });
}

async function insertAliceFollowsBob(): Promise<void> {
  await db.insert(userFollows).values({
    id: '01JC0F1W000000000000000001',
    followerId: userIdOf(ALICE),
    followeeId: userIdOf(BOB),
    createdAt: T0,
    updatedAt: T0,
  });
}

async function readFollows() {
  return db.select().from(userFollows);
}

const violations = [
  ['26文字以上のハンドル', 'b'.repeat(26), HANDLE_TOO_LONG_MESSAGE],
  ['使えない文字を含むハンドル', 'bob!', HANDLE_FORMAT_MESSAGE],
  ['空のハンドル', '', 'ハンドルを入力してください。'],
] as const;

describe('followUser', () => {
  test.each(violations)(
    '%sは、bot判定とフォローの記録をせずvalidation_errorで拒否する',
    async (_name, handle, message) => {
      const calls = stubExternalServices();
      const token = await insertAlice();
      await insertBobWithHandle(handle);

      const response = await followUser(handle, {
        sessionToken: token,
        botToken: FOLLOW_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field: 'handle', message }),
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readFollows()).toEqual([]);
    },
  );
});

describe('unfollowUser', () => {
  test.each(violations)(
    '%sは、bot判定とフォローの解除をせずvalidation_errorで拒否する',
    async (_name, handle, message) => {
      const calls = stubExternalServices();
      const token = await insertAlice();
      await insertBobWithHandle(handle);
      await insertAliceFollowsBob();

      const response = await unfollowUser(handle, {
        sessionToken: token,
        botToken: FOLLOW_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field: 'handle', message }),
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readFollows()).toEqual([
        expect.objectContaining({ deletedAt: null }),
      ]);
    },
  );
});
