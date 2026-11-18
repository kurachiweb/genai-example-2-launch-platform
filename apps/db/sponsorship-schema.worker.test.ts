import { env } from 'cloudflare:workers';
import { eq, ne, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { productCategories } from './schema/product/product-categories.ts';
import { products } from './schema/product/products.ts';
import { sponsorshipDisplayStops } from './schema/sponsorship/sponsorship-display-stops.ts';
import { sponsorships } from './schema/sponsorship/sponsorships.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const PRODUCT_ID = '01JD0000000000000000000P01';

const SPONSORSHIP_ID = '01JD0000000000000000000S01';

const AT = new Date(Date.UTC(2026, 10, 18));

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

function sponsorshipOf(
  overrides: Partial<typeof sponsorships.$inferInsert> = {},
): typeof sponsorships.$inferInsert {
  return {
    id: SPONSORSHIP_ID,
    userId: OWNER_ID,
    productId: PRODUCT_ID,
    tier: 'gold',
    startsOn: '2026-11-20',
    endsOn: '2026-11-26',
    days: 7,
    state: 'pending_payment',
    ...overrides,
  };
}

const PAID_COLUMNS = {
  state: 'paid',
  purchaseId: '01JD0000000000000000000Q01',
  paymentRecordId: '01JD0000000000000000000R01',
  amountTotal: 7000,
  paidAt: AT,
} as const;

beforeEach(async () => {
  await db.delete(sponsorshipDisplayStops);
  await db.delete(sponsorships);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await db.insert(users).values({
    id: OWNER_ID,
    pseudonymousId: 'pseudonymous-0',
    email: 'user0@launch.example',
    passwordHash: 'hash',
    nickname: '利用者0',
    handle: 'user0',
    termsAgreedAt: AT,
  });
  await db.insert(products).values({
    id: PRODUCT_ID,
    userId: OWNER_ID,
    categoryId: OTHER_CATEGORY_ID,
    handle: 'first',
    name: '名称',
    tagline: 'タグライン',
    websiteUrl: 'https://product.example/',
    descriptionMarkdown: '説明文',
    logoFileId: 'logo-first',
    latestLaunchDate: '2026-11-16',
  });
});

describe('申込の制約', () => {
  test('決済待ちの申込は掲載権の列が無くても作れ、通知と返金の状態の既定はnoneになる', async () => {
    await db.insert(sponsorships).values(sponsorshipOf());

    const rows = await db
      .select({
        startNotice: sponsorships.startNotice,
        endNotice: sponsorships.endNotice,
        terminationNotice: sponsorships.terminationNotice,
        terminationRefundStatus: sponsorships.terminationRefundStatus,
        stopRefundStatus: sponsorships.stopRefundStatus,
      })
      .from(sponsorships);

    expect(rows).toEqual([
      {
        startNotice: 'none',
        endNotice: 'none',
        terminationNotice: 'none',
        terminationRefundStatus: 'none',
        stopRefundStatus: 'none',
      },
    ]);
  });

  test.each([
    ['tier', { tier: 'bronze' as 'gold' }, 'sponsorships_tier_check'],
    ['state', { state: 'refunded' as 'paid' }, 'sponsorships_state_check'],
    [
      'start_notice',
      { startNotice: 'sent' as 'pending' },
      'sponsorships_start_notice_check',
    ],
    [
      'end_notice',
      { endNotice: 'sent' as 'pending' },
      'sponsorships_end_notice_check',
    ],
    [
      'termination_notice',
      { terminationNotice: 'sent' as 'pending' },
      'sponsorships_termination_notice_check',
    ],
    [
      'termination_refund_status',
      { terminationRefundStatus: 'pending' as 'requested' },
      'sponsorships_termination_refund_status_check',
    ],
    [
      'stop_refund_status',
      { stopRefundStatus: 'pending' as 'requested' },
      'sponsorships_stop_refund_status_check',
    ],
    ['days(0)', { days: 0 }, 'sponsorships_days_range_check'],
    ['days(367)', { days: 367 }, 'sponsorships_days_range_check'],
  ])('%sが範囲の外の申込は作れない', async (_label, overrides, constraint) => {
    expect(
      await rejectionMessagesOf(
        db.insert(sponsorships).values(sponsorshipOf(overrides)),
      ),
    ).toContainEqual(
      expect.stringContaining(`CHECK constraint failed: ${constraint}`),
    );
  });

  test('掲載期間の日数は1日と366日で作れる', async () => {
    await db
      .insert(sponsorships)
      .values([
        sponsorshipOf({ days: 1 }),
        sponsorshipOf({ id: '01JD0000000000000000000S02', days: 366 }),
      ]);

    expect(await db.$count(sponsorships)).toBe(2);
  });

  test.each([
    'purchaseId',
    'paymentRecordId',
    'amountTotal',
    'paidAt',
  ] as const)('決済済みの申込は%sが無いと作れない', async (column) => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(sponsorships)
          .values(sponsorshipOf({ ...PAID_COLUMNS, [column]: null })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: sponsorships_paid_columns_check',
      ),
    );
  });

  test.each(['terminatedAt', 'terminationReason'] as const)(
    '強制終了した申込は%sが無いと作れない',
    async (column) => {
      expect(
        await rejectionMessagesOf(
          db.insert(sponsorships).values(
            sponsorshipOf({
              ...PAID_COLUMNS,
              state: 'terminated',
              terminatedAt: AT,
              terminationReason: '規約違反',
              [column]: null,
            }),
          ),
        ),
      ).toContainEqual(
        expect.stringContaining(
          'CHECK constraint failed: sponsorships_terminated_columns_check',
        ),
      );
    },
  );

  test('強制終了した申込は掲載権の列が無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(sponsorships).values(
          sponsorshipOf({
            state: 'terminated',
            terminatedAt: AT,
            terminationReason: '規約違反',
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: sponsorships_paid_columns_check',
      ),
    );
  });

  test('決済済みと強制終了の申込は必要な列と返金の状態・日数・金額・依頼の識別があれば作れる', async () => {
    await db.insert(sponsorships).values([
      sponsorshipOf(PAID_COLUMNS),
      sponsorshipOf({
        ...PAID_COLUMNS,
        id: '01JD0000000000000000000S02',
        state: 'terminated',
        terminatedAt: AT,
        terminationReason: '規約違反',
        terminationNotice: 'pending',
        terminationRefundStatus: 'requested',
        terminationRefundDays: 3,
        terminationRefundAmount: 3000,
        terminationRefundRequestId: '01JD0000000000000000000F01',
        stopRefundStatus: 'already_refunded',
        stopRefundDays: 1,
        stopRefundAmount: 1000,
        stopRefundRequestId: '01JD0000000000000000000F02',
      }),
    ]);

    expect(await db.$count(sponsorships)).toBe(2);
  });

  // 掲載権の確定と強制終了は、条件が崩れたときに状態をNULLにしてNOT NULL制約の違反で一括の書き込みを取り消すため、CHECK制約より先にNOT NULL制約が報告されることを確かめる
  test('状態をNULLにする更新はCHECK制約ではなくNOT NULL制約の違反になる', async () => {
    await db.insert(sponsorships).values(sponsorshipOf());

    const messages = await rejectionMessagesOf(
      db.run(
        sql`UPDATE sponsorships SET state = CASE WHEN state = 'paid' THEN 'paid' ELSE NULL END, purchase_id = ${PAID_COLUMNS.purchaseId}, payment_record_id = ${PAID_COLUMNS.paymentRecordId}, amount_total = ${PAID_COLUMNS.amountTotal}, paid_at = ${AT.getTime()} WHERE id = ${SPONSORSHIP_ID}`,
      ),
    );

    expect(messages).toContainEqual(
      expect.stringContaining('NOT NULL constraint failed: sponsorships.state'),
    );
    expect(messages.join('\n')).not.toContain('CHECK constraint failed');
  });

  test('利用者とプロダクトは存在する行だけを参照でき、購入と決済履歴の記録のIDは外部キーを持たない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(sponsorships)
          .values(sponsorshipOf({ userId: '01JD0000000000000000000U99' })),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
    expect(
      await rejectionMessagesOf(
        db
          .insert(sponsorships)
          .values(sponsorshipOf({ productId: '01JD0000000000000000000P99' })),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.insert(sponsorships).values(sponsorshipOf(PAID_COLUMNS));

    expect(await db.$count(sponsorships)).toBe(1);
  });

  test('申込が残るプロダクトは物理削除できず、申込を消した後なら消せる', async () => {
    await db.insert(sponsorships).values(sponsorshipOf());

    expect(
      await rejectionMessagesOf(
        db.delete(products).where(eq(products.id, PRODUCT_ID)),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.delete(sponsorships).where(eq(sponsorships.id, SPONSORSHIP_ID));
    await db.delete(products).where(eq(products.id, PRODUCT_ID));

    expect(await db.$count(products)).toBe(0);
  });
});

describe('表示停止の区間の制約', () => {
  test('主体の種類はプロダクトと利用者に限る', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(sponsorshipDisplayStops).values({
          subjectKind: 'launch' as 'product',
          subjectId: PRODUCT_ID,
          startedAt: AT,
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: sponsorship_display_stops_subject_kind_check',
      ),
    );
  });

  test('外部キーを持たないため、存在しない主体の区間も記録でき、継続中の区間は終わりがNULLになる', async () => {
    await db.insert(sponsorshipDisplayStops).values([
      {
        subjectKind: 'product',
        subjectId: '01JD0000000000000000000P99',
        startedAt: AT,
      },
      {
        subjectKind: 'user',
        subjectId: OWNER_ID,
        startedAt: AT,
        endedAt: new Date(AT.getTime() + 1000),
      },
    ]);

    const rows = await db
      .select({
        subjectKind: sponsorshipDisplayStops.subjectKind,
        endedAt: sponsorshipDisplayStops.endedAt,
      })
      .from(sponsorshipDisplayStops)
      .orderBy(sponsorshipDisplayStops.subjectKind);

    expect(rows).toEqual([
      { subjectKind: 'product', endedAt: null },
      { subjectKind: 'user', endedAt: new Date(AT.getTime() + 1000) },
    ]);
  });

  test('区間が残る利用者も物理削除できる', async () => {
    await db.delete(products);
    await db.insert(sponsorshipDisplayStops).values({
      subjectKind: 'user',
      subjectId: OWNER_ID,
      startedAt: AT,
    });

    await db.delete(users).where(eq(users.id, OWNER_ID));

    expect(await db.$count(users)).toBe(0);
    expect(await db.$count(sponsorshipDisplayStops)).toBe(1);
  });
});
