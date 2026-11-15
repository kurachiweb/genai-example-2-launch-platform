import { env } from 'cloudflare:workers';
import { ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { productCategories } from './schema/product/product-categories.ts';
import { productLaunches } from './schema/product/product-launches.ts';
import { productLifecycleEvents } from './schema/product/product-lifecycle-events.ts';
import { productLifecycleHandlerRuns } from './schema/product/product-lifecycle-handler-runs.ts';
import { productPreviousHandles } from './schema/product/product-previous-handles.ts';
import { productScreenshots } from './schema/product/product-screenshots.ts';
import { products } from './schema/product/products.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const AT = new Date(Date.UTC(2026, 10, 9));

const db = createDatabase(env.DB);

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
}

async function insertProduct(id: string, handle: string): Promise<void> {
  await db.insert(products).values({
    id,
    userId: OWNER_ID,
    categoryId: OTHER_CATEGORY_ID,
    handle,
    name: `名称${id}`,
    tagline: 'タグライン',
    websiteUrl: 'https://product.example/',
    descriptionMarkdown: '説明文',
    logoFileId: `logo-${id}`,
    latestLaunchDate: '2026-11-20',
  });
}

async function insertPurgeDue(id: string, productId: string): Promise<void> {
  await db.insert(productLifecycleEvents).values({
    id,
    productId,
    ownerUserId: OWNER_ID,
    type: 'purge_due',
    occurredAt: AT,
    lastDispatchedAt: AT,
  });
}

beforeEach(async () => {
  await db.delete(productLifecycleHandlerRuns);
  await db.delete(productLifecycleEvents);
  await db.delete(productLaunches);
  await db.delete(productScreenshots);
  await db.delete(productPreviousHandles);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await db.insert(users).values({
    id: OWNER_ID,
    pseudonymousId: 'pseudonymous-owner',
    email: 'owner@product.example',
    passwordHash: 'hash',
    nickname: '投稿者',
    handle: 'owner',
    termsAgreedAt: AT,
  });
});

describe('大文字小文字を区別しない一意の列', () => {
  test('大文字小文字だけが違う名前・ハンドルのカテゴリは作れない', async () => {
    await db
      .insert(productCategories)
      .values({ name: 'Developer Tools', handle: 'dev-tools' });

    expect(
      await rejectionMessagesOf(
        db
          .insert(productCategories)
          .values({ name: 'DEVELOPER TOOLS', handle: 'developer-tools' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_categories.name',
      ),
    );
    expect(
      await rejectionMessagesOf(
        db
          .insert(productCategories)
          .values({ name: 'Productivity', handle: 'DEV-TOOLS' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_categories.handle',
      ),
    );
  });

  test('大文字小文字だけが違うハンドルのプロダクトは、論理削除した行があっても作れない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'MyApp');
    await db.update(products).set({ deletedAt: AT });

    expect(
      await rejectionMessagesOf(
        insertProduct('01JD0000000000000000000P02', 'myapp'),
      ),
    ).toContainEqual(
      expect.stringContaining('UNIQUE constraint failed: products.handle'),
    );
  });

  test('大文字小文字だけが違う旧ハンドルは、別のプロダクトでも作れない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await insertProduct('01JD0000000000000000000P02', 'second');
    await db
      .insert(productPreviousHandles)
      .values({ ownerId: '01JD0000000000000000000P01', handle: 'OldName' });

    expect(
      await rejectionMessagesOf(
        db
          .insert(productPreviousHandles)
          .values({ ownerId: '01JD0000000000000000000P02', handle: 'OLDNAME' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_previous_handles.handle',
      ),
    );
  });
});

describe('ローンチの部分一意索引', () => {
  test('未確定かつ取消でないローンチを同じプロダクトに2つ作れない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await db.insert(productLaunches).values({
      productId: '01JD0000000000000000000P01',
      launchDate: '2026-11-20',
    });

    expect(
      await rejectionMessagesOf(
        db.insert(productLaunches).values({
          productId: '01JD0000000000000000000P01',
          launchDate: '2026-11-27',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_launches.product_id',
      ),
    );
  });

  test('結果が確定したローンチと取消のローンチは数えず、別のプロダクトのローンチとも重ならない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await insertProduct('01JD0000000000000000000P02', 'second');

    await db.insert(productLaunches).values([
      {
        productId: '01JD0000000000000000000P01',
        launchDate: '2026-11-10',
        outcome: 'lost',
        decidedAt: AT,
      },
      {
        productId: '01JD0000000000000000000P01',
        launchDate: '2026-11-13',
        cancelledAt: AT,
      },
      {
        productId: '01JD0000000000000000000P01',
        launchDate: '2026-11-20',
      },
      {
        productId: '01JD0000000000000000000P02',
        launchDate: '2026-11-20',
      },
    ]);

    expect(await db.$count(productLaunches)).toBe(4);
  });

  test('予選の結果は勝利・敗北以外の値を拒否する', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');

    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO product_launches (id, product_id, launch_date, outcome, created_at, updated_at) VALUES ('01JD0000000000000000000L99', '01JD0000000000000000000P01', '2026-11-20', 'draw', 0, 0)",
        ).run(),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: product_launches_outcome_check',
      ),
    );
  });
});

describe('ライフサイクルイベントの部分一意索引', () => {
  test('purge_dueを同じプロダクトに2つ作れない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await insertPurgeDue(
      '01JD0000000000000000000E01',
      '01JD0000000000000000000P01',
    );

    expect(
      await rejectionMessagesOf(
        insertPurgeDue(
          '01JD0000000000000000000E02',
          '01JD0000000000000000000P01',
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_lifecycle_events.product_id',
      ),
    );
  });

  test('purge_due以外の種類は同じプロダクトに何件でも作れる', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await insertPurgeDue(
      '01JD0000000000000000000E01',
      '01JD0000000000000000000P01',
    );

    await db.insert(productLifecycleEvents).values(
      (['hidden', 'unhidden', 'hidden', 'deleted'] as const).map((type) => ({
        productId: '01JD0000000000000000000P01',
        ownerUserId: OWNER_ID,
        type,
        occurredAt: AT,
        lastDispatchedAt: AT,
      })),
    );

    expect(await db.$count(productLifecycleEvents)).toBe(5);
  });
});

describe('スクリーンショットの位置', () => {
  test('位置0〜19は受け付け、位置20と負の位置を拒否する', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    // D1は1文のバインド変数を100個までに限るため、行ごとの文に分けて一括で実行する
    const [first, ...rest] = Array.from({ length: 20 }, (_, position) =>
      db.insert(productScreenshots).values({
        productId: '01JD0000000000000000000P01',
        position,
        fileId: `screenshot-${String(position)}`,
      }),
    );
    if (first === undefined) {
      throw new Error('スクリーンショットの文がありません');
    }
    await db.batch([first, ...rest]);

    for (const position of [20, -1]) {
      expect(
        await rejectionMessagesOf(
          db.insert(productScreenshots).values({
            productId: '01JD0000000000000000000P01',
            position,
            fileId: 'screenshot-out-of-range',
          }),
        ),
      ).toContainEqual(
        expect.stringContaining(
          'CHECK constraint failed: product_screenshots_position_check',
        ),
      );
    }
    expect(await db.$count(productScreenshots)).toBe(20);
  });

  test('同じプロダクトの同じ位置に2枚置けない', async () => {
    await insertProduct('01JD0000000000000000000P01', 'first');
    await db.insert(productScreenshots).values({
      productId: '01JD0000000000000000000P01',
      position: 0,
      fileId: 'screenshot-a',
    });

    expect(
      await rejectionMessagesOf(
        db.insert(productScreenshots).values({
          productId: '01JD0000000000000000000P01',
          position: 0,
          fileId: 'screenshot-b',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: product_screenshots.product_id, product_screenshots.position',
      ),
    );
  });
});
