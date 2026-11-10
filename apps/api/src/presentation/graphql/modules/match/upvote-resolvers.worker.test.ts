import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { users } from '../../../../../db/schema/identity/users.ts';
import {
  db,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  entryIdOf,
  insertMatch,
  insertUpvotes,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  cancelUpvote,
  codesOf,
  detailsOf,
  installMatchGraphQLTest,
  issueMatchUserSession,
  upvote,
} from '../../../../../test/support/match-graphql-operations.ts';
import {
  DURING_MATCH,
  ENTRY_A,
  ENTRY_B,
  insertLiveMatch,
  LIVE_MATCH,
  OWNER_A,
  readMatchTables,
  readUpvotes,
  seedUpvoteParticipants,
  STARTS_AT,
  SUSPENDED,
  twoSidedMatch,
  UNVERIFIED,
  VOTER,
} from '../../../../infrastructure/match/testing/upvote-store-fixtures.ts';

installMatchGraphQLTest();

const UPVOTE_BOT_TOKEN = botTokenFor('match_upvote');

const MATCH_NOT_FOUND_MESSAGE =
  'マッチが見つかりませんでした。ページを再読み込みしてください。';

const NOT_ACCEPTING_MESSAGE = 'このマッチはUpvoteを受け付けていません。';

const OWN_MATCH_MESSAGE =
  '自身のプロダクトとその対戦相手にはUpvoteできません。';

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const SCHEDULED_MATCH = 2;

const FINISHED_MATCH = 3;

const OTHER_LIVE_MATCH = 4;

const MISSING_MATCH_ID = matchIdOf(99);

const UPVOTE_A = {
  matchId: matchIdOf(LIVE_MATCH),
  entryId: entryIdOf(ENTRY_A),
};

const UPVOTE_B = {
  matchId: matchIdOf(LIVE_MATCH),
  entryId: entryIdOf(ENTRY_B),
};

type Operation = 'upvote' | 'cancelUpvote';

const OPERATIONS: readonly Operation[] = ['upvote', 'cancelUpvote'];

function send(
  operation: Operation,
  options: Parameters<typeof upvote>[1],
): ReturnType<typeof upvote | typeof cancelUpvote> {
  return operation === 'upvote'
    ? upvote(UPVOTE_B, options)
    : cancelUpvote(matchIdOf(LIVE_MATCH), options);
}

// 投稿者AとBの受け付け中のマッチ1を作る
async function seedLiveMatch(): Promise<void> {
  await seedUpvoteParticipants();
  await insertLiveMatch();
}

async function seedVoterUpvote(): Promise<void> {
  await insertUpvotes([
    {
      index: 1,
      match: LIVE_MATCH,
      entry: ENTRY_A,
      user: VOTER,
      upvotedAt: STARTS_AT,
    },
  ]);
}

async function voterSession(): Promise<string> {
  return issueMatchUserSession(VOTER);
}

function countsOf(
  match: { entries: readonly { id: string; upvoteCount: number }[] } | null,
) {
  return match?.entries.map((entry) => [entry.id, entry.upvoteCount]);
}

describe('upvote・cancelUpvoteの拒否の順', () => {
  test.each(OPERATIONS)(
    '管理者側の呼び出し元からの%sは、bot判定の前にforbiddenで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      await seedLiveMatch();
      const token = await voterSession();

      const response = await send(operation, {
        caller: 'admin',
        sessionToken: token,
        botToken: UPVOTE_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    'ログインしていなければ、%sをbot判定を使わずunauthenticatedで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      await seedLiveMatch();

      const response = await send(operation, { botToken: UPVOTE_BOT_TOKEN });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    '停止中の利用者の%sは、メールアドレスが未確認でもbot判定を使わずaccount_unavailableで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      await seedLiveMatch();
      await db
        .update(users)
        .set({ emailVerifiedAt: null })
        .where(eq(users.id, userIdOf(SUSPENDED)));
      const token = await issueMatchUserSession(SUSPENDED);

      const response = await send(operation, {
        sessionToken: token,
        botToken: UPVOTE_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['account_unavailable']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    'メールアドレスが未確認の利用者の%sは、bot判定を使わずemail_not_verifiedで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      await seedLiveMatch();
      const token = await issueMatchUserSession(UNVERIFIED);

      const response = await send(operation, {
        sessionToken: token,
        botToken: UPVOTE_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['email_not_verified']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test.each(
    OPERATIONS.flatMap((operation) => [
      [operation, 'トークンが無い', undefined, 'bot_verification_failed'],
      [
        operation,
        '判定に失敗する',
        BOT_REJECTED_TOKEN,
        'bot_verification_failed',
      ],
      [
        operation,
        '別の操作名の判定の結果である',
        botTokenFor('follow'),
        'bot_verification_failed',
      ],
      [
        operation,
        '判定サービスに到達できない',
        BOT_UNREACHABLE_TOKEN,
        'bot_verification_unavailable',
      ],
    ]),
  )(
    '%sでbot判定の%s場合は記録を変えずに拒否する',
    async (operation, _name, botToken, code) => {
      stubExternalServices();
      await seedLiveMatch();
      await seedVoterUpvote();
      const token = await voterSession();
      const before = await readMatchTables();

      const response = await send(
        operation,
        botToken === undefined
          ? { sessionToken: token }
          : { sessionToken: token, botToken },
      );

      expect(codesOf(response)).toEqual([code]);
      expect(await readMatchTables()).toEqual(before);
    },
  );

  test('IDの形式の違反は、bot判定を使わずマッチが見つからない文言のvalidation_errorにする', async () => {
    const calls = stubExternalServices();
    await seedLiveMatch();
    const token = await voterSession();
    const options = { sessionToken: token, botToken: UPVOTE_BOT_TOKEN };

    const upvoted = await upvote(
      { matchId: 'not-a-match', entryId: entryIdOf(ENTRY_A) },
      options,
    );
    const cancelled = await cancelUpvote('not-a-match', options);

    expect(codesOf(upvoted)).toEqual(['validation_error']);
    expect(upvoted.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
    expect(detailsOf(upvoted)).toEqual([
      {
        field: 'input.matchId',
        code: 'invalid_format',
        message: MATCH_NOT_FOUND_MESSAGE,
      },
    ]);
    expect(codesOf(cancelled)).toEqual(['validation_error']);
    expect(detailsOf(cancelled)).toEqual([
      {
        field: 'matchId',
        code: 'invalid_format',
        message: MATCH_NOT_FOUND_MESSAGE,
      },
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });
});

describe('upvoteとcancelUpvoteの成功', () => {
  test('Upvoteで記録し、更新後のマッチを返す', async () => {
    stubExternalServices();
    await seedLiveMatch();
    const token = await voterSession();

    const response = await upvote(UPVOTE_A, {
      sessionToken: token,
      botToken: UPVOTE_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.upvote).toMatchObject({
      id: matchIdOf(LIVE_MATCH),
      phase: 'LIVE',
      viewerUpvotedEntryId: entryIdOf(ENTRY_A),
      viewerRestriction: null,
    });
    expect(countsOf(response.data?.upvote ?? null)).toEqual([
      [entryIdOf(ENTRY_A), 1],
      [entryIdOf(ENTRY_B), 0],
    ]);
    expect(await readUpvotes(LIVE_MATCH)).toMatchObject([
      { entryId: entryIdOf(ENTRY_A), upvotedAt: DURING_MATCH },
    ]);
  });

  test('反対側へのUpvoteで付け替え、更新後のマッチを返す', async () => {
    stubExternalServices();
    await seedLiveMatch();
    await seedVoterUpvote();
    const token = await voterSession();

    const response = await upvote(UPVOTE_B, {
      sessionToken: token,
      botToken: UPVOTE_BOT_TOKEN,
    });

    expect(response.data?.upvote?.viewerUpvotedEntryId).toBe(
      entryIdOf(ENTRY_B),
    );
    expect(countsOf(response.data?.upvote ?? null)).toEqual([
      [entryIdOf(ENTRY_A), 0],
      [entryIdOf(ENTRY_B), 1],
    ]);
  });

  test('取り消しでUpvoteを消し、更新後のマッチを返す', async () => {
    stubExternalServices();
    await seedLiveMatch();
    await seedVoterUpvote();
    const token = await voterSession();

    const response = await cancelUpvote(matchIdOf(LIVE_MATCH), {
      sessionToken: token,
      botToken: UPVOTE_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.cancelUpvote).toMatchObject({
      id: matchIdOf(LIVE_MATCH),
      viewerUpvotedEntryId: null,
      viewerRestriction: null,
    });
    expect(countsOf(response.data?.cancelUpvote ?? null)).toEqual([
      [entryIdOf(ENTRY_A), 0],
      [entryIdOf(ENTRY_B), 0],
    ]);
    expect(await readUpvotes(LIVE_MATCH)).toEqual([]);
  });

  test('Upvoteの無い受け付け中のマッチの取り消しは、何も変えずに現在のマッチを返す', async () => {
    stubExternalServices();
    await seedLiveMatch();
    const token = await voterSession();

    const response = await cancelUpvote(matchIdOf(LIVE_MATCH), {
      sessionToken: token,
      botToken: UPVOTE_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.cancelUpvote?.viewerUpvotedEntryId).toBeNull();
  });
});

describe('upvoteとcancelUpvoteのマッチの状態によるエラー', () => {
  test.each(OPERATIONS)(
    '存在しないマッチへの%sはmatch_not_foundにする',
    async (operation) => {
      stubExternalServices();
      await seedLiveMatch();
      const token = await voterSession();
      const options = { sessionToken: token, botToken: UPVOTE_BOT_TOKEN };

      const response =
        operation === 'upvote'
          ? await upvote(
              { matchId: MISSING_MATCH_ID, entryId: entryIdOf(ENTRY_A) },
              options,
            )
          : await cancelUpvote(MISSING_MATCH_ID, options);

      expect(codesOf(response)).toEqual(['match_not_found']);
      expect(response.errors?.[0]?.message).toBe(MATCH_NOT_FOUND_MESSAGE);
    },
  );

  test('マッチに無い側へのUpvoteは、入力の欄にマッチが見つからない文言のvalidation_errorにする', async () => {
    stubExternalServices();
    await seedLiveMatch();
    await insertMatch(twoSidedMatch(OTHER_LIVE_MATCH));
    const token = await voterSession();

    const response = await upvote(
      { matchId: matchIdOf(LIVE_MATCH), entryId: entryIdOf(41) },
      { sessionToken: token, botToken: UPVOTE_BOT_TOKEN },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.entryId',
        code: 'custom',
        message: MATCH_NOT_FOUND_MESSAGE,
      },
    ]);
    expect(await readUpvotes(LIVE_MATCH)).toEqual([]);
  });

  test.each([
    ['開始前', SCHEDULED_MATCH, {}],
    [
      '終了後',
      FINISHED_MATCH,
      { startedAt: STARTS_AT, decidedAt: STARTS_AT, decision: 'no_votes' },
    ],
  ] as const)(
    '%sのマッチへのUpvoteと取り消しはupvote_not_acceptingにする',
    async (_name, index, columns) => {
      stubExternalServices();
      await seedUpvoteParticipants();
      await insertMatch(twoSidedMatch(index, columns));
      const token = await voterSession();
      const options = { sessionToken: token, botToken: UPVOTE_BOT_TOKEN };

      const upvoted = await upvote(
        { matchId: matchIdOf(index), entryId: entryIdOf(index * 10 + 1) },
        options,
      );
      const cancelled = await cancelUpvote(matchIdOf(index), options);

      expect(codesOf(upvoted)).toEqual(['upvote_not_accepting']);
      expect(upvoted.errors?.[0]?.message).toBe(NOT_ACCEPTING_MESSAGE);
      expect(codesOf(cancelled)).toEqual(['upvote_not_accepting']);
      expect(cancelled.errors?.[0]?.message).toBe(NOT_ACCEPTING_MESSAGE);
    },
  );

  test.each([
    ['自分のプロダクトの側', UPVOTE_A],
    ['自分のプロダクトの対戦相手の側', UPVOTE_B],
  ])('%sへのUpvoteはupvote_own_matchにする', async (_name, input) => {
    stubExternalServices();
    await seedLiveMatch();
    const token = await issueMatchUserSession(OWNER_A);

    const response = await upvote(input, {
      sessionToken: token,
      botToken: UPVOTE_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['upvote_own_match']);
    expect(response.errors?.[0]?.message).toBe(OWN_MATCH_MESSAGE);
    expect(await readUpvotes(LIVE_MATCH)).toEqual([]);
  });
});
