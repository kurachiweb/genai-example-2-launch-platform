import { resetSync } from '@logtape/logtape';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type { NoticeRequester } from '../../core/sponsorship/ports.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import type { FulfillmentPlan } from '../payments/fulfillment-contract.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { D1LaunchExport } from '../product/d1-product-export.ts';
import { D1EligibleProductReader } from './d1-eligible-product-reader.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import { SponsorshipFulfillment } from './sponsorship-fulfillment.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  readSponsorshipRow,
  type SponsorshipFixture,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  sponsorshipPurchaseIdOf,
  T0,
  terminatedColumnsOf,
  TODAY,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface RecordingRequester extends NoticeRequester {
  readonly requested: number;
}

const OWNER = 1;
const OTHER_USER = 2;
const AMOUNT_TOTAL = 7_000;

const REJECTED: FulfillmentPlan = { kind: 'reject', reason: 'ineligible' };

// 基準時刻(UTC-08:00)の2026-11-25の0:07
const START_NOTICE_AT = new Date('2026-11-25T08:07:00.000Z');

// 開始日が今日(2026-11-25)の3日間の申込の列
const STARTING_TODAY = Object.freeze({
  startsOn: TODAY,
  endsOn: '2026-11-27',
  days: 3,
});

function createRequester(failure?: Error): RecordingRequester {
  let requested = 0;
  return {
    get requested() {
      return requested;
    },
    request: () => {
      requested += 1;
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
    requestSettlement: () => Promise.reject(new Error('テストでは使わない')),
  };
}

function createFulfillment(
  notices: NoticeRequester = createRequester(),
  appName: 'api' | 'event' = 'event',
): SponsorshipFulfillment {
  return new SponsorshipFulfillment({
    appName,
    store: new D1SponsorshipStore(db, createSequentialSponsorshipIds()),
    eligibleProducts: new D1EligibleProductReader(
      new D1LaunchExport(db),
      new D1ProductDirectory(db),
    ),
    notices,
  });
}

function purchaseOf(
  input: {
    readonly user?: number;
    readonly sponsorship?: number | null;
    readonly paidAt?: Date;
  } = {},
): FulfillablePurchase {
  const sponsorship = input.sponsorship === undefined ? 1 : input.sponsorship;
  const targetId = sponsorship === null ? null : sponsorshipIdOf(sponsorship);
  return {
    purchaseId: sponsorshipPurchaseIdOf(1),
    userId: userIdOf(input.user ?? OWNER),
    kind: 'sponsorship',
    targetId,
    relatedId: targetId,
    quantity: 7,
    amountTotal: AMOUNT_TOTAL,
    paymentRecordId: sponsorshipPaymentRecordIdOf(1),
    paidAt: input.paidAt ?? NOW,
    stripeSubscriptionId: null,
  };
}

function statementsOf(plan: FulfillmentPlan): readonly BatchItem<'sqlite'>[] {
  if (plan.kind !== 'fulfill') {
    throw new Error('掲載権の付与が拒否されました');
  }
  return plan.statements;
}

// 決済の機能と同じく、返した文を他の文と1回の一括の書き込みで実行する。他の文は申込2の更新日時を書き換える
async function commit(plan: FulfillmentPlan): Promise<void> {
  await db.batch([
    db
      .update(sponsorships)
      .set({ updatedAt: NOW })
      .where(eq(sponsorships.id, sponsorshipIdOf(2))),
    ...statementsOf(plan),
  ]);
}

// 申込1(投稿者1・プロダクト1・Gold・12-01〜12-07)と、一括の書き込みの取り消しを確かめる申込2(プロダクト2)を作る
async function seedSponsorship(
  columns: SponsorshipFixture['columns'] = {},
): Promise<void> {
  await insertSponsorships([
    { index: 1, owner: OWNER, product: 1, columns },
    { index: 2, owner: OWNER, product: 2 },
  ]);
}

function recordLogs(appName: 'api' | 'event' = 'event'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorProduct({ index: 2, owner: OWNER });
});

afterAll(() => {
  resetSync();
});

describe('SponsorshipFulfillment', () => {
  describe('prepare', () => {
    test('判定に通れば、決済済みと金額・記録の識別・決済の時刻を保存する1つの文を返す', async () => {
      await seedSponsorship();

      const plan = await createFulfillment().prepare(purchaseOf(), db);
      expect(statementsOf(plan)).toHaveLength(1);
      await commit(plan);

      expect(await readSponsorshipRow(1)).toMatchObject({
        state: 'paid',
        purchaseId: sponsorshipPurchaseIdOf(1),
        paymentRecordId: sponsorshipPaymentRecordIdOf(1),
        amountTotal: AMOUNT_TOTAL,
        paidAt: NOW,
        startNotice: 'none',
        updatedAt: NOW,
      });
    });

    test('対象の申込が指定されなければ拒否する', async () => {
      await seedSponsorship();

      await expect(
        createFulfillment().prepare(purchaseOf({ sponsorship: null }), db),
      ).resolves.toEqual(REJECTED);
    });

    test('存在しない申込は拒否する', async () => {
      await seedSponsorship();

      await expect(
        createFulfillment().prepare(purchaseOf({ sponsorship: 9 }), db),
      ).resolves.toEqual(REJECTED);
    });

    test('論理削除された申込は拒否する', async () => {
      await seedSponsorship({ deletedAt: T0 });

      await expect(
        createFulfillment().prepare(purchaseOf(), db),
      ).resolves.toEqual(REJECTED);
    });

    test('申込者以外の決済は拒否する', async () => {
      await seedSponsorship();

      await expect(
        createFulfillment().prepare(purchaseOf({ user: OTHER_USER }), db),
      ).resolves.toEqual(REJECTED);
    });

    test('プロダクトが非公開化されていれば拒否する', async () => {
      await clearSponsorshipTables();
      await insertSponsorUser(OWNER);
      await insertSponsorProduct({ index: 1, owner: OWNER, state: 'hidden' });
      await insertSponsorProduct({ index: 2, owner: OWNER });
      await seedSponsorship();

      await expect(
        createFulfillment().prepare(purchaseOf(), db),
      ).resolves.toEqual(REJECTED);
    });

    test('申込の対象の判定は決済の時刻で行う', async () => {
      await clearSponsorshipTables();
      await insertSponsorUser(OWNER);
      await insertSponsorProduct({
        index: 1,
        owner: OWNER,
        launches: ['before_kickoff'],
      });
      await insertSponsorProduct({ index: 2, owner: OWNER });
      await seedSponsorship();

      await expect(
        createFulfillment().prepare(purchaseOf(), db),
      ).resolves.toEqual(REJECTED);
    });

    test('同じプロダクト・同じティアの決済済みの申込と1日でも重なれば拒否する', async () => {
      await seedSponsorship();
      await insertSponsorships([
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: paidColumnsOf(3, {
            startsOn: '2026-12-07',
            endsOn: '2026-12-10',
            days: 4,
          }),
        },
      ]);

      await expect(
        createFulfillment().prepare(purchaseOf(), db),
      ).resolves.toEqual(REJECTED);
    });

    test('開始日の当日の決済は、開始日が今日より前かを判定せずに受け付ける', async () => {
      await seedSponsorship(STARTING_TODAY);

      const plan = await createFulfillment().prepare(
        purchaseOf({ paidAt: new Date('2026-11-26T07:59:59.999Z') }),
        db,
      );
      await commit(plan);

      expect(await readSponsorshipRow(1)).toMatchObject({ state: 'paid' });
    });

    describe('文の実行の時点で条件が崩れていれば、一括の書き込み全体が取り消される', () => {
      async function expectRolledBack(plan: FulfillmentPlan): Promise<void> {
        await expect(commit(plan)).rejects.toThrow(
          /NOT NULL constraint failed: sponsorships\.state/u,
        );
        expect(await readSponsorshipRow(1)).toMatchObject({
          state: 'pending_payment',
          purchaseId: null,
          paymentRecordId: null,
          amountTotal: null,
          paidAt: null,
          updatedAt: T0,
        });
        expect(await readSponsorshipRow(2)).toMatchObject({ updatedAt: T0 });
      }

      test('判定の後に申込が論理削除された', async () => {
        await seedSponsorship();
        const plan = await createFulfillment().prepare(purchaseOf(), db);
        await db
          .update(sponsorships)
          .set({ deletedAt: NOW })
          .where(eq(sponsorships.id, sponsorshipIdOf(1)));

        await expect(commit(plan)).rejects.toThrow(
          /NOT NULL constraint failed: sponsorships\.state/u,
        );
        expect(await readSponsorshipRow(1)).toMatchObject({
          state: 'pending_payment',
          purchaseId: null,
        });
        expect(await readSponsorshipRow(2)).toMatchObject({ updatedAt: T0 });
      });

      test('判定の後に重なる申込が決済済みになった', async () => {
        await seedSponsorship();
        const plan = await createFulfillment().prepare(purchaseOf(), db);
        await insertSponsorships([
          {
            index: 3,
            owner: OTHER_USER,
            product: 1,
            columns: paidColumnsOf(3, {
              startsOn: '2026-11-28',
              endsOn: '2026-12-01',
              days: 4,
            }),
          },
        ]);

        await expectRolledBack(plan);
      });

      test('判定の後に同じ申込が別の購入で決済済みになった', async () => {
        await seedSponsorship();
        const plan = await createFulfillment().prepare(purchaseOf(), db);
        await db
          .update(sponsorships)
          .set(paidColumnsOf(9))
          .where(eq(sponsorships.id, sponsorshipIdOf(1)));

        await expect(commit(plan)).rejects.toThrow(
          /NOT NULL constraint failed: sponsorships\.state/u,
        );
        expect(await readSponsorshipRow(1)).toMatchObject({
          state: 'paid',
          purchaseId: sponsorshipPurchaseIdOf(9),
        });
        expect(await readSponsorshipRow(2)).toMatchObject({ updatedAt: T0 });
      });
    });

    test.each<[string, SponsorshipFixture]>([
      [
        '別のプロダクト',
        {
          index: 3,
          owner: OWNER,
          product: 2,
          columns: paidColumnsOf(3),
        },
      ],
      [
        '別のティア',
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: paidColumnsOf(3, { tier: 'silver' }),
        },
      ],
      [
        '強制終了された',
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: terminatedColumnsOf(3),
        },
      ],
      [
        '論理削除された',
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: paidColumnsOf(3, { deletedAt: T0 }),
        },
      ],
      [
        'プロダクトの論理削除が記録された',
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: paidColumnsOf(3, { productDeletedAt: T0 }),
        },
      ],
      [
        '隣り合う期間の',
        {
          index: 3,
          owner: OTHER_USER,
          product: 1,
          columns: paidColumnsOf(3, {
            startsOn: '2026-12-08',
            endsOn: '2026-12-10',
            days: 3,
          }),
        },
      ],
    ])(
      '判定の後に%s決済済みの申込ができても、文は申込を決済済みにする',
      async (_, fixture) => {
        await seedSponsorship();
        const plan = await createFulfillment().prepare(purchaseOf(), db);
        await insertSponsorships([fixture]);

        await commit(plan);

        expect(await readSponsorshipRow(1)).toMatchObject({ state: 'paid' });
        expect(await readSponsorshipRow(2)).toMatchObject({ updatedAt: NOW });
      },
    );

    test.each([
      ['決済済み', paidColumnsOf(9)],
      ['強制終了された', terminatedColumnsOf(9)],
    ])(
      '%sの申込への2回目の決済は、決済の機能が二重決済として扱えるよう、実行すると失敗する文を返す',
      async (_, columns) => {
        await seedSponsorship(columns);

        const plan = await createFulfillment().prepare(purchaseOf(), db);

        await expect(commit(plan)).rejects.toThrow(
          /NOT NULL constraint failed: sponsorships\.state/u,
        );
        expect(await readSponsorshipRow(1)).toMatchObject({
          purchaseId: sponsorshipPurchaseIdOf(9),
        });
      },
    );

    test.each([
      ['開始日の前日の23:59', new Date('2026-11-25T07:59:59.999Z'), 'none'],
      ['開始日の0:06', new Date('2026-11-25T08:06:59.999Z'), 'none'],
      ['開始日の0:07', START_NOTICE_AT, 'pending'],
      ['開始日の23:59', new Date('2026-11-26T07:59:59.999Z'), 'pending'],
    ])(
      '%sの決済の確定では、開始通知を%sにする',
      async (_, paidAt, startNotice) => {
        await seedSponsorship(STARTING_TODAY);

        await commit(
          await createFulfillment().prepare(purchaseOf({ paidAt }), db),
        );

        expect(await readSponsorshipRow(1)).toMatchObject({
          state: 'paid',
          paidAt,
          startNotice,
        });
      },
    );
  });

  describe('afterCommit', () => {
    async function fulfill(
      fulfillment: SponsorshipFulfillment,
      purchase: FulfillablePurchase,
    ): Promise<void> {
      await commit(await fulfillment.prepare(purchase, db));
      await fulfillment.afterCommit(purchase);
    }

    test('開始通知を依頼待ちにした確定の後に、送信を1回依頼する', async () => {
      await seedSponsorship(STARTING_TODAY);
      const requester = createRequester();

      await fulfill(
        createFulfillment(requester),
        purchaseOf({ paidAt: START_NOTICE_AT }),
      );

      expect(requester.requested).toBe(1);
    });

    test.each([
      ['開始日より前', NOW],
      ['開始日の0:07より前', new Date('2026-11-25T08:06:59.999Z')],
    ])(
      '%sの確定は開始通知が未依頼のため、送信を依頼しない',
      async (_, paidAt) => {
        await seedSponsorship(STARTING_TODAY);
        const requester = createRequester();

        await fulfill(createFulfillment(requester), purchaseOf({ paidAt }));

        expect(requester.requested).toBe(0);
      },
    );

    test('確定の後に申込が論理削除されていれば、送信を依頼しない', async () => {
      await seedSponsorship(STARTING_TODAY);
      const requester = createRequester();
      const fulfillment = createFulfillment(requester);
      const purchase = purchaseOf({ paidAt: START_NOTICE_AT });
      await commit(await fulfillment.prepare(purchase, db));
      await db
        .update(sponsorships)
        .set({ deletedAt: START_NOTICE_AT })
        .where(eq(sponsorships.id, sponsorshipIdOf(1)));

      await fulfillment.afterCommit(purchase);

      expect(requester.requested).toBe(0);
    });

    test('送信の依頼の失敗は例外にせず、購入と申込のIDを添えたwarnのログで終える', async () => {
      const logs = recordLogs();
      await seedSponsorship(STARTING_TODAY);
      const failure = new Error('Queueへの送信に失敗しました');
      const requester = createRequester(failure);
      const fulfillment = createFulfillment(requester);
      const purchase = purchaseOf({ paidAt: START_NOTICE_AT });
      await commit(await fulfillment.prepare(purchase, db));

      await expect(fulfillment.afterCommit(purchase)).resolves.toBeUndefined();

      expect(requester.requested).toBe(1);
      const warnings = logs.filter(({ level }) => level === 'warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        category: 'event.sponsorship.fulfillment',
        purchaseId: sponsorshipPurchaseIdOf(1),
        sponsorshipId: sponsorshipIdOf(1),
        error: { name: 'Error', message: failure.message },
      });
      expect(await readSponsorshipRow(1)).toMatchObject({
        startNotice: 'pending',
      });
    });

    test('ログのカテゴリは束縛したアプリの名前で始まる', async () => {
      const logs = recordLogs('api');
      await seedSponsorship(STARTING_TODAY);
      const fulfillment = createFulfillment(
        createRequester(new Error('送信の失敗')),
        'api',
      );
      const purchase = purchaseOf({ paidAt: START_NOTICE_AT });
      await commit(await fulfillment.prepare(purchase, db));

      await fulfillment.afterCommit(purchase);

      expect(
        logs
          .filter(({ level }) => level === 'warning')
          .map(({ category }) => category),
      ).toEqual(['api.sponsorship.fulfillment']);
    });
  });
});
