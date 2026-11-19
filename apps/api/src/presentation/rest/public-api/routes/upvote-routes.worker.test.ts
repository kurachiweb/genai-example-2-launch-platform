import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { apiKeys } from '../../../../../db/schema/public-api/api-keys.ts';
import { products } from '../../../../../db/schema/product/products.ts';
import { userPreviousHandles } from '../../../../../db/schema/profile/user-previous-handles.ts';
import { PRODUCT_LOGO_PURPOSE } from '../../../../../common-lib/product/product-input-rules.ts';
import { createKeyedHasher } from '../../../../../lib/core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../../../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { encodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  qualifierLaunchOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import { insertPreviousHandle } from '../../../../../lib/workers/handles/testing/handle-fixtures.ts';
import type { PlatformHonoEnv } from '../../../../../lib/workers/http/hono-env.ts';
import {
  DECIDED_AT,
  DURING_MATCH,
  ENDS_AT,
  STARTS_AT,
} from '../../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatches,
  insertUpvotes,
  MATCH_DATE,
  type MatchFixture,
  matchIdOf,
  type UpvoteFixture,
  upvoteIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  insertUsers,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { insertApiKey } from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { D1UserProfileDirectory } from '../../../../../lib/workers/profile/d1-user-profile-directory.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import { StoreUpvoteHistoryReader } from '../../../../application/match/upvote-history-reader.ts';
import { API_KEY_HASH_PURPOSE } from '../../../../domain/public-api/api-key-token.ts';
import {
  OTHER_VOTER,
  OWNER_A,
  OWNER_B,
  secondsAfterStart,
  seedUpvoteParticipants,
  SUSPENDED,
  twoSidedMatch,
  VOTER,
  WITHDRAWN,
} from '../../../../infrastructure/match/testing/upvote-store-fixtures.ts';
import { publicApiUpvoteRoutes } from './upvote-routes.ts';

// マッチの状態がテストの実行の時刻で変わらないよう時計を固定する
const testClock: Clock = { now: () => DURING_MATCH };

const testModule: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'public-api-upvote-routes-test',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

const harness = createPublicApiRestHarness(
  [publicApiUpvoteRoutes],
  [testModule],
);

const hasher = createKeyedHasher(env.HASH_PEPPER);

const SITE_ORIGIN = env.CLIENT_SITE_ORIGIN;

const IMAGES_ORIGIN = env.IMAGES_ORIGIN;

const INVALID_CURSORS: readonly (readonly [string, string])[] = [
  ['base64urlでない', 'not a cursor!'],
  ['空の', ''],
  ['復号できるが上限の256文字を超える', encodeCursor({ id: 'a'.repeat(256) })],
];

// 利用者単位の回数の記録はテストの間で消せないため、テストごとに別の利用者とキーを使う
let nextHolderIndex = 700;

let authorization: string;

async function createKeyHolder(): Promise<string> {
  const index = nextHolderIndex;
  nextHolderIndex += 1;
  const plain = `lsk_${String(index).padStart(43, 'x')}`;
  await insertUser(index);
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
  });
  return `Bearer ${plain}`;
}

function get(path: string) {
  return harness.request(path, { headers: { Authorization: authorization } });
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

async function errorCodeOf(response: Response): Promise<string> {
  const body: ErrorBody = await response.json();
  return body.error.code;
}

interface CursorMeta {
  readonly has_next: boolean;
  readonly next_cursor: string | null;
}

interface SupporterBody {
  readonly data: readonly {
    readonly user: { readonly handle: string };
    readonly upvoted_at: string;
  }[];
  readonly meta: CursorMeta;
}

async function clearTables(): Promise<void> {
  await db.delete(apiKeys);
  await db.delete(userPreviousHandles);
  await clearMediaTables();
  await clearDirectoryTables();
}

beforeEach(clearTables);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /products/{handle}/matches/{match_id}/supporters', () => {
  const OWNER = 1;
  const RIVAL = 2;
  const THIRD_OWNER = 3;
  const SUSPENDED_SUPPORTER = 50;
  const WITHDRAWN_SUPPORTER = 51;
  const OPPONENT_SUPPORTER = 52;
  const CANCELED_SUPPORTER = 53;
  const SUPPORTERS = Array.from({ length: 21 }, (_, offset) => 10 + offset);

  const LISTED = 1;
  const UNLISTED = 2;
  const THIRD = 3;

  const DECIDED_MATCH = 1;
  const OTHERS_MATCH = 2;
  const LIVE_MATCH = 3;

  const DECIDED_DATE = '2026-11-05';
  const UPVOTE_BASE = Date.parse('2026-11-05T03:00:00.000Z');

  // 利用者の番号の順とUpvoteの日時の順が一致しないよう、7分刻みを21で割った余りの分だけずらす
  const minuteOffsetOf = (position: number): number => (position * 7) % 21;

  const upvotedAtOf = (minute: number): Date =>
    new Date(UPVOTE_BASE + minute * 60_000);

  const upvoteOf = (
    index: number,
    user: number,
    minute: number,
    entry: number = qualifierLaunchOf(DECIDED_MATCH),
    columns: UpvoteFixture['columns'] = {},
  ): UpvoteFixture => ({
    index,
    match: DECIDED_MATCH,
    entry,
    user,
    upvotedAt: upvotedAtOf(minute),
    columns: { matchDate: DECIDED_DATE, ...columns },
  });

  const ordered = SUPPORTERS.map((user, position) => ({
    user,
    index: position + 1,
    minute: 30 + minuteOffsetOf(position),
  })).toSorted((first, second) => first.minute - second.minute);

  const PATH = `/products/product${String(LISTED)}/matches/${matchIdOf(DECIDED_MATCH)}/supporters`;

  // 掲載中のプロダクト1は11/05の予選で未掲載のプロダクト2に勝った。プロダクト1の側に可視の21人と、停止中・退会済み・取り消しの利用者がUpvoteしている。プロダクト1は11/20の予選を開催中
  async function seedSupporters(): Promise<void> {
    authorization = await createKeyHolder();
    await insertUser(OWNER, { nickname: 'アリス', handle: 'alice' });
    await insertUser(RIVAL);
    await insertUser(THIRD_OWNER);
    await insertUsers(SUPPORTERS);
    await insertUser(SUSPENDED_SUPPORTER, {
      status: 'suspended',
      suspendedAt: T0,
    });
    await insertUser(WITHDRAWN_SUPPORTER, { deletedAt: T0 });
    await insertUser(OPPONENT_SUPPORTER);
    await insertUser(CANCELED_SUPPORTER);
    await insertProduct(LISTED, OWNER);
    await insertProductPreviousHandle(1, LISTED, 'old-product1');
    await insertProduct(UNLISTED, RIVAL);
    await insertProduct(THIRD, THIRD_OWNER);
    await insertQualifiers([
      {
        match: DECIDED_MATCH,
        date: DECIDED_DATE,
        sides: [
          { product: LISTED, owner: OWNER, result: 'won', upvotes: 21 },
          { product: UNLISTED, owner: RIVAL, result: 'lost', upvotes: 1 },
        ],
      },
      {
        match: OTHERS_MATCH,
        date: DECIDED_DATE,
        sides: [
          { product: UNLISTED, owner: RIVAL, result: 'lost', upvotes: 1 },
          { product: THIRD, owner: THIRD_OWNER, result: 'won', upvotes: 2 },
        ],
      },
      {
        match: LIVE_MATCH,
        date: MATCH_DATE,
        sides: [
          { product: LISTED, owner: OWNER, result: null },
          { product: THIRD, owner: THIRD_OWNER, result: null },
        ],
      },
    ]);
    await insertUpvotes([
      ...ordered.map(({ user, index, minute }) =>
        upvoteOf(index, user, minute),
      ),
      upvoteOf(31, SUSPENDED_SUPPORTER, 1),
      upvoteOf(32, WITHDRAWN_SUPPORTER, 2),
      upvoteOf(33, CANCELED_SUPPORTER, 3, undefined, { deletedAt: T0 }),
      upvoteOf(34, OPPONENT_SUPPORTER, 4, qualifierLaunchOf(DECIDED_MATCH, 1)),
    ]);
  }

  beforeEach(seedSupporters);

  test('退会・停止・取り消しと相手の側を除き、Upvoteの日時の早い順に表示情報と日時を20件ずつ返し、画面と同じ形の続きのカーソルで次のページを返す', async () => {
    const first = await get(PATH);

    expect(first.status).toBe(200);
    const firstBody: SupporterBody = await first.json();
    expect(firstBody.data.map(({ user }) => user.handle)).toEqual(
      ordered.slice(0, 20).map(({ user }) => `user${String(user)}`),
    );
    const head = ordered[0];
    expect(firstBody.data[0]).toEqual({
      user: {
        handle: `user${String(head?.user)}`,
        nickname: `利用者${String(head?.user)}`,
        avatar: null,
        profile_url: `${SITE_ORIGIN}/@user${String(head?.user)}`,
      },
      upvoted_at: upvotedAtOf(head?.minute ?? 0).toISOString(),
    });
    const last = ordered[19];
    expect(firstBody.meta).toEqual({
      has_next: true,
      next_cursor: encodeCursor({
        upvotedAt: upvotedAtOf(last?.minute ?? 0).getTime(),
        upvoteId: upvoteIdOf(last?.index ?? 0),
      }),
    });

    const second = await get(
      `${PATH}?cursor=${firstBody.meta.next_cursor ?? ''}`,
    );

    expect(second.status).toBe(200);
    const secondBody: SupporterBody = await second.json();
    expect(secondBody.data.map(({ user }) => user.handle)).toEqual([
      `user${String(ordered[20]?.user)}`,
    ]);
    expect(secondBody.meta.has_next).toBe(false);
    expect(secondBody.meta.next_cursor).toEqual(expect.any(String));
  });

  test('一覧の後に退会した利用者は表示情報を読めないため一覧から除く', async () => {
    const head = ordered[0];
    const original = D1UserProfileDirectory.prototype.findSummaries.bind(
      new D1UserProfileDirectory(db),
    );
    vi.spyOn(
      D1UserProfileDirectory.prototype,
      'findSummaries',
    ).mockImplementation(async (ids, scope) => {
      const found = await original(ids, scope);
      return new Map(
        [...found].filter(([id]) => id !== userIdOf(head?.user ?? 0)),
      );
    });

    const response = await get(PATH);

    const body: SupporterBody = await response.json();
    expect(body.data).toHaveLength(19);
    expect(body.data.map(({ user }) => user.handle)).not.toContain(
      `user${String(head?.user)}`,
    );
  });

  test('旧ハンドルは現在のハンドルの同じ経路へカーソルを保って302で転送する', async () => {
    const cursor = encodeCursor({
      upvotedAt: UPVOTE_BASE,
      upvoteId: upvoteIdOf(1),
    });

    const response = await get(
      `/products/old-product1/matches/${matchIdOf(DECIDED_MATCH)}/supporters?cursor=${cursor}`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `https://api.launch.example/v1${PATH}?cursor=${cursor}`,
    );
  });

  test.each([
    ['存在しない', 'missing-product'],
    ['形式に合わない', '-invalid-'],
    ['未掲載の', `product${String(UNLISTED)}`],
  ])('%sプロダクトは404(product_not_found)を返す', async (_name, handle) => {
    const response = await get(
      `/products/${handle}/matches/${matchIdOf(DECIDED_MATCH)}/supporters`,
    );

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('product_not_found');
  });

  test.each([
    ['存在しない', matchIdOf(99)],
    ['形式に合わない', 'not-a-match'],
    ['他のプロダクトの', matchIdOf(OTHERS_MATCH)],
    ['結果が確定していない', matchIdOf(LIVE_MATCH)],
  ])('%sマッチは404(match_not_found)を返す', async (_name, matchId) => {
    const response = await get(
      `/products/product${String(LISTED)}/matches/${matchId}/supporters`,
    );

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('match_not_found');
  });

  test.each<readonly [string, string]>([
    ...INVALID_CURSORS,
    ['位置の形でない', encodeCursor({ x: 1 })],
    [
      'IDが小文字の',
      encodeCursor({
        upvotedAt: 1,
        upvoteId: upvoteIdOf(1).toLowerCase(),
      }),
    ],
    ['時刻が負の', encodeCursor({ upvotedAt: -1, upvoteId: upvoteIdOf(1) })],
  ])('%sカーソルは400(invalid_cursor)を返す', async (_name, cursor) => {
    const response = await get(`${PATH}?cursor=${encodeURIComponent(cursor)}`);

    expect(response.status).toBe(400);
    expect(await errorCodeOf(response)).toBe('invalid_cursor');
  });

  test('位置の形に合っても上限の256文字を超えるカーソルは400(invalid_cursor)を返す', async () => {
    const position = { upvotedAt: UPVOTE_BASE, upvoteId: upvoteIdOf(1) };
    const padded = encodeCursor({ ...position, pad: 'a'.repeat(256) });

    const accepted = await get(`${PATH}?cursor=${encodeCursor(position)}`);
    const rejected = await get(`${PATH}?cursor=${padded}`);

    expect(padded.length).toBeGreaterThan(256);
    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(await errorCodeOf(rejected)).toBe('invalid_cursor');
  });

  test('Upvoteの権限の無いキーは403(insufficient_scope)を返す', async () => {
    const index = nextHolderIndex;
    nextHolderIndex += 1;
    const plain = `lsk_${String(index).padStart(43, 'y')}`;
    await insertUser(index);
    await insertApiKey(index, index, {
      keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
      scopeUpvotes: 'none',
    });

    const response = await harness.request(PATH, {
      headers: { Authorization: `Bearer ${plain}` },
    });

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe('insufficient_scope');
  });
});

describe('GET /users/{handle}/upvotes', () => {
  const VOTER_HANDLE = `user${String(VOTER)}`;
  const PREVIOUS_DATE = '2026-11-19';
  const HIDDEN = 4;
  const DELETED = 5;

  interface HistoryBody {
    readonly data: readonly {
      readonly match_id: string;
      readonly product: { readonly handle: string };
    }[];
    readonly meta: CursorMeta & { readonly total: number };
  }

  const dayBefore = (date: Date) => new Date(date.getTime() - 86_400_000);

  // 前日に確定したWeekの準決勝。投稿者Aのプロダクト1の側と、投稿者Bのプロダクト3の側
  const settledWeekMatch = (index: number): MatchFixture =>
    twoSidedMatch(index, {
      kind: 'week',
      round: 2,
      stage: 'semifinal',
      matchDate: PREVIOUS_DATE,
      startsAt: dayBefore(STARTS_AT),
      endsAt: dayBefore(ENDS_AT),
      startedAt: dayBefore(STARTS_AT),
      decidedAt: dayBefore(DECIDED_AT),
      decision: 'votes',
    });

  // 投稿者Aのプロダクト1の側と、投稿者Bのプロダクトproductの側を持つ開催中の予選
  const matchAgainst = (index: number, product: number): MatchFixture => ({
    index,
    columns: { startedAt: STARTS_AT },
    entries: [
      { index: index * 10 + 1, launch: null, product: 1, owner: OWNER_A },
      { index: index * 10 + 2, launch: null, product, owner: OWNER_B },
    ],
  });

  // 利用者userのマッチmatchの側slot(1は投稿者A、2は投稿者B)へのUpvote
  const upvoteOf = (
    index: number,
    match: number,
    slot: 1 | 2,
    user: number,
    date: string = MATCH_DATE,
  ): UpvoteFixture => ({
    index,
    match,
    entry: match * 10 + slot,
    user,
    upvotedAt: secondsAfterStart(index),
    columns: { matchDate: date },
  });

  // プロダクト1は配信できるロゴ・予選の勝利で掲載済み、プロダクト3は未掲載、プロダクト4は非公開化、プロダクト5は論理削除
  async function seedHistory(): Promise<void> {
    await seedUpvoteParticipants();
    authorization = await createKeyHolder();
    await insertFile(1, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(OWNER_A),
    });
    await insertLaunch(2, 1, { launchDate: '2026-11-01', outcome: 'won' });
    await db
      .update(products)
      .set({ logoFileId: fileIdOf(1) })
      .where(eq(products.id, productIdOf(1)));
    await insertProduct(HIDDEN, OWNER_B, { hiddenAt: T0 });
    await insertProduct(DELETED, OWNER_B, { deletedAt: T0 });
  }

  beforeEach(seedHistory);

  test('有効なUpvoteを新しい順に、種別・段階・実施日・開催中かどうか・未掲載を含むプロダクトとともに返し、非公開化・論理削除のプロダクトを除いた総件数を返す', async () => {
    await insertMatches([
      twoSidedMatch(1, { startedAt: STARTS_AT }),
      matchAgainst(2, HIDDEN),
      matchAgainst(3, DELETED),
      settledWeekMatch(4),
      twoSidedMatch(5, { startedAt: STARTS_AT }),
    ]);
    await insertUpvotes([
      upvoteOf(1, 1, 1, VOTER),
      upvoteOf(2, 2, 2, VOTER),
      upvoteOf(3, 3, 2, VOTER),
      upvoteOf(4, 4, 2, VOTER, PREVIOUS_DATE),
      upvoteOf(5, 5, 1, OTHER_VOTER),
      { ...upvoteOf(6, 5, 1, VOTER), columns: { deletedAt: T0 } },
    ]);

    const response = await get(`/users/${VOTER_HANDLE}/upvotes`);

    expect(response.status).toBe(200);
    const body: HistoryBody = await response.json();
    expect(body.meta.next_cursor).toEqual(expect.any(String));
    expect(body).toEqual({
      data: [
        {
          match_id: matchIdOf(1),
          kind: 'qualifier',
          round: null,
          stage: null,
          match_date: MATCH_DATE,
          live: true,
          product: {
            handle: 'product1',
            name: 'プロダクト1',
            logo: {
              url: `${IMAGES_ORIGIN}/${objectKeyOf(1)}/square-lg.png`,
              width: 640,
              height: 480,
            },
            listed: true,
          },
        },
        {
          match_id: matchIdOf(4),
          kind: 'week',
          round: 2,
          stage: 'semifinal',
          match_date: PREVIOUS_DATE,
          live: false,
          product: {
            handle: 'product3',
            name: 'プロダクト3',
            logo: null,
            listed: false,
          },
        },
      ],
      meta: { total: 2, has_next: false, next_cursor: body.meta.next_cursor },
    });
  });

  test('20件ずつ返し、続きのカーソルから次のページを返す', async () => {
    const indexes = Array.from({ length: 21 }, (_, offset) => offset + 1);
    await insertMatches(
      indexes.map((index) => twoSidedMatch(index, { startedAt: STARTS_AT })),
    );
    await insertUpvotes(
      indexes.map((index) => upvoteOf(index, index, 1, VOTER)),
    );

    const first = await get(`/users/${VOTER_HANDLE}/upvotes`);
    const firstBody: HistoryBody = await first.json();
    const second = await get(
      `/users/${VOTER_HANDLE}/upvotes?cursor=${firstBody.meta.next_cursor ?? ''}`,
    );
    const secondBody: HistoryBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.data.map(({ match_id }) => match_id)).toEqual(
      indexes.toReversed().slice(0, 20).map(matchIdOf),
    );
    expect(firstBody.meta.total).toBe(21);
    expect(firstBody.meta.has_next).toBe(true);
    expect(firstBody.meta.next_cursor).toEqual(expect.any(String));
    expect(second.status).toBe(200);
    expect(secondBody.data.map(({ match_id }) => match_id)).toEqual([
      matchIdOf(1),
    ]);
    expect(secondBody.meta.has_next).toBe(false);
  });

  test('旧ハンドルは転送せずにその利用者のUpvote履歴を返す', async () => {
    await insertPreviousHandle(1, VOTER, 'old-voter');
    await insertMatches([twoSidedMatch(1, { startedAt: STARTS_AT })]);
    await insertUpvotes([upvoteOf(1, 1, 1, VOTER)]);

    const response = await get('/users/old-voter/upvotes');

    expect(response.status).toBe(200);
    const body: HistoryBody = await response.json();
    expect(body.data.map(({ match_id }) => match_id)).toEqual([matchIdOf(1)]);
  });

  test.each([
    ['存在しない', 'nobody'],
    ['形式に合わない', 'Not-a-handle!'],
    ['退会済みの', `user${String(WITHDRAWN)}`],
    ['停止中の', `user${String(SUSPENDED)}`],
  ])('%s利用者は区別せずに404(user_not_found)を返す', async (_name, handle) => {
    const response = await get(`/users/${encodeURIComponent(handle)}/upvotes`);

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('user_not_found');
  });

  test.each([...INVALID_CURSORS, ['上流が復号できない', 'broken'] as const])(
    '%sカーソルは400(invalid_cursor)を返す',
    async (_name, cursor) => {
      const response = await get(
        `/users/${VOTER_HANDLE}/upvotes?cursor=${encodeURIComponent(cursor)}`,
      );

      expect(response.status).toBe(400);
      expect(await errorCodeOf(response)).toBe('invalid_cursor');
    },
  );

  // 上流の位置は実施日とマッチIDだけの固定の形で256文字を超えられないため、上限の判定は上流を呼ぶ前に拒否することで確かめる
  test.each([
    ['空の', ''],
    ['上限の256文字を超える', 'a'.repeat(257)],
  ])(
    '%sカーソルは上流のUpvote履歴を読まずに400(invalid_cursor)を返す',
    async (_name, cursor) => {
      const read = vi.spyOn(StoreUpvoteHistoryReader.prototype, 'read');

      const response = await get(
        `/users/${VOTER_HANDLE}/upvotes?cursor=${cursor}`,
      );

      expect(response.status).toBe(400);
      expect(await errorCodeOf(response)).toBe('invalid_cursor');
      expect(read).not.toHaveBeenCalled();
    },
  );
});
