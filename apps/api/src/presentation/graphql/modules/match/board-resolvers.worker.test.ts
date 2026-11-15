import { describe, expect, test } from 'vitest';

import { teamColorIndexOf } from '../../../../../common-lib/match/team-colors.ts';
import { PRODUCT_LOGO_PURPOSE } from '../../../../../common-lib/product/product-input-rules.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  STARTS_AT,
} from '../../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  MATCH_DATE,
  matchIdOf,
  type EntryFixture,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  insertCategory,
  insertProduct,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  codesOf,
  completePairingDay,
  fetchQualifierBoard,
  installMatchGraphQLTest,
  issueMatchUserSession,
  type MatchEntryFields,
  type MatchFields,
  setMatchTestNow,
} from '../../../../../test/support/match-graphql-operations.ts';

installMatchGraphQLTest();

const OWNER_A = 1;

const OWNER_B = 2;

const VOTER = 3;

const UNVERIFIED = 4;

const SUSPENDED = 5;

const OWNER_C = 6;

const OTHER_CATEGORY = {
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
};

const CUSTOM_CATEGORY = {
  id: categoryIdOf(1),
  name: 'カテゴリ1',
  handle: 'category1',
  systemDefault: false,
};

const BEFORE_EARLY_END = new Date(DURING_MATCH.getTime() - 60_000);

function side(
  index: number,
  product: number | null,
  owner: number | null,
  columns: EntryFixture['columns'] = {},
): EntryFixture {
  return { index, launch: null, product, owner, columns };
}

// 対戦カード1(3対2、投稿者AとB)・対戦カード2(0対1、非公開化中と紐付けの解除)・対戦相手なしの不戦勝3・即時の終了の不戦勝4・未開始5・別の日6
async function seedBoard(): Promise<void> {
  const verified = { emailVerifiedAt: T0 };
  for (const index of [OWNER_A, OWNER_B, VOTER, OWNER_C]) {
    await insertUser(index, verified);
  }
  await insertUser(UNVERIFIED);
  await insertUser(SUSPENDED, { ...verified, status: 'suspended' });
  await insertCategory(1);
  await insertFile(1, {
    purpose: PRODUCT_LOGO_PURPOSE,
    ownerId: userIdOf(OWNER_A),
    location: 'quarantine',
    moderationStatus: 'flagged',
  });
  await insertReason(1, 'auto');
  await insertFile(3, {
    purpose: PRODUCT_LOGO_PURPOSE,
    ownerId: userIdOf(OWNER_B),
  });
  await insertProduct(1, OWNER_A, { logoFileId: fileIdOf(1) });
  await insertProduct(3, OWNER_B, {
    logoFileId: fileIdOf(3),
    categoryId: categoryIdOf(1),
  });
  await insertProduct(5, OWNER_C, { hiddenAt: T0 });
  await insertProduct(6, OWNER_C);
  await insertMatches([
    {
      index: 1,
      columns: { startedAt: STARTS_AT },
      entries: [
        side(11, 1, OWNER_A, { upvoteCount: 3 }),
        side(12, 3, OWNER_B, { upvoteCount: 2 }),
      ],
    },
    {
      index: 2,
      columns: { startedAt: STARTS_AT },
      entries: [side(21, 5, OWNER_C), side(22, null, null, { upvoteCount: 1 })],
    },
    {
      index: 3,
      columns: {
        startedAt: STARTS_AT,
        decidedAt: STARTS_AT,
        decision: 'bye',
      },
      entries: [side(31, 6, OWNER_C, { result: 'bye' })],
    },
    {
      index: 4,
      columns: {
        startedAt: STARTS_AT,
        decidedAt: BEFORE_EARLY_END,
        decision: 'walkover',
        endedEarlyAt: BEFORE_EARLY_END,
      },
      entries: [
        side(41, 6, OWNER_C, { upvoteCount: 4, result: 'walkover' }),
        side(42, 1, OWNER_A, { forfeitedAt: T0, result: 'lost' }),
      ],
    },
    {
      index: 5,
      entries: [side(51, 6, OWNER_C), side(52, 3, OWNER_B)],
    },
    {
      index: 6,
      columns: {
        matchDate: '2026-11-19',
        startsAt: new Date(STARTS_AT.getTime() - 86_400_000),
        endsAt: new Date(ENDS_AT.getTime() - 86_400_000),
        startedAt: new Date(STARTS_AT.getTime() - 86_400_000),
      },
      entries: [side(61, 6, OWNER_C), side(62, 3, OWNER_B)],
    },
  ]);
  await insertUpvotes([
    { index: 1, match: 1, entry: 11, user: VOTER, upvotedAt: STARTS_AT },
  ]);
}

const PRODUCT_1 = {
  handle: 'product1',
  name: 'プロダクト1',
  tagline: 'タグライン1',
  category: OTHER_CATEGORY,
  websiteUrl: 'https://product1.example/',
  logo: { id: fileIdOf(1), objectKey: null },
  listed: false,
};

const PRODUCT_3 = {
  handle: 'product3',
  name: 'プロダクト3',
  tagline: 'タグライン3',
  category: CUSTOM_CATEGORY,
  websiteUrl: 'https://product3.example/',
  logo: { id: fileIdOf(3), objectKey: objectKeyOf(3) },
  listed: false,
};

const PRODUCT_6 = {
  handle: 'product6',
  name: 'プロダクト6',
  tagline: 'タグライン6',
  category: OTHER_CATEGORY,
  websiteUrl: 'https://product6.example/',
  logo: null,
  listed: false,
};

function entryOf(
  index: number,
  product: number | null,
  fields: Partial<MatchEntryFields> = {},
): MatchEntryFields {
  return {
    id: entryIdOf(index),
    product: null,
    isViewerOwn: false,
    upvoteCount: 0,
    result: null,
    colorIndex: teamColorIndexOf(
      product === null ? null : productIdOf(product),
    ),
    ...fields,
  };
}

function matchOf(
  index: number,
  entries: readonly MatchEntryFields[],
  fields: Partial<MatchFields> = {},
): MatchFields {
  return {
    id: matchIdOf(index),
    kind: 'QUALIFIER',
    round: null,
    stage: null,
    date: MATCH_DATE,
    startsAt: STARTS_AT.toISOString(),
    endsAt: ENDS_AT.toISOString(),
    phase: 'LIVE',
    decision: null,
    endedEarly: false,
    entries,
    viewerUpvotedEntryId: null,
    viewerRestriction: 'GUEST',
    ...fields,
  };
}

const CARD_1 = matchOf(1, [
  entryOf(11, 1, { product: PRODUCT_1, upvoteCount: 3 }),
  entryOf(12, 3, { product: PRODUCT_3, upvoteCount: 2 }),
]);

const CARD_2 = matchOf(2, [
  entryOf(21, 5),
  entryOf(22, null, { upvoteCount: 1 }),
]);

const ABSENT_ENTRY = entryOf(31, 6, { product: PRODUCT_6, result: 'BYE' });

const ABSENT_BYE = matchOf(3, [ABSENT_ENTRY], {
  phase: 'FINISHED',
  decision: 'BYE',
  viewerRestriction: 'NOT_ACCEPTING',
});

const EARLY_ENTRY = entryOf(41, 6, {
  product: PRODUCT_6,
  upvoteCount: 4,
  result: 'WALKOVER',
});

const EARLY_BYE = matchOf(
  4,
  [EARLY_ENTRY, entryOf(42, 1, { product: PRODUCT_1, result: 'LOST' })],
  {
    phase: 'FINISHED',
    decision: 'WALKOVER',
    endedEarly: true,
    viewerRestriction: 'NOT_ACCEPTING',
  },
);

const NEXT_KICKOFF_AT = new Date(
  STARTS_AT.getTime() + 86_400_000,
).toISOString();

describe('qualifierBoard: 未ログイン', () => {
  test('当日の開始済みの予選を対戦カードと不戦勝に分け、側の項目と閲覧者の制限を返す', async () => {
    await seedBoard();

    const response = await fetchQualifierBoard();

    expect(response.errors).toBeUndefined();
    expect(response.data?.qualifierBoard).toEqual({
      date: MATCH_DATE,
      serverTime: DURING_MATCH.toISOString(),
      phase: 'LIVE',
      fullTimeAt: ENDS_AT.toISOString(),
      nextKickoffAt: NEXT_KICKOFF_AT,
      awaitingKickoff: true,
      heldCount: 3,
      matches: [CARD_1, CARD_2],
      byes: [
        { match: ABSENT_BYE, entry: ABSENT_ENTRY, reason: 'ABSENT' },
        { match: EARLY_BYE, entry: EARLY_ENTRY, reason: 'EARLY' },
      ],
    });
  });

  test('当日のマッチが無ければ空の一覧を返す', async () => {
    await completePairingDay();

    const response = await fetchQualifierBoard();

    expect(response.errors).toBeUndefined();
    expect(response.data?.qualifierBoard).toEqual(
      expect.objectContaining({
        awaitingKickoff: false,
        heldCount: 0,
        matches: [],
        byes: [],
      }),
    );
  });

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchQualifierBoard({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toBeNull();
  });
});

describe('qualifierBoard: ログイン中', () => {
  test('Upvoteした閲覧者には、Upvoteした側と制限なしを返す', async () => {
    await seedBoard();
    const token = await issueMatchUserSession(VOTER);

    const response = await fetchQualifierBoard({ sessionToken: token });

    expect(response.errors).toBeUndefined();
    expect(response.data?.qualifierBoard?.matches).toEqual([
      {
        ...CARD_1,
        viewerUpvotedEntryId: entryIdOf(11),
        viewerRestriction: null,
      },
      { ...CARD_2, viewerRestriction: null },
    ]);
  });

  test('投稿者には自分の側の印と自分のマッチの制限を返す', async () => {
    await seedBoard();
    const token = await issueMatchUserSession(OWNER_A);

    const response = await fetchQualifierBoard({ sessionToken: token });

    const board = response.data?.qualifierBoard;
    expect(response.errors).toBeUndefined();
    expect(board?.matches).toEqual([
      {
        ...CARD_1,
        entries: [
          { ...CARD_1.entries[0], isViewerOwn: true },
          CARD_1.entries[1],
        ],
        viewerRestriction: 'OWN_MATCH',
      },
      { ...CARD_2, viewerRestriction: null },
    ]);
    expect(board?.byes[1]?.match.entries[1]?.isViewerOwn).toBe(true);
  });

  test('メールアドレスが未確認の利用者と停止中の利用者には、それぞれの制限を返す', async () => {
    await seedBoard();
    const unverified = await issueMatchUserSession(UNVERIFIED);
    const suspended = await issueMatchUserSession(SUSPENDED);

    const first = await fetchQualifierBoard({ sessionToken: unverified });
    const second = await fetchQualifierBoard({ sessionToken: suspended });

    expect(
      first.data?.qualifierBoard?.matches.map(
        (match) => match.viewerRestriction,
      ),
    ).toEqual(['EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED']);
    expect(
      second.data?.qualifierBoard?.matches.map(
        (match) => match.viewerRestriction,
      ),
    ).toEqual(['ACCOUNT_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE']);
  });
});

describe('qualifierBoard: 時刻による切り替え', () => {
  test('業務時刻の23:40からは結果の表示に切り替え、確定前の予選は集計中として返す', async () => {
    await seedBoard();
    await completePairingDay();
    setMatchTestNow(ENDS_AT);

    const response = await fetchQualifierBoard();

    const board = response.data?.qualifierBoard;
    expect(response.errors).toBeUndefined();
    expect(board?.phase).toBe('RESULT');
    expect(board?.serverTime).toBe(ENDS_AT.toISOString());
    expect(board?.nextKickoffAt).toBe(NEXT_KICKOFF_AT);
    expect(
      board?.matches.map(({ id, phase, viewerRestriction }) => ({
        id,
        phase,
        viewerRestriction,
      })),
    ).toEqual([
      {
        id: matchIdOf(1),
        phase: 'TALLYING',
        viewerRestriction: 'NOT_ACCEPTING',
      },
      {
        id: matchIdOf(2),
        phase: 'TALLYING',
        viewerRestriction: 'NOT_ACCEPTING',
      },
    ]);
  });

  test('確定した予選は決着と側の結果を返す', async () => {
    await insertUser(OWNER_A);
    await insertUser(OWNER_B);
    await insertProduct(1, OWNER_A);
    await insertProduct(3, OWNER_B);
    await insertMatches([
      {
        index: 1,
        columns: {
          startedAt: STARTS_AT,
          decidedAt: ENDS_AT,
          decision: 'last_upvote',
        },
        entries: [
          side(11, 1, OWNER_A, { upvoteCount: 7, result: 'won' }),
          side(12, 3, OWNER_B, { upvoteCount: 7, result: 'lost' }),
        ],
      },
    ]);
    await completePairingDay();
    setMatchTestNow(new Date(ENDS_AT.getTime() + 60_000));

    const response = await fetchQualifierBoard();

    const [match] = response.data?.qualifierBoard?.matches ?? [];
    expect(response.errors).toBeUndefined();
    expect(match?.phase).toBe('FINISHED');
    expect(match?.decision).toBe('LAST_UPVOTE');
    expect(
      match?.entries.map(({ result, upvoteCount }) => ({
        result,
        upvoteCount,
      })),
    ).toEqual([
      { result: 'WON', upvoteCount: 7 },
      { result: 'LOST', upvoteCount: 7 },
    ]);
  });

  test('開始の待ちは、ペアリングの未完了か開始の日時を過ぎた未開始の予選がある間だけ真にする', async () => {
    await insertUser(OWNER_A);
    await insertProduct(1, OWNER_A);
    await insertMatches([
      {
        index: 1,
        columns: { startedAt: STARTS_AT },
        entries: [side(11, 1, OWNER_A)],
      },
    ]);

    const unpaired = await fetchQualifierBoard();
    await completePairingDay();
    const paired = await fetchQualifierBoard();
    await insertMatches([{ index: 2, entries: [side(21, 1, OWNER_A)] }]);
    const notStarted = await fetchQualifierBoard();

    expect(unpaired.data?.qualifierBoard?.awaitingKickoff).toBe(true);
    expect(paired.data?.qualifierBoard?.awaitingKickoff).toBe(false);
    expect(notStarted.data?.qualifierBoard?.awaitingKickoff).toBe(true);
  });
});
