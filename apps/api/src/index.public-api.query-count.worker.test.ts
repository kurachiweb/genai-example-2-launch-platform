import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  insertQualifiers,
  winOf,
} from '../lib/workers/directory/testing/directory-listing-fixtures.ts';
import { insertComments } from '../lib/workers/engagement/testing/engagement-fixtures.ts';
import { insertUpvotes } from '../lib/workers/match/testing/match-fixtures.ts';
import {
  insertProduct,
  insertUsers,
  T0,
} from '../lib/workers/product/testing/product-fixtures.ts';
import { callPublic } from '../test/support/gateway-test-harness.ts';
import {
  ALL_SCOPES,
  commentOf,
  createPublicApiRouteCaller,
  DECIDED_DATE,
  DECIDED_MATCH,
  LISTED,
  OWNER,
  PUBLIC_ROUTES,
  RIVAL_PRODUCT,
  type RouteCase,
  routeLabelOf,
  seedWorld,
  supporterUpvoteOf,
  VOTER,
} from '../test/support/public-api-route-cases.ts';

const { createKeyHolder, routeRequest } = createPublicApiRouteCaller({
  firstHolderIndex: 3000,
  ipGroup: 3,
});

beforeAll(seedWorld);

interface CountingDatabase {
  readonly database: D1Database;
  readonly statements: readonly string[];
}

// D1へ渡した文を数えるため、prepareだけを記録してテスト用のD1へそのまま渡す
function countingDatabase(): CountingDatabase {
  const d1 = env.DB;
  const statements: string[] = [];
  return {
    statements,
    database: {
      prepare: (query) => {
        statements.push(query);
        return d1.prepare(query);
      },
      batch: d1.batch.bind(d1),
      exec: d1.exec.bind(d1),
      withSession: d1.withSession.bind(d1),
      // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      dump: d1.dump.bind(d1),
    },
  };
}

interface ListMeasurement {
  readonly items: number;
  readonly statements: number;
}

interface ListBody {
  readonly data: readonly unknown[];
}

async function measureList(
  route: RouteCase,
  authorization: string,
): Promise<ListMeasurement> {
  const counting = countingDatabase();
  const response = await callPublic(routeRequest(route, authorization), {
    DB: counting.database,
  });
  expect.soft(response.status, routeLabelOf(route)).toBe(200);
  const body: ListBody = await response.json();
  return { items: body.data.length, statements: counting.statements.length };
}

const PERF_OWNERS = [21, 22, 23, 24, 25];
const PERF_MATCHES = [21, 22, 23, 24, 25];
const PERF_LISTED_LAUNCH_MATCHES = [31, 32, 33];
const PERF_PARTICIPANTS = [41, 42, 43, 44, 45];
const PERF_DATE = '2026-11-06';

// 別の投稿者の掲載中のプロダクト5件、プロダクト1のローンチ3件、プロダクト1の側への5人のUpvote、利用者3の5件のUpvote、5人のコメントを加える
async function addItems(): Promise<void> {
  await insertUsers([...PERF_OWNERS, ...PERF_PARTICIPANTS], {
    emailVerifiedAt: T0,
  });
  for (const owner of PERF_OWNERS) {
    await insertProduct(owner, owner);
  }
  await insertQualifiers([
    ...PERF_MATCHES.map((match, position) =>
      winOf(match, {
        product: PERF_OWNERS[position] ?? 0,
        owner: PERF_OWNERS[position] ?? 0,
        date: PERF_DATE,
        opponent: RIVAL_PRODUCT,
      }),
    ),
    ...PERF_LISTED_LAUNCH_MATCHES.map((match, position) =>
      winOf(match, {
        product: LISTED,
        owner: OWNER,
        date: `2026-11-0${String(7 + position)}`,
        opponent: RIVAL_PRODUCT,
      }),
    ),
  ]);
  await insertUpvotes([
    ...PERF_PARTICIPANTS.map((user, position) =>
      supporterUpvoteOf(101 + position, user, DECIDED_MATCH, DECIDED_DATE),
    ),
    ...PERF_MATCHES.map((match, position) =>
      supporterUpvoteOf(201 + position, VOTER, match, PERF_DATE),
    ),
  ]);
  await insertComments(
    PERF_PARTICIPANTS.map((user, position) => commentOf(101 + position, user)),
  );
}

describe('公開データの照会の回数(既定のエクスポートの組み立て)', () => {
  const LIST_ROUTES = PUBLIC_ROUTES.filter(({ template }) =>
    [
      '/products',
      '/products/{handle}/launches',
      '/products/{handle}/matches/{match_id}/supporters',
      '/users/{handle}/upvotes',
      '/products/{handle}/launches/{launch_id}/comments',
    ].includes(template),
  );

  test('一覧の5経路は、項目の数を増やしてもD1へ渡す文の数が変わらない', async () => {
    const { authorization } = await createKeyHolder(ALL_SCOPES);
    const before: ListMeasurement[] = [];
    for (const route of LIST_ROUTES) {
      before.push(await measureList(route, authorization));
    }

    await addItems();
    const after: ListMeasurement[] = [];
    for (const route of LIST_ROUTES) {
      after.push(await measureList(route, authorization));
    }

    expect(LIST_ROUTES).toHaveLength(5);
    expect(before.map(({ items }) => items)).toStrictEqual([1, 1, 1, 1, 1]);
    expect(after.map(({ items }) => items)).toStrictEqual([6, 4, 6, 6, 6]);
    expect(before.every(({ statements }) => statements > 0)).toBe(true);
    expect(after.map(({ statements }) => statements)).toStrictEqual(
      before.map(({ statements }) => statements),
    );
  });
});
