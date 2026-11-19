import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { productSearchDocuments } from '../../../../../db/schema/directory/product-search-documents.ts';
import { users } from '../../../../../db/schema/identity/users.ts';
import { products } from '../../../../../db/schema/product/products.ts';
import { apiKeys } from '../../../../../db/schema/public-api/api-keys.ts';
import { createKeyedHasher } from '../../../../../lib/core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../../../../lib/core/di/app-module.ts';
import { createUlidGenerator } from '../../../../../lib/core/ids/id-generator.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  type SearchIndexRefreshBody,
} from '../../../../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../../../../lib/core/messaging/envelope.ts';
import { D1DirectoryEntryStore } from '../../../../../lib/workers/directory/d1-directory-entry-store.ts';
import {
  clearDirectoryTables,
  indexProduct,
  insertQualifiers,
  qualifierDecidedAt,
  winOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import type { PlatformHonoEnv } from '../../../../../lib/workers/http/hono-env.ts';
import {
  after,
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { insertApiKey } from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import { StoreMyProductsReader } from '../../../../application/product/my-products-reader.ts';
import { StoreProductDescriptionEditor } from '../../../../application/product/product-description-editor.ts';
import { PRODUCT_ERRORS } from '../../../../application/product/product-errors.ts';
import {
  EditorOwnProductDescriptionService,
  type OwnProductDescriptionService,
} from '../../../../application/public-api/own-product-description-service.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import { API_KEY_HASH_PURPOSE } from '../../../../domain/public-api/api-key-token.ts';
import { publicApiError } from '../public-api-errors.ts';
import { publicApiMyProductRoutes } from './my-product-routes.ts';

// 5.7でapiの束縛のモジュールへ加える説明文のユースケースを、ここで束縛する
const testModule: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'public-api-my-product-routes-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<OwnProductDescriptionService>(
      PUBLIC_API_TYPES.OwnProductDescriptionService,
    ).to(EditorOwnProductDescriptionService);
  }),
};

const harness = createPublicApiRestHarness(
  [publicApiMyProductRoutes],
  [testModule],
);

const hasher = createKeyedHasher(env.HASH_PEPPER);

const SITE_ORIGIN = env.CLIENT_SITE_ORIGIN;

const HIDDEN_MESSAGE =
  'このプロダクトは公開が停止されているため、説明文を更新できません。';

const NEW_DESCRIPTION = '# 新しい説明文\n\n本文';

type DescriptionScope = 'none' | 'read' | 'read_write';

type UserColumns = Partial<typeof users.$inferInsert>;

type ProductColumns = Parameters<typeof insertProduct>[2];

// 利用者単位の回数の記録はテストの間で消せないため、テストごとに別の利用者とキーを使う
let nextHolderIndex = 900;

interface KeyHolder {
  readonly index: number;
  readonly authorization: string;
}

async function createKeyHolder(
  options: {
    readonly scope?: DescriptionScope;
    readonly user?: UserColumns;
  } = {},
): Promise<KeyHolder> {
  const index = nextHolderIndex;
  nextHolderIndex += 1;
  const plain = `lsk_${String(index).padStart(43, 'y')}`;
  await insertUser(index, {
    handle: `holder${String(index)}`,
    emailVerifiedAt: T0,
    ...options.user,
  });
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
    scopeProductDescriptions: options.scope ?? 'read_write',
  });
  return { index, authorization: `Bearer ${plain}` };
}

// プロダクトの番号と同じ番号のローンチを1件持たせる
async function insertOwnProduct(
  index: number,
  owner: number,
  launch: { readonly launchDate: string; readonly outcome?: 'won' | 'lost' },
  columns: ProductColumns = {},
): Promise<void> {
  await insertProduct(index, owner, {
    latestLaunchDate: launch.launchDate,
    ...columns,
  });
  await insertLaunch(index, index, {
    launchDate: launch.launchDate,
    ...(launch.outcome !== undefined && {
      outcome: launch.outcome,
      decidedAt: T0,
    }),
  });
}

function get(path: string, holder: KeyHolder) {
  return harness.request(path, {
    headers: { Authorization: holder.authorization },
  });
}

function put(holder: KeyHolder, handle: string, body: unknown) {
  return harness.request(`/me/products/${handle}/description`, {
    method: 'PUT',
    headers: {
      Authorization: holder.authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly {
      readonly field: string;
      readonly code: string;
      readonly message: string;
    }[];
  };
}

async function errorOf(response: Response): Promise<ErrorBody['error']> {
  const body: ErrorBody = await response.json();
  return body.error;
}

interface MyProductBody {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly description_markdown: string;
  readonly listed: boolean;
  readonly hidden: boolean;
  readonly page_url: string;
}

interface MyProductListBody {
  readonly data: readonly MyProductBody[];
  readonly meta: {
    readonly has_next: boolean;
    readonly next_cursor: string | null;
  };
}

async function dataOf(response: Response): Promise<MyProductBody> {
  const body: { readonly data: MyProductBody } = await response.json();
  return body.data;
}

async function readDescription(index: number): Promise<string | undefined> {
  const [row] = await db
    .select({ description: products.descriptionMarkdown })
    .from(products)
    .where(eq(products.id, productIdOf(index)));
  return row?.description;
}

async function readKeywordStatus(index: number): Promise<string | undefined> {
  const [row] = await db
    .select({ keywordStatus: productSearchDocuments.keywordStatus })
    .from(productSearchDocuments)
    .where(eq(productSearchDocuments.sourceId, productIdOf(index)));
  return row?.keywordStatus;
}

const encodeJson = (json: string): string =>
  new TextEncoder()
    .encode(json)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

const dayOf = (day: number): string =>
  `2026-10-${String(day).padStart(2, '0')}`;

async function clearTables(): Promise<void> {
  await db.delete(apiKeys);
  await clearDirectoryTables();
  await clearProductTables();
}

beforeEach(clearTables);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /me/products', () => {
  const OTHER_USER = 1;
  const PAGE_PRODUCTS = 22;

  async function seedOwnProducts(holder: KeyHolder): Promise<void> {
    await insertUser(OTHER_USER, { handle: 'other' });
    for (let index = 1; index <= PAGE_PRODUCTS; index += 1) {
      await insertOwnProduct(
        index,
        holder.index,
        {
          launchDate: dayOf(index),
          ...(index === PAGE_PRODUCTS && { outcome: 'won' as const }),
        },
        index === PAGE_PRODUCTS - 1 ? { hiddenAt: T0 } : {},
      );
    }
    await insertOwnProduct(
      30,
      holder.index,
      { launchDate: dayOf(30) },
      {
        deletedAt: T0,
      },
    );
    await insertOwnProduct(31, OTHER_USER, { launchDate: dayOf(31) });
  }

  test('論理削除していない自分のプロダクトを、未掲載・非公開化中を含めて最新のローンチ日の新しい順に20件ずつ返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });
    await seedOwnProducts(holder);

    const first = await get('/me/products', holder);

    expect(first.status).toBe(200);
    const firstPage: MyProductListBody = await first.json();
    expect(firstPage.data.map(({ handle }) => handle)).toEqual(
      Array.from(
        { length: 20 },
        (_, offset) => `product${String(PAGE_PRODUCTS - offset)}`,
      ),
    );
    expect(firstPage.data[0]).toEqual({
      id: productIdOf(PAGE_PRODUCTS),
      handle: `product${String(PAGE_PRODUCTS)}`,
      name: `プロダクト${String(PAGE_PRODUCTS)}`,
      description_markdown: `説明文${String(PAGE_PRODUCTS)}`,
      listed: true,
      hidden: false,
      page_url: `${SITE_ORIGIN}/p/product${String(PAGE_PRODUCTS)}`,
    });
    expect(firstPage.data[1]).toMatchObject({ listed: false, hidden: true });
    expect(firstPage.data[2]).toMatchObject({ listed: false, hidden: false });
    expect(firstPage.meta.has_next).toBe(true);
    expect(firstPage.meta.next_cursor).toEqual(expect.any(String));

    const second = await get(
      `/me/products?cursor=${firstPage.meta.next_cursor ?? ''}`,
      holder,
    );

    expect(second.status).toBe(200);
    const secondPage: MyProductListBody = await second.json();
    expect(secondPage.data.map(({ handle }) => handle)).toEqual([
      'product2',
      'product1',
    ]);
    expect(secondPage.meta.has_next).toBe(false);
  });

  test('プロダクトの無い利用者は空の一覧を返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });

    const response = await get('/me/products', holder);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { has_next: false, next_cursor: null },
    });
  });

  test.each([
    ['base64urlでない', 'not a cursor!'],
    ['位置の形でない', encodeJson('{"x":1}')],
    [
      '日付が実在しない',
      encodeJson(`{"d":"2026-02-30","id":"${productIdOf(1)}"}`),
    ],
  ])('%sカーソルは400(invalid_cursor)を返す', async (_name, cursor) => {
    const holder = await createKeyHolder({ scope: 'read' });

    const response = await get(
      `/me/products?cursor=${encodeURIComponent(cursor)}`,
      holder,
    );

    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('invalid_cursor');
  });

  test('上流が復号できる形でも上限の256文字を超えるカーソルは400(invalid_cursor)を返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });
    await insertOwnProduct(1, holder.index, { launchDate: dayOf(1) });
    const position = `"d":"${dayOf(5)}","id":"${productIdOf(5)}"`;
    const accepted = encodeJson(`{${position}}`);
    const padded = encodeJson(`{${' '.repeat(200)}${position}}`);

    const acceptedResponse = await get(
      `/me/products?cursor=${accepted}`,
      holder,
    );
    const rejectedResponse = await get(`/me/products?cursor=${padded}`, holder);

    expect(padded.length).toBeGreaterThan(256);
    expect(acceptedResponse.status).toBe(200);
    expect(rejectedResponse.status).toBe(400);
    expect((await errorOf(rejectedResponse)).code).toBe('invalid_cursor');
  });

  test.each([
    ['空の', ''],
    ['上限の256文字を超える', 'a'.repeat(257)],
  ])(
    '%sカーソルは自分のプロダクトを読まずに400(invalid_cursor)を返す',
    async (_name, cursor) => {
      const holder = await createKeyHolder({ scope: 'read' });
      const list = vi.spyOn(StoreMyProductsReader.prototype, 'list');

      const response = await get(`/me/products?cursor=${cursor}`, holder);

      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_cursor');
      expect(list).not.toHaveBeenCalled();
    },
  );

  test('プロダクトの説明文の権限の無いキーは403(insufficient_scope)を返す', async () => {
    const holder = await createKeyHolder({ scope: 'none' });

    const response = await get('/me/products', holder);

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('insufficient_scope');
  });

  test('停止中の持ち主のキーは403(account_unavailable)を返す', async () => {
    const holder = await createKeyHolder({
      scope: 'read',
      user: { status: 'suspended', suspendedAt: after(1) },
    });

    const response = await get('/me/products', holder);

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('account_unavailable');
  });
});

describe('PUT /me/products/{handle}/description', () => {
  const PRODUCT = 1;
  const OTHER_USER = 1;
  const OTHER_PRODUCT = 2;
  const DELETED_PRODUCT = 3;

  test('自分のプロダクトの説明文を置き換え、更新後のプロダクトを返す', async () => {
    const holder = await createKeyHolder();
    await insertOwnProduct(PRODUCT, holder.index, { launchDate: dayOf(1) });

    const response = await put(holder, 'product1', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toEqual({
      id: productIdOf(PRODUCT),
      handle: 'product1',
      name: 'プロダクト1',
      description_markdown: NEW_DESCRIPTION,
      listed: false,
      hidden: false,
      page_url: `${SITE_ORIGIN}/p/product1`,
    });
    await expect(readDescription(PRODUCT)).resolves.toBe(NEW_DESCRIPTION);
  });

  test('保持中の旧ハンドルの指定は、現在のハンドルのプロダクトの説明文を置き換える', async () => {
    const holder = await createKeyHolder();
    await insertOwnProduct(PRODUCT, holder.index, { launchDate: dayOf(1) });
    await insertProductPreviousHandle(1, PRODUCT, 'old-product1');

    const response = await put(holder, 'old-product1', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      handle: 'product1',
      description_markdown: NEW_DESCRIPTION,
    });
    await expect(readDescription(PRODUCT)).resolves.toBe(NEW_DESCRIPTION);
  });

  test.each([
    ['他の利用者の', 'product2'],
    ['論理削除した', 'product3'],
    ['存在しない', 'product9'],
    ['ハンドルの形式でない', '-invalid-'],
  ])(
    '%sプロダクトは区別せずに404(product_not_found)を返す',
    async (_name, handle) => {
      const holder = await createKeyHolder();
      await insertUser(OTHER_USER, { handle: 'other' });
      await insertOwnProduct(OTHER_PRODUCT, OTHER_USER, {
        launchDate: dayOf(2),
      });
      await insertOwnProduct(
        DELETED_PRODUCT,
        holder.index,
        { launchDate: dayOf(3) },
        { deletedAt: T0 },
      );

      const response = await put(holder, handle, {
        description_markdown: NEW_DESCRIPTION,
      });

      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe('product_not_found');
      await expect(readDescription(OTHER_PRODUCT)).resolves.toBe('説明文2');
      await expect(readDescription(DELETED_PRODUCT)).resolves.toBe('説明文3');
    },
  );

  test('非公開化中のプロダクトは、product-launchと同じ文言の409(product_hidden)を返し説明文を変えない', async () => {
    const holder = await createKeyHolder();
    await insertOwnProduct(
      PRODUCT,
      holder.index,
      { launchDate: dayOf(1) },
      { hiddenAt: T0 },
    );
    const update = vi.spyOn(StoreProductDescriptionEditor.prototype, 'update');

    const response = await put(holder, 'product1', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(409);
    const error = await errorOf(response);
    expect(error.code).toBe('product_hidden');
    expect(error.message).toBe(HIDDEN_MESSAGE);
    expect(error.message).toBe(PRODUCT_ERRORS.product_hidden.message);
    expect(error.message).toBe(publicApiError('product_hidden').message);
    expect(update).not.toHaveBeenCalled();
    await expect(readDescription(PRODUCT)).resolves.toBe('説明文1');
  });

  test.each([
    [
      '非公開化された',
      () =>
        db
          .update(products)
          .set({ hiddenAt: after(1) })
          .where(eq(products.id, productIdOf(PRODUCT))),
      409,
      'product_hidden',
    ],
    [
      '持ち主が停止された',
      () =>
        db
          .update(users)
          .set({ status: 'suspended', suspendedAt: after(1) })
          .where(eq(users.id, userIdOf(nextHolderIndex - 1))),
      403,
      'account_unavailable',
    ],
    [
      '論理削除された',
      () =>
        db
          .update(products)
          .set({ deletedAt: after(1) })
          .where(eq(products.id, productIdOf(PRODUCT))),
      404,
      'product_not_found',
    ],
  ])(
    '事前の判定の後に%s場合は、説明文の保存の誤りをそのまま返す',
    async (_name, change, status, code) => {
      const holder = await createKeyHolder();
      await insertOwnProduct(PRODUCT, holder.index, { launchDate: dayOf(1) });
      // 1回目の呼び出しの中の呼び出しは差し替えの消費の後のため、元の読み取りを通る
      vi.spyOn(StoreMyProductsReader.prototype, 'find').mockImplementationOnce(
        async function (this: StoreMyProductsReader, user, handle) {
          const lookup = await this.find(user, handle);
          await change();
          return lookup;
        },
      );
      const update = vi.spyOn(
        StoreProductDescriptionEditor.prototype,
        'update',
      );

      const response = await put(holder, 'product1', {
        description_markdown: NEW_DESCRIPTION,
      });

      expect(response.status).toBe(status);
      const error = await errorOf(response);
      expect(error.code).toBe(code);
      expect(update).toHaveBeenCalledTimes(1);
      await expect(update.mock.results[0]?.value).rejects.toMatchObject({
        code,
        message: error.message,
      });
      await expect(readDescription(PRODUCT)).resolves.toBe('説明文1');
    },
  );

  test.each([
    ['空の', { description_markdown: '' }, '説明文を入力してください。'],
    [
      '空白だけの',
      { description_markdown: ' \n\t' },
      '説明文を入力してください。',
    ],
    [
      '20,000文字を超える',
      { description_markdown: 'a'.repeat(20_001) },
      '説明文は20,000文字以内で入力してください。',
    ],
    ['説明文の無い', {}, '説明文を入力してください。'],
  ])(
    '%s説明文は400(validation_error)を返し説明文を変えない',
    async (_name, body, message) => {
      const holder = await createKeyHolder();
      await insertOwnProduct(PRODUCT, holder.index, { launchDate: dayOf(1) });

      const response = await put(holder, 'product1', body);

      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        expect.objectContaining({ field: 'description_markdown', message }),
      ]);
      await expect(readDescription(PRODUCT)).resolves.toBe('説明文1');
    },
  );

  test('読み取りだけの権限のキーは403(insufficient_scope)を返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });
    await insertOwnProduct(PRODUCT, holder.index, { launchDate: dayOf(1) });

    const response = await put(holder, 'product1', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('insufficient_scope');
    await expect(readDescription(PRODUCT)).resolves.toBe('説明文1');
  });
});

describe('説明文の更新と保存の登録(directory-discovery.product-index-refresh)', () => {
  const LISTED = 1;
  // 予選で負けたため、勝利したプロダクトの記録を持たない
  const UNLISTED = 2;
  const WIN_DATE = '2026-11-03';

  interface SentRefresh {
    readonly sourceId: string;
    // 送信の時点で確定済みの値
    readonly description: string | undefined;
    readonly keywordStatus: string | undefined;
  }

  interface BatchEffect {
    readonly description: {
      before: string | undefined;
      after: string | undefined;
    };
    readonly keywordStatus: {
      before: string | undefined;
      after: string | undefined;
    };
  }

  type RefreshEnvelope = QueueEnvelope & {
    readonly body: SearchIndexRefreshBody;
  };

  function isRefreshEnvelope(sent: unknown): sent is RefreshEnvelope {
    return (
      typeof sent === 'object' &&
      sent !== null &&
      'type' in sent &&
      sent.type === SEARCH_INDEX_REFRESH_MESSAGE.type
    );
  }

  // 索引の更新の要求を実際には送らず、送った時点の確定済みの状態とともに記録する
  function recordRefreshRequests(): readonly SentRefresh[] {
    const sent: SentRefresh[] = [];
    vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation(async (message) => {
      if (isRefreshEnvelope(message)) {
        expect(message.body.target).toBe('product');
        const { sourceId } = message.body;
        const index = sourceId === productIdOf(LISTED) ? LISTED : UNLISTED;
        sent.push({
          sourceId,
          description: await readDescription(index),
          keywordStatus: await readKeywordStatus(index),
        });
      }
      return { metadata: { metrics: {} } } as QueueSendResponse;
    });
    return sent;
  }

  // 一括の書き込みごとに、その前後の説明文と索引文書の状態を記録する
  function recordBatchEffects(index: number): readonly BatchEffect[] {
    const effects: BatchEffect[] = [];
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementation(async (statements) => {
      const description = await readDescription(index);
      const keywordStatus = await readKeywordStatus(index);
      const results = await batch(statements);
      effects.push({
        description: {
          before: description,
          after: await readDescription(index),
        },
        keywordStatus: {
          before: keywordStatus,
          after: await readKeywordStatus(index),
        },
      });
      return results;
    });
    return effects;
  }

  async function seedProducts(holder: KeyHolder): Promise<void> {
    await insertProduct(LISTED, holder.index);
    await insertProduct(UNLISTED, holder.index);
    await insertQualifiers([
      winOf(1, {
        product: LISTED,
        owner: holder.index,
        date: WIN_DATE,
        opponent: UNLISTED,
      }),
    ]);
    await new D1DirectoryEntryStore(
      db,
      createUlidGenerator({ now: () => T0 }),
    ).record(
      [{ productId: productIdOf(LISTED), ownerUserId: userIdOf(holder.index) }],
      qualifierDecidedAt(WIN_DATE),
    );
    await indexProduct(LISTED);
  }

  test('掲載中のプロダクトは、説明文と同じ一括の書き込みで索引文書を更新待ちにし、確定の後に索引の更新を要求する', async () => {
    const holder = await createKeyHolder();
    await seedProducts(holder);
    const sent = recordRefreshRequests();
    const effects = recordBatchEffects(LISTED);

    const response = await put(holder, 'product1', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      handle: 'product1',
      listed: true,
      description_markdown: NEW_DESCRIPTION,
    });
    expect(
      effects.filter(
        ({ description }) => description.before !== description.after,
      ),
    ).toEqual([
      {
        description: { before: '説明文1', after: NEW_DESCRIPTION },
        keywordStatus: { before: 'extracted', after: 'pending' },
      },
    ]);
    expect(sent).toEqual([
      {
        sourceId: productIdOf(LISTED),
        description: NEW_DESCRIPTION,
        keywordStatus: 'pending',
      },
    ]);
  });

  test('勝利したプロダクトの記録の無いプロダクトは、索引文書を作らず索引の更新も要求しない', async () => {
    const holder = await createKeyHolder();
    await seedProducts(holder);
    const sent = recordRefreshRequests();

    const response = await put(holder, 'product2', {
      description_markdown: NEW_DESCRIPTION,
    });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      handle: 'product2',
      listed: false,
      description_markdown: NEW_DESCRIPTION,
    });
    await expect(readKeywordStatus(UNLISTED)).resolves.toBeUndefined();
    await expect(readKeywordStatus(LISTED)).resolves.toBe('extracted');
    expect(sent).toEqual([]);
  });
});
