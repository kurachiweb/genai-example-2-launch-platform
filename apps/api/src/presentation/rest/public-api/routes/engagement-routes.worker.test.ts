import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { users } from '../../../../../db/schema/identity/users.ts';
import { productRatings } from '../../../../../db/schema/engagement/product-ratings.ts';
import { products } from '../../../../../db/schema/product/products.ts';
import { apiKeys } from '../../../../../db/schema/public-api/api-keys.ts';
import { COMMENT_PAGE_SIZE } from '../../../../../common-lib/engagement/engagement-rules.ts';
import { createKeyedHasher } from '../../../../../lib/core/crypto/keyed-hasher.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { insertProductPreviousHandle } from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { insertApiKey } from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import { StoreCommentReader } from '../../../../application/engagement/comment-reader.ts';
import { StoreRatingService } from '../../../../application/engagement/rating-service.ts';
import { API_KEY_HASH_PURPOSE } from '../../../../domain/public-api/api-key-token.ts';
import { publicApiEngagementRoutes } from './engagement-routes.ts';

const harness = createPublicApiRestHarness([publicApiEngagementRoutes]);

const hasher = createKeyedHasher(env.HASH_PEPPER);

const SITE_ORIGIN = env.CLIENT_SITE_ORIGIN;

const OWNER = 1;
const COMMENTER = 2;
const RATER = 3;
const SUSPENDED = 4;
const WITHDRAWN = 5;
const INVALIDATED_RATER = 6;
const OTHER_OWNER = 7;

const LISTED = 1;
const UNLISTED = 2;
const OTHER = 3;

const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;
const CANCELED_LAUNCH = 3;
const UNLISTED_LAUNCH = 4;
const OTHER_LAUNCH = 5;

const COMMENTS_PATH = `/products/product${String(LISTED)}/launches/${launchIdOf(CURRENT_LAUNCH)}/comments`;

const RATING_PATH = `/products/product${String(LISTED)}/rating-summary`;

// 利用者単位の回数の記録はテストの間で消せないため、テストごとに別の利用者とキーを使う
let nextHolderIndex = 900;

let authorization: string;

interface KeyHolder {
  readonly index: number;
  readonly authorization: string;
}

async function createKeyHolder(
  scopes: {
    readonly scopeComments?: 'none';
    readonly scopeRatings?: 'none';
  } = {},
): Promise<KeyHolder> {
  const index = nextHolderIndex;
  nextHolderIndex += 1;
  const plain = `lsk_${String(index).padStart(43, 'x')}`;
  await insertUser(index);
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
    ...scopes,
  });
  return { index, authorization: `Bearer ${plain}` };
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

interface CommentNodeBody {
  readonly id: string;
  readonly parent_id: string | null;
  readonly depth: number;
  readonly removed: boolean;
  readonly author: { readonly handle: string } | null;
  readonly body_markdown: string | null;
  readonly created_at: string | null;
  readonly edited: boolean;
}

interface CommentListBody {
  readonly data: readonly (CommentNodeBody & {
    readonly replies: readonly CommentNodeBody[];
  })[];
  readonly meta: {
    readonly has_next: boolean;
    readonly next_cursor: string | null;
  };
}

async function setProductHidden(): Promise<void> {
  await db
    .update(products)
    .set({ hiddenAt: T0 })
    .where(eq(products.id, productIdOf(LISTED)));
}

async function setProductDeleted(): Promise<void> {
  await db
    .update(products)
    .set({ deletedAt: T0 })
    .where(eq(products.id, productIdOf(LISTED)));
}

async function setOwnerSuspended(): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended', suspendedAt: T0 })
    .where(eq(users.id, userIdOf(OWNER)));
}

const UNVIEWABLE_PRODUCT_STATES: readonly (readonly [
  string,
  () => Promise<void>,
])[] = [
  ['非公開化された', setProductHidden],
  ['投稿者が停止中の', setOwnerSuspended],
  ['論理削除された', setProductDeleted],
];

// プロダクト1は利用者1の掲載中(勝利したローンチ1を持つ)のプロダクトで、旧ハンドルold-product1と当日のローンチ2・取消のローンチ3を持つ。
// プロダクト2は利用者1の未掲載のプロダクト、プロダクト3は別の利用者のプロダクト
async function seedProducts(): Promise<void> {
  ({ authorization } = await createKeyHolder());
  await insertUser(OWNER);
  await insertUser(COMMENTER);
  await insertUser(RATER);
  await insertUser(SUSPENDED, { status: 'suspended', suspendedAt: T0 });
  await insertUser(WITHDRAWN, { deletedAt: T0 });
  await insertUser(INVALIDATED_RATER);
  await insertUser(OTHER_OWNER);
  await insertProduct(LISTED, OWNER);
  await insertProductPreviousHandle(1, LISTED, 'old-product1');
  await insertLaunch(WON_LAUNCH, LISTED, {
    launchDate: '2026-11-05',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED, { launchDate: '2026-11-10' });
  await insertLaunch(CANCELED_LAUNCH, LISTED, {
    launchDate: '2026-11-09',
    cancelledAt: T0,
  });
  await insertProduct(UNLISTED, OWNER);
  await insertLaunch(UNLISTED_LAUNCH, UNLISTED, { launchDate: '2026-11-10' });
  await insertProduct(OTHER, OTHER_OWNER);
  await insertLaunch(OTHER_LAUNCH, OTHER, { launchDate: '2026-11-10' });
}

beforeEach(async () => {
  await db.delete(apiKeys);
  await clearEngagementTables();
  await seedProducts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /products/{handle}/launches/{launch_id}/comments', () => {
  const TOP = 1;
  const LATE_REPLY = 2;
  const EARLY_REPLY = 3;
  const DEEP_REPLY = 4;
  const HIDDEN_REPLY = 5;
  const DELETED_TOP = 6;
  const HIDDEN_TOP = 7;
  const SUSPENDED_TOP = 8;
  const WITHDRAWN_TOP = 9;
  const UNLISTED_TOP = 10;

  // 当日のローンチ2に、返信を作成の順と番号の順が逆になるよう持つトップレベル1と、削除・非公開化・停止中と退会済みの利用者のトップレベル6〜9を置く
  async function seedThread(): Promise<void> {
    await insertComments([
      {
        index: TOP,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        columns: {
          body: '**最高**のプロダクト',
          createdAt: after(1_000),
          editedAt: after(9_000),
        },
      },
      {
        index: LATE_REPLY,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: OWNER,
        parent: { index: TOP, root: TOP },
        depth: 2,
        columns: { body: '遅い返信', createdAt: after(3_000) },
      },
      {
        index: EARLY_REPLY,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: RATER,
        parent: { index: TOP, root: TOP },
        depth: 2,
        columns: { body: '早い返信', createdAt: after(2_000) },
      },
      {
        index: DEEP_REPLY,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        parent: { index: EARLY_REPLY, root: TOP },
        depth: 3,
        columns: { body: '深い返信', createdAt: after(4_000) },
      },
      {
        index: HIDDEN_REPLY,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: RATER,
        parent: { index: LATE_REPLY, root: TOP },
        depth: 3,
        columns: { createdAt: after(5_000), hiddenAt: after(5_500) },
      },
      {
        index: DELETED_TOP,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        columns: {
          createdAt: after(6_000),
          editedAt: after(6_100),
          deletedAt: after(6_200),
        },
      },
      {
        index: HIDDEN_TOP,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(7_000), hiddenAt: after(7_100) },
      },
      {
        index: SUSPENDED_TOP,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: SUSPENDED,
        columns: { createdAt: after(8_000) },
      },
      {
        index: WITHDRAWN_TOP,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: WITHDRAWN,
        columns: { createdAt: after(8_500) },
      },
      {
        index: UNLISTED_TOP,
        product: UNLISTED,
        launch: UNLISTED_LAUNCH,
        author: COMMENTER,
      },
    ]);
  }

  const removedOf = (
    index: number,
    depth = 1,
    parent: number | null = null,
  ): CommentNodeBody => ({
    id: commentIdOf(index),
    parent_id: parent === null ? null : commentIdOf(parent),
    depth,
    removed: true,
    author: null,
    body_markdown: null,
    created_at: null,
    edited: false,
  });

  const authorOf = (user: number) => ({
    handle: `user${String(user)}`,
    nickname: `利用者${String(user)}`,
    avatar: null,
    profile_url: `${SITE_ORIGIN}/@user${String(user)}`,
  });

  test('トップレベルを新しい順に、返信を古い順に親のIDとともに添え、削除・非公開化・停止中と退会済みの利用者のコメントを本文と投稿者を含めずに親のIDを保って置き換えて返す', async () => {
    await seedThread();

    const response = await get(COMMENTS_PATH);

    expect(response.status).toBe(200);
    const body: CommentListBody = await response.json();
    expect(body).toEqual({
      data: [
        { ...removedOf(WITHDRAWN_TOP), replies: [] },
        { ...removedOf(SUSPENDED_TOP), replies: [] },
        { ...removedOf(HIDDEN_TOP), replies: [] },
        { ...removedOf(DELETED_TOP), replies: [] },
        {
          id: commentIdOf(TOP),
          parent_id: null,
          depth: 1,
          removed: false,
          author: authorOf(COMMENTER),
          body_markdown: '**最高**のプロダクト',
          created_at: after(1_000).toISOString(),
          edited: true,
          replies: [
            {
              id: commentIdOf(EARLY_REPLY),
              parent_id: commentIdOf(TOP),
              depth: 2,
              removed: false,
              author: authorOf(RATER),
              body_markdown: '早い返信',
              created_at: after(2_000).toISOString(),
              edited: false,
            },
            {
              id: commentIdOf(LATE_REPLY),
              parent_id: commentIdOf(TOP),
              depth: 2,
              removed: false,
              author: authorOf(OWNER),
              body_markdown: '遅い返信',
              created_at: after(3_000).toISOString(),
              edited: false,
            },
            {
              id: commentIdOf(DEEP_REPLY),
              parent_id: commentIdOf(EARLY_REPLY),
              depth: 3,
              removed: false,
              author: authorOf(COMMENTER),
              body_markdown: '深い返信',
              created_at: after(4_000).toISOString(),
              edited: false,
            },
            removedOf(HIDDEN_REPLY, 3, LATE_REPLY),
          ],
        },
      ],
      meta: { has_next: false, next_cursor: expect.any(String) as string },
    });
  });

  test(`トップレベルを${String(COMMENT_PAGE_SIZE)}スレッドずつ返し、次のカーソルで続きを重複・欠落なく返す`, async () => {
    const total = COMMENT_PAGE_SIZE + 2;
    await insertComments(
      Array.from({ length: total }, (_, offset) => ({
        index: 100 + offset,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(offset * 1_000) },
      })),
    );

    const first = await get(COMMENTS_PATH);
    const firstBody: CommentListBody = await first.json();
    const second = await get(
      `${COMMENTS_PATH}?cursor=${firstBody.meta.next_cursor ?? ''}`,
    );

    expect(first.status).toBe(200);
    expect(firstBody.data.map(({ id }) => id)).toEqual(
      Array.from({ length: COMMENT_PAGE_SIZE }, (_, offset) =>
        commentIdOf(100 + total - 1 - offset),
      ),
    );
    expect(firstBody.meta).toEqual({
      has_next: true,
      next_cursor: expect.any(String) as string,
    });
    expect(second.status).toBe(200);
    const secondBody: CommentListBody = await second.json();
    expect(secondBody.data.map(({ id }) => id)).toEqual([
      commentIdOf(101),
      commentIdOf(100),
    ]);
    expect(secondBody.meta.has_next).toBe(false);
  });

  test('コメントの無いローンチは空の一覧を返す', async () => {
    const response = await get(COMMENTS_PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { has_next: false, next_cursor: null },
    });
  });

  test('旧ハンドルは現在のハンドルの同じ経路へカーソルを保って302で転送する', async () => {
    const response = await get(
      `/products/old-product1/launches/${launchIdOf(CURRENT_LAUNCH)}/comments?cursor=abc`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `https://api.launch.example/v1${COMMENTS_PATH}?cursor=abc`,
    );
  });

  test.each([
    ['取り消された', launchIdOf(CANCELED_LAUNCH)],
    ['他のプロダクトの', launchIdOf(OTHER_LAUNCH)],
    ['存在しない', launchIdOf(99)],
    ['形式に合わない', 'not-a-launch'],
  ])('%sローンチは404(launch_not_found)を返す', async (_name, launchId) => {
    const response = await get(
      `/products/product${String(LISTED)}/launches/${launchId}/comments`,
    );

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('launch_not_found');
  });

  test.each([
    ['未掲載の', `product${String(UNLISTED)}`, UNLISTED_LAUNCH],
    ['存在しない', 'missing-product', CURRENT_LAUNCH],
    ['形式に合わない', '-invalid-', CURRENT_LAUNCH],
  ])(
    '%sプロダクトはローンチを確かめずに404(product_not_found)を返す',
    async (_name, handle, launch) => {
      await seedThread();

      const response = await get(
        `/products/${handle}/launches/${launchIdOf(launch)}/comments`,
      );

      expect(response.status).toBe(404);
      expect(await errorCodeOf(response)).toBe('product_not_found');
    },
  );

  test.each(UNVIEWABLE_PRODUCT_STATES)(
    '%sプロダクトは404(product_not_found)を返す',
    async (_name, apply) => {
      await apply();

      const response = await get(COMMENTS_PATH);

      expect(response.status).toBe(404);
      expect(await errorCodeOf(response)).toBe('product_not_found');
    },
  );

  test.each([
    ['base64urlでない', 'not a cursor!'],
    ['位置の形でない', btoa('{"x":1}').replaceAll('=', '')],
  ])('%sカーソルは400(invalid_cursor)を返す', async (_name, cursor) => {
    const response = await get(
      `${COMMENTS_PATH}?cursor=${encodeURIComponent(cursor)}`,
    );

    expect(response.status).toBe(400);
    expect(await errorCodeOf(response)).toBe('invalid_cursor');
  });

  test('上流が復号できる形でも上限の256文字を超えるカーソルは400(invalid_cursor)を返す', async () => {
    const encode = (json: string): string =>
      new TextEncoder()
        .encode(json)
        .toBase64({ alphabet: 'base64url', omitPadding: true });
    const position = `"createdAt":${String(after(1_000).getTime())},"commentId":"${commentIdOf(1)}"`;
    const accepted = encode(`{${position}}`);
    const padded = encode(`{${' '.repeat(200)}${position}}`);

    const acceptedResponse = await get(`${COMMENTS_PATH}?cursor=${accepted}`);
    const rejectedResponse = await get(`${COMMENTS_PATH}?cursor=${padded}`);

    expect(padded.length).toBeGreaterThan(256);
    expect(acceptedResponse.status).toBe(200);
    expect(rejectedResponse.status).toBe(400);
    expect(await errorCodeOf(rejectedResponse)).toBe('invalid_cursor');
  });

  test.each([
    ['空の', ''],
    ['上限の256文字を超える', 'a'.repeat(257)],
  ])(
    '%sカーソルは上流のコメントを読まずに400(invalid_cursor)を返す',
    async (_name, cursor) => {
      const page = vi.spyOn(StoreCommentReader.prototype, 'page');

      const response = await get(`${COMMENTS_PATH}?cursor=${cursor}`);

      expect(response.status).toBe(400);
      expect(await errorCodeOf(response)).toBe('invalid_cursor');
      expect(page).not.toHaveBeenCalled();
    },
  );

  test('コメントの権限の無いキーは403(insufficient_scope)を返す', async () => {
    ({ authorization } = await createKeyHolder({ scopeComments: 'none' }));

    const response = await get(COMMENTS_PATH);

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe('insufficient_scope');
  });
});

describe('GET /products/{handle}/rating-summary', () => {
  // プロダクト1を利用者2が4、利用者3が5で評価し、無効化された評価と停止中・退会済みの利用者の評価は1。未掲載のプロダクト2も評価済み
  async function seedRatings(): Promise<void> {
    await insertRatings([
      { index: 1, product: LISTED, user: COMMENTER, score: 4 },
      { index: 2, product: LISTED, user: RATER, score: 5 },
      {
        index: 3,
        product: LISTED,
        user: INVALIDATED_RATER,
        score: 1,
        columns: { invalidatedAt: after(1_000) },
      },
      { index: 4, product: LISTED, user: SUSPENDED, score: 1 },
      { index: 5, product: LISTED, user: WITHDRAWN, score: 1 },
      { index: 6, product: UNLISTED, user: COMMENTER, score: 2 },
    ]);
  }

  beforeEach(seedRatings);

  test('無効化された評価と停止中・退会済みの利用者の評価を除いた平均値と件数を返す', async () => {
    const response = await get(RATING_PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { average: 4.5, count: 2 },
    });
  });

  test('有効な評価が無ければ平均値をnull、件数を0で返す', async () => {
    await db
      .delete(productRatings)
      .where(eq(productRatings.productId, productIdOf(LISTED)));

    const response = await get(RATING_PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { average: null, count: 0 },
    });
  });

  test('旧ハンドルは現在のハンドルの同じ経路へ302で転送する', async () => {
    const response = await get('/products/old-product1/rating-summary');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `https://api.launch.example/v1${RATING_PATH}`,
    );
  });

  test.each([
    ['未掲載の', `product${String(UNLISTED)}`],
    ['存在しない', 'missing-product'],
    ['形式に合わない', '-invalid-'],
  ])('%sプロダクトは404(product_not_found)を返す', async (_name, handle) => {
    const response = await get(`/products/${handle}/rating-summary`);

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('product_not_found');
  });

  test.each(UNVIEWABLE_PRODUCT_STATES)(
    '%sプロダクトは404(product_not_found)を返す',
    async (_name, apply) => {
      await apply();

      const response = await get(RATING_PATH);

      expect(response.status).toBe(404);
      expect(await errorCodeOf(response)).toBe('product_not_found');
    },
  );

  test('解決の後に上流がプロダクトを表示できなくなったときは404(product_not_found)を返す', async () => {
    vi.spyOn(StoreRatingService.prototype, 'read').mockResolvedValue(null);

    const response = await get(RATING_PATH);

    expect(response.status).toBe(404);
    expect(await errorCodeOf(response)).toBe('product_not_found');
  });

  test('評価の権限の無いキーは403(insufficient_scope)を返す', async () => {
    ({ authorization } = await createKeyHolder({ scopeRatings: 'none' }));

    const response = await get(RATING_PATH);

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe('insufficient_scope');
  });
});

describe('キーの持ち主を閲覧者としない読み取り', () => {
  const HOLDER_LISTED = 8;
  const HOLDER_UNLISTED = 9;
  const HOLDER_WON_LAUNCH = 8;
  const HOLDER_CURRENT_LAUNCH = 9;
  const HOLDER_UNLISTED_LAUNCH = 10;
  const HOLDER_COMMENT = 20;

  // キーの持ち主は掲載中のプロダクト8(当日のローンチ9に自分のコメントがあり、利用者2が評価済み)と未掲載のプロダクト9の投稿者
  async function seedHolderProducts(): Promise<KeyHolder> {
    const holder = await createKeyHolder();
    await insertProduct(HOLDER_LISTED, holder.index);
    await insertLaunch(HOLDER_WON_LAUNCH, HOLDER_LISTED, {
      launchDate: '2026-11-05',
      outcome: 'won',
      decidedAt: T0,
    });
    await insertLaunch(HOLDER_CURRENT_LAUNCH, HOLDER_LISTED, {
      launchDate: '2026-11-10',
    });
    await insertProduct(HOLDER_UNLISTED, holder.index);
    await insertLaunch(HOLDER_UNLISTED_LAUNCH, HOLDER_UNLISTED, {
      launchDate: '2026-11-10',
    });
    await insertComments([
      {
        index: HOLDER_COMMENT,
        product: HOLDER_LISTED,
        launch: HOLDER_CURRENT_LAUNCH,
        author: holder.index,
      },
    ]);
    await insertRatings([
      { index: 20, product: HOLDER_LISTED, user: COMMENTER, score: 3 },
    ]);
    return holder;
  }

  beforeEach(async () => {
    ({ authorization } = await seedHolderProducts());
  });

  // 持ち主から見えるか未ログインから見えるかの差は経路の先の解決で404になるため、上流へ渡す閲覧者を直に確かめる
  test('持ち主が投稿者でコメントの作者のプロダクトでも、上流のコメントと評価を未ログインの閲覧者で読む', async () => {
    const page = vi.spyOn(StoreCommentReader.prototype, 'page');
    const read = vi.spyOn(StoreRatingService.prototype, 'read');

    const comments = await get(
      `/products/product${String(HOLDER_LISTED)}/launches/${launchIdOf(HOLDER_CURRENT_LAUNCH)}/comments`,
    );
    const rating = await get(
      `/products/product${String(HOLDER_LISTED)}/rating-summary`,
    );

    expect(comments.status).toBe(200);
    const body: CommentListBody = await comments.json();
    expect(body.data.map(({ id }) => id)).toEqual([
      commentIdOf(HOLDER_COMMENT),
    ]);
    expect(rating.status).toBe(200);
    expect(await rating.json()).toEqual({ data: { average: 3, count: 1 } });
    expect(page).toHaveBeenCalledOnce();
    expect(page).toHaveBeenCalledWith(
      expect.objectContaining({ viewer: undefined }),
    );
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ viewer: undefined }),
    );
  });

  test('持ち主の未掲載のプロダクトのコメントと評価も404(product_not_found)を返す', async () => {
    const comments = await get(
      `/products/product${String(HOLDER_UNLISTED)}/launches/${launchIdOf(HOLDER_UNLISTED_LAUNCH)}/comments`,
    );
    const rating = await get(
      `/products/product${String(HOLDER_UNLISTED)}/rating-summary`,
    );

    expect(comments.status).toBe(404);
    expect(await errorCodeOf(comments)).toBe('product_not_found');
    expect(rating.status).toBe(404);
    expect(await errorCodeOf(rating)).toBe('product_not_found');
  });
});
