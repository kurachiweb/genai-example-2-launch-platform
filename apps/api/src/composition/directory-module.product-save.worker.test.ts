import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../common-lib/search/search-terms.ts';
import { productSearchDocuments } from '../../db/schema/directory/product-search-documents.ts';
import { products } from '../../db/schema/product/products.ts';
import { createUlidGenerator } from '../../lib/core/ids/id-generator.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  type SearchIndexRefreshBody,
} from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1DirectoryEntryStore } from '../../lib/workers/directory/d1-directory-entry-store.ts';
import { D1DirectoryListing } from '../../lib/workers/directory/d1-directory-listing.ts';
import {
  clearDirectoryTables,
  indexProduct,
  insertQualifiers,
  qualifierDecidedAt,
  winOf,
} from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  db,
  insertProducts,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import type {
  ProductSaveInput,
  ProductStore,
} from '../application/product/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { ProductIndexRefreshSaveHook } from '../infrastructure/directory/product-index-refresh-save-hook.ts';
import {
  businessDate,
  fieldsOf,
  insertInputOf,
  newIdOf,
  NOW,
  planOf,
  saveInputOf,
} from '../infrastructure/product/testing/product-store-fixtures.ts';
import { MODULES } from './modules.ts';

const OWNER = 1;
const LISTED = 1;
// 予選で負けたため、勝利したプロダクトの記録を持たない
const UNLISTED = 2;
const NEW_PRODUCT = 3;

// 保存の時刻(NOW)より前に確定した予選の勝利
const WIN_DATE = '2026-11-03';
const RESERVED_DATE = '2026-11-20';
const RESCHEDULED_DATE = '2026-11-27';

const EDITED_NAME = 'Orbit Planner';
const EDITED_QUERY = 'orbit';

interface SentRefresh {
  readonly sourceId: string;
  // 送信の時点で確定済みの値
  readonly productName: string | undefined;
  readonly keywordStatus: string | undefined;
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

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function productStore(): ProductStore {
  return createContainer().get<ProductStore>(PRODUCT_TYPES.ProductStore);
}

async function readProductName(sourceId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, sourceId));
  return row?.name;
}

async function readKeywordStatus(
  sourceId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ keywordStatus: productSearchDocuments.keywordStatus })
    .from(productSearchDocuments)
    .where(eq(productSearchDocuments.sourceId, sourceId));
  return row?.keywordStatus;
}

// 索引の更新の要求を実際には送らず、送った時点の確定済みの状態とともに記録する
function recordRefreshRequests(
  options: { readonly failing?: boolean } = {},
): readonly SentRefresh[] {
  const sent: SentRefresh[] = [];
  vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation(async (message) => {
    if (isRefreshEnvelope(message)) {
      expect(message.body.target).toBe('product');
      const { sourceId } = message.body;
      sent.push({
        sourceId,
        productName: await readProductName(sourceId),
        keywordStatus: await readKeywordStatus(sourceId),
      });
    }
    if (options.failing === true) {
      throw new Error('Queueに送れません');
    }
    return { metadata: { metrics: {} } } as QueueSendResponse;
  });
  return sent;
}

function silenceConsole(): void {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
}

function renameOf(index: number, name: string): ProductSaveInput {
  return saveInputOf(index, { fields: fieldsOf(index, { name }) });
}

async function searchProductIds(query: string): Promise<string[]> {
  const matchExpression = buildFtsMatchExpression(normalizeSearchTerms(query));
  if (matchExpression === undefined) {
    throw new Error(`検索語「${query}」から検索式を作れない`);
  }
  const page = await new D1DirectoryListing(db).page({
    matchExpression,
    categoryId: undefined,
    from: undefined,
    to: undefined,
    sort: 'relevance',
    page: 1,
  });
  return page.rows.map((row) => row.productId);
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProducts([LISTED, UNLISTED], OWNER);
  await insertQualifiers([
    winOf(1, {
      product: LISTED,
      owner: OWNER,
      date: WIN_DATE,
      opponent: UNLISTED,
    }),
  ]);
  await new D1DirectoryEntryStore(
    db,
    createUlidGenerator({ now: () => T0 }),
  ).record(
    [{ productId: productIdOf(LISTED), ownerUserId: userIdOf(OWNER) }],
    qualifierDecidedAt(WIN_DATE),
  );
  await indexProduct(LISTED);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのディレクトリのモジュールの保存の処理の束縛', () => {
  test('処理単位のコンテナから、保存の処理を実装に解決する', () => {
    expect(
      createContainer().get(DIRECTORY_TYPES.ProductIndexRefreshSaveHook),
    ).toBeInstanceOf(ProductIndexRefreshSaveHook);
  });
});

describe('編集の索引の更新待ちの保存の処理の登録(directory-discovery.product-index-refresh)', () => {
  test('掲載中のプロダクトの編集と同じ一括の書き込みで索引文書を更新待ちにし、確定の後に索引の更新を要求する', async () => {
    const sent = recordRefreshRequests();

    await expect(
      productStore().save(renameOf(LISTED, EDITED_NAME)),
    ).resolves.toBe('saved');

    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'pending',
    );
    expect(sent).toEqual([
      {
        sourceId: productIdOf(LISTED),
        productName: EDITED_NAME,
        keywordStatus: 'pending',
      },
    ]);
  });

  test('次回の予約とローンチ日の変更の保存でも、索引文書を更新待ちにして確定の後に要求する', async () => {
    const sent = recordRefreshRequests();
    const store = productStore();

    await expect(
      store.save(
        saveInputOf(LISTED, {
          plan: planOf({
            launch: { kind: 'reserve', date: businessDate(RESERVED_DATE) },
          }),
        }),
      ),
    ).resolves.toBe('saved');
    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'pending',
    );
    await indexProduct(LISTED);

    await expect(
      store.save(
        saveInputOf(LISTED, {
          expectedVersion: 1,
          plan: planOf({
            launch: {
              kind: 'reschedule',
              launchId: newIdOf('NLNC', LISTED),
              date: businessDate(RESCHEDULED_DATE),
            },
          }),
        }),
      ),
    ).resolves.toBe('saved');

    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'pending',
    );
    expect(sent.map(({ sourceId }) => sourceId)).toEqual([
      productIdOf(LISTED),
      productIdOf(LISTED),
    ]);
  });

  test('公開APIの説明文の更新でも、索引文書を更新待ちにして確定の後に要求する', async () => {
    const sent = recordRefreshRequests();

    await expect(
      productStore().updateDescription({
        productId: productIdOf(LISTED),
        descriptionMarkdown: '新しい説明文',
        now: NOW,
      }),
    ).resolves.toBe('saved');

    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'pending',
    );
    expect(sent).toEqual([
      {
        sourceId: productIdOf(LISTED),
        productName: `プロダクト${String(LISTED)}`,
        keywordStatus: 'pending',
      },
    ]);
  });

  test('新しい登録では索引文書を作らず、要求も送らない', async () => {
    const sent = recordRefreshRequests();

    await expect(
      productStore().insert(insertInputOf(NEW_PRODUCT, userIdOf(OWNER))),
    ).resolves.toBe('saved');

    await expect(
      readKeywordStatus(productIdOf(NEW_PRODUCT)),
    ).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  test('未掲載のプロダクトの編集では索引文書を作らず、要求も送らない', async () => {
    const sent = recordRefreshRequests();

    await expect(
      productStore().save(renameOf(UNLISTED, EDITED_NAME)),
    ).resolves.toBe('saved');

    await expect(readProductName(productIdOf(UNLISTED))).resolves.toBe(
      EDITED_NAME,
    );
    await expect(
      readKeywordStatus(productIdOf(UNLISTED)),
    ).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  test('保存の条件で取り消されると、索引文書の更新待ちも書かれず、要求も送らない', async () => {
    const sent = recordRefreshRequests();

    await expect(
      productStore().save(
        saveInputOf(LISTED, {
          expectedVersion: 5,
          fields: fieldsOf(LISTED, { name: EDITED_NAME }),
        }),
      ),
    ).resolves.toBe('conflict');

    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'extracted',
    );
    expect(sent).toEqual([]);
  });

  test('索引の更新の要求を送れなくても保存は成功し、索引文書は更新待ちのまま残る', async () => {
    silenceConsole();
    const sent = recordRefreshRequests({ failing: true });

    await expect(
      productStore().save(renameOf(LISTED, EDITED_NAME)),
    ).resolves.toBe('saved');

    expect(sent.map(({ sourceId }) => sourceId)).toEqual([productIdOf(LISTED)]);
    await expect(readProductName(productIdOf(LISTED))).resolves.toBe(
      EDITED_NAME,
    );
    await expect(readKeywordStatus(productIdOf(LISTED))).resolves.toBe(
      'pending',
    );
  });

  test('索引の更新の処理を流した後は、編集した名称で検索にかかる', async () => {
    const sent = recordRefreshRequests();
    await expect(searchProductIds(EDITED_QUERY)).resolves.toEqual([]);

    await productStore().save(renameOf(LISTED, EDITED_NAME));
    expect(sent.map(({ sourceId }) => sourceId)).toEqual([productIdOf(LISTED)]);
    await indexProduct(LISTED);

    await expect(searchProductIds(EDITED_QUERY)).resolves.toEqual([
      productIdOf(LISTED),
    ]);
  });
});
