import { beforeEach, describe, expect, test } from 'vitest';

import { kickoffAt } from '../../../../../lib/core/product/launch-status.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import {
  insertQualifiers,
  qualifierLaunchOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  entryIdOf,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertScreenshot,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  answerDirectoryLaunchSummaries,
  fetchProductPage,
  installDirectoryGraphQLTest,
  issueDirectoryUserSession,
} from '../../../../../test/support/directory-graphql-operations.ts';
import type { ProductPageFields } from '../../../../../test/support/directory-product-page-documents.ts';
import { codesOf } from '../../../../../test/support/product-graphql-operations.ts';

installDirectoryGraphQLTest();

const OWNER = 1;
const RIVAL = 2;
const VIEWER = 3;

const LISTED = 1;
const UNLISTED_RIVAL = 2;
const LISTED_RIVAL = 3;
const HIDDEN_RIVAL = 4;
const HIDDEN_LISTED = 5;

const TOOLS = 1;

const SCHEDULED_LAUNCH = 98;
const CANCELED_LAUNCH = 99;

// プロダクト1の履歴: 11/05に未掲載の相手へ勝利、11/03に不戦勝、11/01に掲載中の相手へ敗北、10/30に非公開の相手へ敗北。取消と予定のローンチも持つ
async function seedProductPage(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(RIVAL);
  await insertUser(VIEWER);
  await insertCategory(TOOLS);
  await insertFile(1, { ownerId: userIdOf(OWNER) });
  await insertFile(2, { ownerId: userIdOf(OWNER) });
  await insertFile(3, { ownerId: userIdOf(OWNER) });
  await insertFile(4, { ownerId: userIdOf(RIVAL) });
  await insertProduct(LISTED, OWNER, {
    name: 'Rocketship',
    categoryId: categoryIdOf(TOOLS),
    logoFileId: fileIdOf(1),
    descriptionMarkdown: '# Rocketship\n\n宇宙へ。',
  });
  await insertScreenshot(1, LISTED, 2, fileIdOf(3));
  await insertScreenshot(2, LISTED, 1, fileIdOf(2));
  await insertProduct(UNLISTED_RIVAL, RIVAL, { name: 'Unlisted Rival' });
  await insertProduct(LISTED_RIVAL, RIVAL, {
    name: 'Listed Rival',
    logoFileId: fileIdOf(4),
  });
  await insertProduct(HIDDEN_RIVAL, RIVAL, { name: 'Hidden', hiddenAt: T0 });
  await insertProduct(HIDDEN_LISTED, OWNER, { hiddenAt: T0 });
  await insertQualifiers([
    {
      match: 1,
      date: '2026-11-05',
      sides: [
        { product: LISTED, owner: OWNER, result: 'won', upvotes: 12 },
        { product: UNLISTED_RIVAL, owner: RIVAL, result: 'lost', upvotes: 9 },
      ],
    },
    {
      match: 2,
      date: '2026-11-03',
      decision: 'bye',
      sides: [{ product: LISTED, owner: OWNER, result: 'bye' }],
    },
    {
      match: 3,
      date: '2026-11-01',
      decision: 'last_upvote',
      sides: [
        { product: LISTED, owner: OWNER, result: 'lost', upvotes: 4 },
        { product: LISTED_RIVAL, owner: RIVAL, result: 'won', upvotes: 4 },
      ],
    },
    {
      match: 4,
      date: '2026-10-30',
      sides: [
        { product: LISTED, owner: OWNER, result: 'lost', upvotes: 0 },
        { product: HIDDEN_RIVAL, owner: RIVAL, result: 'won', upvotes: 2 },
      ],
    },
    {
      match: 5,
      date: '2026-10-28',
      sides: [
        { product: HIDDEN_LISTED, owner: OWNER, result: 'won', upvotes: 1 },
      ],
    },
  ]);
  await insertLaunch(SCHEDULED_LAUNCH, LISTED, { launchDate: '2026-11-25' });
  await insertLaunch(CANCELED_LAUNCH, LISTED, {
    launchDate: '2026-11-08',
    cancelledAt: T0,
  });
}

const pageOf = (
  result:
    ProductPageFields | { readonly __typename: string } | null | undefined,
): ProductPageFields => {
  if (result?.__typename !== 'ProductPage') {
    throw new Error('プロダクト詳細ページが返っていない');
  }
  return result as ProductPageFields;
};

const kickoffIsoOf = (date: string): string =>
  kickoffAt(parseBusinessDate(date)).toISOString();

describe('productPage: 公開範囲とハンドル', () => {
  beforeEach(seedProductPage);

  test.each([
    ['存在しないハンドル', 'missing-product'],
    ['形式に合わないハンドル', '-invalid-'],
    ['未掲載の他者のプロダクト', 'product2'],
    ['非公開化したプロダクト', 'product5'],
  ])('%sはnullを返す', async (_name, handle) => {
    const response = await fetchProductPage(handle);

    expect(response.errors).toBeUndefined();
    expect(response.data?.productPage).toBeNull();
  });

  test('非公開化したプロダクトは投稿者本人にもnullを返す', async () => {
    const token = await issueDirectoryUserSession(OWNER);

    const response = await fetchProductPage('product5', {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productPage).toBeNull();
  });

  test('未掲載のプロダクトを投稿者本人には本人の印と未掲載の印を付けて返す', async () => {
    const token = await issueDirectoryUserSession(RIVAL);

    const response = await fetchProductPage('product2', {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(pageOf(response.data?.productPage)).toMatchObject({
      handle: 'product2',
      viewerIsOwner: true,
      listed: false,
    });
  });

  test('大文字小文字の違うハンドルは転送せずに現在のハンドルで返す', async () => {
    const response = await fetchProductPage('PRODUCT1');

    expect(response.errors).toBeUndefined();
    expect(pageOf(response.data?.productPage)).toMatchObject({
      handle: 'product1',
      viewerIsOwner: false,
      listed: true,
    });
  });

  test('表示できるプロダクトの旧ハンドルは転送先の現在のハンドルを返す', async () => {
    await insertProductPreviousHandle(1, LISTED, 'old-rocketship');

    const response = await fetchProductPage('Old-Rocketship');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productPage).toEqual({
      __typename: 'ProductPageRedirect',
      handle: 'product1',
    });
  });

  test('表示できないプロダクトの旧ハンドルは転送せずにnullを返す', async () => {
    await insertProductPreviousHandle(1, UNLISTED_RIVAL, 'old-unlisted');

    const response = await fetchProductPage('old-unlisted');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productPage).toBeNull();
  });
});

describe('productPage: ページの内容', () => {
  beforeEach(seedProductPage);

  test('ヘッダー・スクリーンショット・説明文・受賞・成績を返す', async () => {
    answerDirectoryLaunchSummaries({
      launches: [],
      awards: [
        {
          productId: productIdOf(LISTED),
          kind: 'week',
          label: '2026年11月第1週',
        },
      ],
    });

    const response = await fetchProductPage('product1');

    expect(response.errors).toBeUndefined();
    const page = pageOf(response.data?.productPage);
    expect(page).toMatchObject({
      id: productIdOf(LISTED),
      handle: 'product1',
      name: 'Rocketship',
      tagline: 'タグライン1',
      category: {
        id: categoryIdOf(TOOLS),
        name: 'カテゴリ1',
        handle: 'category1',
        systemDefault: false,
      },
      websiteUrl: 'https://product1.example/',
      logo: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
      description: '# Rocketship\n\n宇宙へ。',
      screenshots: [
        {
          fileId: fileIdOf(2),
          image: { id: fileIdOf(2), objectKey: objectKeyOf(2) },
        },
        {
          fileId: fileIdOf(3),
          image: { id: fileIdOf(3), objectKey: objectKeyOf(3) },
        },
      ],
      owner: { handle: 'user1', nickname: '利用者1', avatar: null },
      viewerIsOwner: false,
      listed: true,
      awards: [{ kind: 'WEEK', count: 1, labels: ['2026年11月第1週'] }],
      record: {
        firstLaunchDate: '2026-10-30',
        launchCount: 4,
        wins: 2,
        losses: 2,
      },
    });
  });

  test('検証の済まない外部WebサイトURLは空にする', async () => {
    await insertProduct(6, VIEWER, { websiteUrl: 'javascript:alert(1)' });
    const token = await issueDirectoryUserSession(VIEWER);

    const response = await fetchProductPage('product6', {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(pageOf(response.data?.productPage).websiteUrl).toBe('');
  });

  test('取消を除くローンチを新しい順に、要約・キックオフ済みの印と結果が確定したマッチの行とともに返す', async () => {
    answerDirectoryLaunchSummaries({
      launches: [
        {
          launchId: launchIdOf(qualifierLaunchOf(1)),
          label: 'Week 準決勝進出',
          inMatch: false,
          rank: 1,
        },
      ],
      awards: [],
    });

    const response = await fetchProductPage('product1');

    expect(response.errors).toBeUndefined();
    const { launches } = pageOf(response.data?.productPage);
    expect(
      launches.map(({ matches, ...launch }) => ({
        ...launch,
        matchIds: matches.map(({ id }) => id),
      })),
    ).toEqual([
      {
        id: launchIdOf(SCHEDULED_LAUNCH),
        number: 5,
        launchDate: '2026-11-25',
        kickoffAt: kickoffIsoOf('2026-11-25'),
        status: 'SCHEDULED',
        summary: { label: 'キックオフ予定', inMatch: false },
        kickedOff: false,
        latestKickedOff: false,
        matchIds: [],
      },
      {
        id: launchIdOf(qualifierLaunchOf(1)),
        number: 4,
        launchDate: '2026-11-05',
        kickoffAt: kickoffIsoOf('2026-11-05'),
        status: 'FINISHED',
        summary: { label: 'Week 準決勝進出', inMatch: false },
        kickedOff: true,
        latestKickedOff: true,
        matchIds: [matchIdOf(1)],
      },
      {
        id: launchIdOf(qualifierLaunchOf(2)),
        number: 3,
        launchDate: '2026-11-03',
        kickoffAt: kickoffIsoOf('2026-11-03'),
        status: 'FINISHED',
        summary: { label: 'ディレクトリ掲載', inMatch: false },
        kickedOff: true,
        latestKickedOff: false,
        matchIds: [matchIdOf(2)],
      },
      {
        id: launchIdOf(qualifierLaunchOf(3)),
        number: 2,
        launchDate: '2026-11-01',
        kickoffAt: kickoffIsoOf('2026-11-01'),
        status: 'FINISHED',
        summary: { label: '予選敗北', inMatch: false },
        kickedOff: true,
        latestKickedOff: false,
        matchIds: [matchIdOf(3)],
      },
      {
        id: launchIdOf(qualifierLaunchOf(4)),
        number: 1,
        launchDate: '2026-10-30',
        kickoffAt: kickoffIsoOf('2026-10-30'),
        status: 'FINISHED',
        summary: { label: '予選敗北', inMatch: false },
        kickedOff: true,
        latestKickedOff: false,
        matchIds: [matchIdOf(4)],
      },
    ]);
  });

  test('マッチ履歴の行に自分の側・スコア・勝敗と対戦相手の4つの見え方を返す', async () => {
    const response = await fetchProductPage('product1');

    expect(response.errors).toBeUndefined();
    const matches = pageOf(response.data?.productPage).launches.flatMap(
      (launch) => launch.matches,
    );
    expect(matches).toEqual([
      {
        id: matchIdOf(1),
        entryId: entryIdOf(qualifierLaunchOf(1)),
        kind: 'QUALIFIER',
        round: null,
        stage: null,
        date: '2026-11-05',
        result: 'WON',
        decision: 'VOTES',
        endedEarly: false,
        ownUpvoteCount: 12,
        opponentUpvoteCount: 9,
        opponent: {
          kind: 'UNLISTED',
          handle: null,
          name: 'Unlisted Rival',
          logo: null,
        },
      },
      {
        id: matchIdOf(2),
        entryId: entryIdOf(qualifierLaunchOf(2)),
        kind: 'QUALIFIER',
        round: null,
        stage: null,
        date: '2026-11-03',
        result: 'BYE',
        decision: 'BYE',
        endedEarly: false,
        ownUpvoteCount: 0,
        opponentUpvoteCount: null,
        opponent: { kind: 'NONE', handle: null, name: null, logo: null },
      },
      {
        id: matchIdOf(3),
        entryId: entryIdOf(qualifierLaunchOf(3)),
        kind: 'QUALIFIER',
        round: null,
        stage: null,
        date: '2026-11-01',
        result: 'LOST',
        decision: 'LAST_UPVOTE',
        endedEarly: false,
        ownUpvoteCount: 4,
        opponentUpvoteCount: 4,
        opponent: {
          kind: 'LISTED',
          handle: 'product3',
          name: 'Listed Rival',
          logo: { id: fileIdOf(4), objectKey: objectKeyOf(4) },
        },
      },
      {
        id: matchIdOf(4),
        entryId: entryIdOf(qualifierLaunchOf(4)),
        kind: 'QUALIFIER',
        round: null,
        stage: null,
        date: '2026-10-30',
        result: 'LOST',
        decision: 'VOTES',
        endedEarly: false,
        ownUpvoteCount: 0,
        opponentUpvoteCount: 2,
        opponent: { kind: 'PRIVATE', handle: null, name: null, logo: null },
      },
    ]);
  });
});

describe('productPage: 呼び出し元', () => {
  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchProductPage('product1', { caller: 'admin' });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toEqual({ productPage: null });
  });
});
