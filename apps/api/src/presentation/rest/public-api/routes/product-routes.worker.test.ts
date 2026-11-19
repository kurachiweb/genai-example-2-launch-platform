import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { apiKeys } from '../../../../../db/schema/public-api/api-keys.ts';
import { DIRECTORY_SEARCH_MAX_GRAPHEMES } from '../../../../../common-lib/directory/directory-query-rules.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import { createKeyedHasher } from '../../../../../lib/core/crypto/keyed-hasher.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  winOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  db,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertProducts,
  insertScreenshot,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { insertApiKey } from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { matchIdOf } from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import { API_KEY_HASH_PURPOSE } from '../../../../domain/public-api/api-key-token.ts';
import { OPENAPI_DOCUMENT_PATH } from '../../public-api-app.ts';
import { PlatformMediaLookup } from '../media-lookup.ts';
import { PRODUCT_LIST_QUERY_MESSAGES } from '../schemas/products.ts';
import { publicApiProductRoutes } from './product-routes.ts';

const harness = createPublicApiRestHarness([publicApiProductRoutes]);

const hasher = createKeyedHasher(env.HASH_PEPPER);

const OWNER = 1;
const RIVAL = 2;
const SUSPENDED_OWNER = 3;

const LISTED = 1;
const UNLISTED = 2;
const HIDDEN = 3;
const DELETED = 4;
const SUSPENDED_OWNERS = 5;
const HOLDERS_UNLISTED = 6;
const LOSER = 7;

const TOOLS = 1;

const LOGO_FILE = 1;
const SCREENSHOT_FILE = 2;

const SCHEDULED_LAUNCH = 98;

const FAR_FUTURE_LAUNCH_DATE = '2099-01-05';

const SITE_ORIGIN = env.CLIENT_SITE_ORIGIN;

const IMAGES_ORIGIN = env.IMAGES_ORIGIN;

interface KeyHolder {
  readonly userIndex: number;
  readonly authorization: string;
}

// 利用者単位の回数の記録はテストの間で消せないため、テストごとに別の利用者とキーを使う
let nextHolderIndex = 500;

let holder: KeyHolder;

async function createKeyHolder(
  scopes: Partial<typeof apiKeys.$inferInsert> = {},
): Promise<KeyHolder> {
  const index = nextHolderIndex;
  nextHolderIndex += 1;
  const plain = `lsk_${String(index).padStart(43, 'x')}`;
  await insertUser(index);
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
    ...scopes,
  });
  return { userIndex: index, authorization: `Bearer ${plain}` };
}

function get(path: string, authorization = holder.authorization) {
  return harness.request(path, { headers: { Authorization: authorization } });
}

async function bodyOf<T>(response: Response): Promise<T> {
  return await response.json();
}

interface ListBody {
  readonly data: readonly { readonly handle: string }[];
  readonly meta: {
    readonly total: number;
    readonly page: number;
    readonly per_page: number;
    readonly total_pages: number;
  };
}

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly details?: readonly {
      readonly field: string;
      readonly message: string;
    }[];
  };
}

const handlesOf = (body: ListBody): string[] =>
  body.data.map(({ handle }) => handle);

// 掲載中: Rocketship(カテゴリ1・ロゴとスクリーンショットあり・旧ハンドルold-rocketship)。掲載中でない: 未掲載・非公開化・論理削除・停止中の投稿者・キーの持ち主の未掲載
async function seedProducts(): Promise<void> {
  holder = await createKeyHolder();
  await insertUser(OWNER, { nickname: 'アリス', handle: 'alice' });
  await insertUser(RIVAL);
  await insertUser(SUSPENDED_OWNER, {
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertCategory(TOOLS);
  await insertFile(LOGO_FILE);
  await insertFile(SCREENSHOT_FILE, { width: 1280, height: 720 });
  await insertProduct(LISTED, OWNER, {
    handle: 'rocketship',
    name: 'Rocketship',
    tagline: '宇宙へ。',
    categoryId: categoryIdOf(TOOLS),
    websiteUrl: 'https://rocketship.example/',
    logoFileId: fileIdOf(LOGO_FILE),
    descriptionMarkdown: '# Rocketship',
  });
  await insertScreenshot(1, LISTED, 1, fileIdOf(SCREENSHOT_FILE));
  await insertProductPreviousHandle(1, LISTED, 'old-rocketship');
  await insertProduct(UNLISTED, RIVAL, { name: 'Unlisted Rival' });
  await insertProduct(HIDDEN, OWNER, { hiddenAt: T0 });
  await insertProduct(DELETED, OWNER, { deletedAt: T0 });
  await insertProduct(SUSPENDED_OWNERS, SUSPENDED_OWNER);
  await insertProduct(HOLDERS_UNLISTED, holder.userIndex);
  await insertProduct(LOSER, RIVAL);
  await insertQualifiers([
    {
      match: 1,
      date: '2026-11-05',
      sides: [
        { product: LISTED, owner: OWNER, result: 'won', upvotes: 12 },
        { product: UNLISTED, owner: RIVAL, result: 'lost', upvotes: 9 },
      ],
    },
    winOf(2, {
      product: HIDDEN,
      owner: OWNER,
      date: '2026-11-04',
      opponent: LOSER,
    }),
    winOf(3, {
      product: DELETED,
      owner: OWNER,
      date: '2026-11-03',
      opponent: LOSER,
    }),
    winOf(4, {
      product: SUSPENDED_OWNERS,
      owner: SUSPENDED_OWNER,
      date: '2026-11-02',
      opponent: LOSER,
    }),
  ]);
  await insertLaunch(SCHEDULED_LAUNCH, LISTED, {
    launchDate: FAR_FUTURE_LAUNCH_DATE,
  });
  await insertLaunch(99, LISTED, {
    launchDate: '2026-11-08',
    cancelledAt: T0,
  });
}

beforeEach(async () => {
  await db.delete(apiKeys);
  await clearDirectoryTables();
  await clearMediaTables();
  await seedProducts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const NOT_LISTED_HANDLES = [
  ['存在しない', 'missing-product'],
  ['形式に合わない', '-invalid-'],
  ['未掲載', `product${String(UNLISTED)}`],
  ['非公開化された', `product${String(HIDDEN)}`],
  ['論理削除された', `product${String(DELETED)}`],
  ['投稿者が停止中の', `product${String(SUSPENDED_OWNERS)}`],
  ['キーの持ち主の未掲載の', `product${String(HOLDERS_UNLISTED)}`],
] as const;

describe('GET /products', () => {
  test('掲載中のプロダクトだけを、投稿者・ロゴ・基準勝利・ページのURLとともに総件数付きで返す', async () => {
    const response = await get('/products');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: productIdOf(LISTED),
          handle: 'rocketship',
          name: 'Rocketship',
          tagline: '宇宙へ。',
          category: { handle: 'category1', name: 'カテゴリ1' },
          website_url: 'https://rocketship.example/',
          logo: {
            url: `${IMAGES_ORIGIN}/${objectKeyOf(LOGO_FILE)}/square-lg.png`,
            width: 640,
            height: 480,
          },
          owner: {
            handle: 'alice',
            nickname: 'アリス',
            avatar: null,
            profile_url: `${SITE_ORIGIN}/@alice`,
          },
          base_win: {
            launch_date: '2026-11-05',
            kind: 'victory',
            upvote_count: 12,
          },
          awards: [],
          page_url: `${SITE_ORIGIN}/p/rocketship`,
        },
      ],
      meta: { total: 1, page: 1, per_page: 20, total_pages: 1 },
    });
  });

  test('カテゴリのハンドルで大文字小文字を問わず絞り込む', async () => {
    const tools = await get('/products?category=CATEGORY1');
    const other = await get(
      `/products?category=${PRODUCT_CATEGORY_OTHER_HANDLE}`,
    );

    expect(handlesOf(await bodyOf<ListBody>(tools))).toEqual(['rocketship']);
    expect(handlesOf(await bodyOf<ListBody>(other))).toEqual([]);
  });

  test('検索キーワード・期間・並び順の条件を受け付ける', async () => {
    const searched = await get('/products?q=%20rocket%20&sort=relevance');
    const inRange = await get(
      '/products?from=2026-11-05&to=2026-11-05&sort=oldest',
    );
    const outOfRange = await get('/products?from=2026-11-06');

    expect(handlesOf(await bodyOf<ListBody>(inRange))).toEqual(['rocketship']);
    expect(handlesOf(await bodyOf<ListBody>(outOfRange))).toEqual([]);
    expect(searched.status).toBe(200);
  });

  test.each([
    [
      '空白だけの検索キーワード',
      'q=%20%20',
      'q',
      PRODUCT_LIST_QUERY_MESSAGES.qRequired,
    ],
    [
      '文字数を超える検索キーワード',
      `q=${'あ'.repeat(DIRECTORY_SEARCH_MAX_GRAPHEMES + 1)}`,
      'q',
      PRODUCT_LIST_QUERY_MESSAGES.qTooLong,
    ],
    [
      '存在しないカテゴリ',
      'category=missing',
      'category',
      PRODUCT_LIST_QUERY_MESSAGES.categoryNotFound,
    ],
    [
      '形式に合わないカテゴリ',
      'category=-tools',
      'category',
      PRODUCT_LIST_QUERY_MESSAGES.categoryNotFound,
    ],
    [
      '実在しない日付',
      'from=2026-02-30',
      'from',
      PRODUCT_LIST_QUERY_MESSAGES.invalidDate,
    ],
    [
      '形式に合わない日付',
      'to=20261105',
      'to',
      PRODUCT_LIST_QUERY_MESSAGES.invalidDate,
    ],
    [
      '開始日が終了日より後の期間',
      'from=2026-11-06&to=2026-11-05',
      'from',
      PRODUCT_LIST_QUERY_MESSAGES.reversedPeriod,
    ],
    [
      '未知の並び順',
      'sort=popular',
      'sort',
      PRODUCT_LIST_QUERY_MESSAGES.invalidSort,
    ],
    [
      '検索キーワードの無い関連度の並び順',
      'sort=relevance',
      'sort',
      PRODUCT_LIST_QUERY_MESSAGES.relevanceWithoutQ,
    ],
    [
      '0のページ番号',
      'page=0',
      'page',
      PRODUCT_LIST_QUERY_MESSAGES.invalidPage,
    ],
    [
      '数でないページ番号',
      'page=two',
      'page',
      PRODUCT_LIST_QUERY_MESSAGES.invalidPage,
    ],
    [
      '上限を超えるページ番号',
      'page=9007199254740991',
      'page',
      PRODUCT_LIST_QUERY_MESSAGES.invalidPage,
    ],
  ])(
    '%sは項目ごとの入力の誤りを400で返す',
    async (_name, query, field, message) => {
      const response = await get(`/products?${query}`);

      expect(response.status).toBe(400);
      const body = await bodyOf<ErrorBody>(response);
      expect(body.error.code).toBe('validation_error');
      expect(body.error.details).toEqual([
        expect.objectContaining({ field, message }),
      ]);
    },
  );

  test('総ページ数を超えるページは空の一覧と正しい総件数を返す', async () => {
    const response = await get('/products?page=5');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { total: 1, page: 5, per_page: 20, total_pages: 1 },
    });
  });

  test('1ページに20件を返し、画像と利用者をページごとに1回の照会でまとめて読む', async () => {
    const extra = Array.from({ length: 20 }, (_, index) => 100 + index);
    await insertProducts(extra, RIVAL);
    await insertQualifiers(
      extra.map((product, index) =>
        winOf(100 + index, {
          product,
          owner: RIVAL,
          date: '2026-10-01',
          opponent: LOSER,
        }),
      ),
    );
    const load = vi.spyOn(PlatformMediaLookup.prototype, 'load');

    const first = await bodyOf<ListBody>(await get('/products'));
    const second = await bodyOf<ListBody>(await get('/products?page=2'));

    expect(first.data).toHaveLength(20);
    expect(first.meta).toEqual({
      total: 21,
      page: 1,
      per_page: 20,
      total_pages: 2,
    });
    expect(second.data).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0]?.[0].fileIds).toHaveLength(20);
  });

  test('「プロダクト」の権限が無効のキーは403で拒否する', async () => {
    const disabled = await createKeyHolder({ scopeProducts: 'none' });

    const response = await get('/products', disabled.authorization);

    expect(response.status).toBe(403);
    expect((await bodyOf<ErrorBody>(response)).error.code).toBe(
      'insufficient_scope',
    );
  });
});

describe('GET /products/{handle}', () => {
  test('掲載中のプロダクトの詳細を、大文字小文字を問わず返す', async () => {
    const response = await get('/products/RocketShip');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: productIdOf(LISTED),
        handle: 'rocketship',
        name: 'Rocketship',
        tagline: '宇宙へ。',
        category: { handle: 'category1', name: 'カテゴリ1' },
        website_url: 'https://rocketship.example/',
        logo: {
          url: `${IMAGES_ORIGIN}/${objectKeyOf(LOGO_FILE)}/square-lg.png`,
          width: 640,
          height: 480,
        },
        owner: {
          handle: 'alice',
          nickname: 'アリス',
          avatar: null,
          profile_url: `${SITE_ORIGIN}/@alice`,
        },
        awards: [],
        page_url: `${SITE_ORIGIN}/p/rocketship`,
        description_markdown: '# Rocketship',
        screenshots: [
          {
            url: `${IMAGES_ORIGIN}/${objectKeyOf(SCREENSHOT_FILE)}/screenshot-full.png`,
            width: 1280,
            height: 720,
          },
        ],
        first_launch_date: '2026-11-05',
        launch_count: 1,
        record: { wins: 1, losses: 0 },
      },
    });
  });

  test('旧ハンドルは現在のハンドルの同じ経路へクエリを保って302で転送する', async () => {
    const response = await get('/products/old-rocketship?lang=ja');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://api.launch.example/v1/products/rocketship?lang=ja',
    );
  });

  test.each(NOT_LISTED_HANDLES)(
    '%sプロダクトは区別せずに404を返す',
    async (_name, handle) => {
      const response = await get(`/products/${handle}`);

      expect(response.status).toBe(404);
      expect((await bodyOf<ErrorBody>(response)).error.code).toBe(
        'product_not_found',
      );
    },
  );
});

describe('GET /products/{handle}/launches', () => {
  test('取消を除くローンチを新しい順に、確定したマッチと対戦相手の公開範囲で返す', async () => {
    const response = await get('/products/rocketship/launches');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: launchIdOf(SCHEDULED_LAUNCH),
          number: 2,
          launch_date: FAR_FUTURE_LAUNCH_DATE,
          status: 'scheduled',
          summary: 'キックオフ予定',
          matches: [],
        },
        {
          id: launchIdOf(11),
          number: 1,
          launch_date: '2026-11-05',
          status: 'finished',
          summary: 'ディレクトリ掲載',
          matches: [
            {
              id: matchIdOf(1),
              kind: 'qualifier',
              round: null,
              stage: null,
              match_date: '2026-11-05',
              result: 'won',
              decision: 'votes',
              ended_early: false,
              upvote_count: 12,
              opponent_upvote_count: 9,
              opponent: { kind: 'unlisted', name: 'Unlisted Rival' },
            },
          ],
        },
      ],
    });
  });

  test('旧ハンドルは現在のハンドルのローンチ履歴へ302で転送する', async () => {
    const response = await get('/products/old-rocketship/launches');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://api.launch.example/v1/products/rocketship/launches',
    );
  });

  test.each(NOT_LISTED_HANDLES)(
    '%sプロダクトは区別せずに404を返す',
    async (_name, handle) => {
      const response = await get(`/products/${handle}/launches`);

      expect(response.status).toBe(404);
      expect((await bodyOf<ErrorBody>(response)).error.code).toBe(
        'product_not_found',
      );
    },
  );

  test('「ローンチ履歴」の権限が無効のキーは403で拒否する', async () => {
    const disabled = await createKeyHolder({ scopeLaunches: 'none' });

    const response = await get(
      '/products/rocketship/launches',
      disabled.authorization,
    );

    expect(response.status).toBe(403);
  });
});

describe('GET /product-categories', () => {
  test('全てのプロダクトカテゴリのハンドルと名称を、掲載の多い順で「その他」を末尾に返す', async () => {
    const response = await get('/product-categories');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { handle: 'category1', name: 'カテゴリ1' },
        {
          handle: PRODUCT_CATEGORY_OTHER_HANDLE,
          name: PRODUCT_CATEGORY_OTHER_NAME,
        },
      ],
    });
  });
});

describe('OpenAPIの仕様書', () => {
  test('4つの経路と、マッチの種別・段階の列挙を載せる', async () => {
    const response = await harness.request(OPENAPI_DOCUMENT_PATH);
    const document = await bodyOf<{
      readonly paths: Readonly<Record<string, unknown>>;
      readonly components: {
        readonly schemas: Readonly<
          Record<
            string,
            {
              readonly properties?: Readonly<
                Record<string, { readonly enum?: readonly unknown[] }>
              >;
            }
          >
        >;
      };
    }>(response);

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/products',
        '/products/{handle}',
        '/products/{handle}/launches',
        '/product-categories',
      ]),
    );
    const match = document.components.schemas.LaunchMatch?.properties;
    expect(match?.kind?.enum).toEqual(['qualifier', 'week', 'year']);
    expect(JSON.stringify(match?.stage)).toContain('quarterfinal');
    expect(JSON.stringify(match?.stage)).toContain('final');
  });
});
