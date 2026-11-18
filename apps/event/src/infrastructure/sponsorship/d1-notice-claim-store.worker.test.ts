import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { D1SponsorshipStore } from '../../../lib/workers/sponsorship/d1-sponsorship-store.ts';
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
  sponsorshipIdOf,
  T0,
  terminatedColumnsOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import type { PendingSponsorshipNotice } from '../../application/sponsorship/ports.ts';
import { D1NoticeClaimStore } from './d1-notice-claim-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const PRODUCT = 1;

const LATER = new Date(NOW.getTime() + 60_000);

const store = new D1NoticeClaimStore(
  db,
  new D1SponsorshipStore(db, createSequentialSponsorshipIds()),
);

function minutesAfterT0(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

function noticeOf(
  index: number,
  kind: PendingSponsorshipNotice['kind'],
): PendingSponsorshipNotice {
  return { sponsorshipId: sponsorshipIdOf(index), kind };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
});

describe('D1NoticeClaimStore.listPending', () => {
  test('論理削除・強制終了の申込を含む全ての依頼待ちの通知を、依頼待ちになった時刻とIDの順に返す', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, {
          startNotice: 'pending',
          endNotice: 'pending',
          updatedAt: minutesAfterT0(3),
        }),
      },
      {
        index: 2,
        owner: OWNER,
        product: PRODUCT,
        columns: terminatedColumnsOf(2, {
          terminationNotice: 'pending',
          deletedAt: T0,
          updatedAt: minutesAfterT0(1),
        }),
      },
      {
        index: 3,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(3, {
          startNotice: 'requested',
          endNotice: 'skipped',
          updatedAt: minutesAfterT0(0),
        }),
      },
      {
        index: 4,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(4, {
          startNotice: 'pending',
          updatedAt: minutesAfterT0(1),
        }),
      },
    ]);

    await expect(store.listPending(20)).resolves.toStrictEqual([
      noticeOf(2, 'termination'),
      noticeOf(4, 'start'),
      noticeOf(1, 'start'),
      noticeOf(1, 'end'),
    ]);
  });

  test('上限の件数までを返す', async () => {
    await insertSponsorships(
      [1, 2, 3].map((index) => ({
        index,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(index, {
          startNotice: 'pending',
          endNotice: 'pending',
        }),
      })),
    );

    await expect(store.listPending(3)).resolves.toStrictEqual([
      noticeOf(1, 'start'),
      noticeOf(1, 'end'),
      noticeOf(2, 'start'),
    ]);
  });

  test('依頼待ちが無ければ空を返す', async () => {
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(1) },
    ]);

    await expect(store.listPending(20)).resolves.toStrictEqual([]);
  });
});

describe('D1NoticeClaimStore.claim', () => {
  test('依頼待ちの通知を依頼済みにして申込の記録を返し、同じ通知を2回取らない', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, {
          startNotice: 'pending',
          endNotice: 'pending',
        }),
      },
    ]);

    const first = await store.claim(noticeOf(1, 'start'), NOW);
    const second = await store.claim(noticeOf(1, 'start'), LATER);

    expect(first).toMatchObject({
      kind: 'claimed',
      record: { id: sponsorshipIdOf(1), state: 'paid' },
    });
    expect(second).toBeUndefined();
    expect(await readSponsorshipRow(1)).toMatchObject({
      startNotice: 'requested',
      endNotice: 'pending',
      terminationNotice: 'none',
      updatedAt: NOW,
    });
  });

  test('同時に取り合っても1つの処理だけが取る', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: terminatedColumnsOf(1, { terminationNotice: 'pending' }),
      },
    ]);

    const results = await Promise.all([
      store.claim(noticeOf(1, 'termination'), NOW),
      store.claim(noticeOf(1, 'termination'), NOW),
    ]);

    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
  });

  test('論理削除された申込の通知も依頼済みに取り、記録を返さずに論理削除を知らせる', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, { endNotice: 'pending', deletedAt: T0 }),
      },
    ]);

    await expect(store.claim(noticeOf(1, 'end'), NOW)).resolves.toStrictEqual({
      kind: 'deleted',
    });
    expect((await readSponsorshipRow(1))?.endNotice).toBe('requested');
  });

  test('依頼待ちでない通知と存在しない申込は取らない', async () => {
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(1) },
    ]);

    await expect(
      store.claim(noticeOf(1, 'start'), NOW),
    ).resolves.toBeUndefined();
    await expect(
      store.claim(noticeOf(9, 'start'), NOW),
    ).resolves.toBeUndefined();
    expect((await readSponsorshipRow(1))?.startNotice).toBe('none');
  });
});

describe('D1NoticeClaimStore.claimの取った後の失敗', () => {
  test('取った後の申込の読み取りが失敗したら、通知を依頼待ちに戻してから例外を返す', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, { startNotice: 'pending' }),
      },
    ]);
    const failure = new Error('D1の一時的な障害');
    const sponsorshipStore = new D1SponsorshipStore(
      db,
      createSequentialSponsorshipIds(),
    );
    vi.spyOn(sponsorshipStore, 'findById').mockRejectedValue(failure);
    const failingStore = new D1NoticeClaimStore(db, sponsorshipStore);

    const caught = await failingStore
      .claim(noticeOf(1, 'start'), NOW)
      .catch((cause: unknown) => cause);

    expect(caught).toBe(failure);
    expect((await readSponsorshipRow(1))?.startNotice).toBe('pending');
    await expect(store.listPending(20)).resolves.toStrictEqual([
      noticeOf(1, 'start'),
    ]);
  });
});

describe('D1NoticeClaimStore.markSkipped・release', () => {
  test('依頼済みの通知を送らないと記録し、他の通知の状態を変えない', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, {
          startNotice: 'requested',
          endNotice: 'pending',
        }),
      },
    ]);

    await store.markSkipped(noticeOf(1, 'start'), LATER);

    expect(await readSponsorshipRow(1)).toMatchObject({
      startNotice: 'skipped',
      endNotice: 'pending',
      updatedAt: LATER,
    });
  });

  test('一時的な失敗の通知を依頼待ちに戻し、依頼待ちの並びの後ろへ回す', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, { startNotice: 'requested' }),
      },
      {
        index: 2,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(2, {
          startNotice: 'pending',
          updatedAt: NOW,
        }),
      },
    ]);

    await store.release(noticeOf(1, 'start'), LATER);

    expect(await readSponsorshipRow(1)).toMatchObject({
      startNotice: 'pending',
      updatedAt: LATER,
    });
    await expect(store.listPending(20)).resolves.toStrictEqual([
      noticeOf(2, 'start'),
      noticeOf(1, 'start'),
    ]);
  });

  test('依頼済みでない通知は送らないとも依頼待ちとも記録しない', async () => {
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, {
          startNotice: 'pending',
          endNotice: 'none',
        }),
      },
    ]);

    await store.markSkipped(noticeOf(1, 'start'), LATER);
    await store.release(noticeOf(1, 'end'), LATER);

    expect(await readSponsorshipRow(1)).toMatchObject({
      startNotice: 'pending',
      endNotice: 'none',
      updatedAt: T0,
    });
  });
});
