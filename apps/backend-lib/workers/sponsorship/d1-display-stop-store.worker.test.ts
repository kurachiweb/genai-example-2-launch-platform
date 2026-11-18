import { beforeEach, describe, expect, test } from 'vitest';

import type { DisplayStopSubject } from '../../core/sponsorship/ports.ts';
import { D1DisplayStopStore } from './d1-display-stop-store.ts';
import {
  clearSponsorshipTables,
  db,
  displayStopIdOf,
  insertDisplayStops,
  productIdOf,
  readDisplayStopRows,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const store = new D1DisplayStopStore(db);

const PRODUCT: DisplayStopSubject = {
  kind: 'product',
  productId: productIdOf(1),
};

const OTHER_PRODUCT: DisplayStopSubject = {
  kind: 'product',
  productId: productIdOf(2),
};

const USER: DisplayStopSubject = { kind: 'user', userId: userIdOf(1) };

const OTHER_USER: DisplayStopSubject = { kind: 'user', userId: userIdOf(2) };

// 基準時刻(UTC-08:00)の2026-12-01 0:00(掲載開始日)と2026-12-08 0:00(数え終わりの日の翌日)
const FROM = new Date('2026-12-01T08:00:00.000Z');
const TO = new Date('2026-12-08T08:00:00.000Z');

function at(iso: string): Date {
  return new Date(iso);
}

const OVERLAP_INPUT = {
  productId: productIdOf(1),
  userId: userIdOf(1),
  from: FROM,
  to: TO,
} as const;

beforeEach(async () => {
  await clearSponsorshipTables();
});

describe('D1DisplayStopStore.listOverlapping', () => {
  test('掲載期間に重なるプロダクトと投稿者の区間だけを、始まりの順に返す', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: at('2026-11-20T10:00:00.000Z'),
        endedAt: at('2026-11-22T10:00:00.000Z'),
      },
      {
        index: 2,
        subject: PRODUCT,
        startedAt: at('2026-11-29T10:00:00.000Z'),
        endedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 3,
        subject: USER,
        startedAt: at('2026-12-03T10:00:00.000Z'),
        endedAt: at('2026-12-04T10:00:00.000Z'),
      },
      {
        index: 4,
        subject: USER,
        startedAt: at('2026-12-06T10:00:00.000Z'),
      },
      {
        index: 5,
        subject: PRODUCT,
        startedAt: at('2026-12-09T10:00:00.000Z'),
      },
      {
        index: 6,
        subject: OTHER_PRODUCT,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 7,
        subject: OTHER_USER,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
    ]);

    expect(await store.listOverlapping(OVERLAP_INPUT)).toEqual([
      {
        startedAt: at('2026-11-29T10:00:00.000Z'),
        endedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        startedAt: at('2026-12-03T10:00:00.000Z'),
        endedAt: at('2026-12-04T10:00:00.000Z'),
      },
      { startedAt: at('2026-12-06T10:00:00.000Z'), endedAt: null },
    ]);
  });

  test('掲載期間より前に始まり継続中の区間を返す', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: USER,
        startedAt: at('2026-10-01T10:00:00.000Z'),
      },
    ]);

    expect(await store.listOverlapping(OVERLAP_INPUT)).toEqual([
      { startedAt: at('2026-10-01T10:00:00.000Z'), endedAt: null },
    ]);
  });

  test('掲載開始日の0:00ちょうどに終わった区間と、数え終わりの日の翌日0:00ちょうどに始まった区間を返さない', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: at('2026-11-30T10:00:00.000Z'),
        endedAt: FROM,
      },
      { index: 2, subject: USER, startedAt: TO },
    ]);

    expect(await store.listOverlapping(OVERLAP_INPUT)).toEqual([]);
  });

  test('掲載開始日の0:00の直後に終わった区間と、数え終わりの日の終わりの直前に始まった区間を返す', async () => {
    const endedJustAfterFrom = new Date(FROM.getTime() + 1);
    const startedJustBeforeTo = new Date(TO.getTime() - 1);
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: at('2026-11-30T10:00:00.000Z'),
        endedAt: endedJustAfterFrom,
      },
      { index: 2, subject: USER, startedAt: startedJustBeforeTo },
    ]);

    expect(await store.listOverlapping(OVERLAP_INPUT)).toEqual([
      {
        startedAt: at('2026-11-30T10:00:00.000Z'),
        endedAt: endedJustAfterFrom,
      },
      { startedAt: startedJustBeforeTo, endedAt: null },
    ]);
  });

  test('主体の種類が違う同じIDの区間を返さない', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: { kind: 'user', userId: productIdOf(1) },
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 2,
        subject: { kind: 'product', productId: userIdOf(1) },
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
    ]);

    expect(await store.listOverlapping(OVERLAP_INPUT)).toEqual([]);
  });
});

describe('D1DisplayStopStore.deleteSubject', () => {
  test('主体の継続中と終わった区間を全て消し、他の主体と種類の違う同じIDの区間を残す', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: at('2026-11-20T10:00:00.000Z'),
        endedAt: at('2026-11-22T10:00:00.000Z'),
      },
      {
        index: 2,
        subject: PRODUCT,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 3,
        subject: OTHER_PRODUCT,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 4,
        subject: { kind: 'user', userId: productIdOf(1) },
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
    ]);

    await store.deleteSubject(PRODUCT);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => row.id)).toEqual([
      displayStopIdOf(3),
      displayStopIdOf(4),
    ]);
  });

  test('投稿者の区間を利用者の主体として消す', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: USER,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
      {
        index: 2,
        subject: OTHER_USER,
        startedAt: at('2026-12-02T10:00:00.000Z'),
      },
    ]);

    await store.deleteSubject(USER);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => row.id)).toEqual([displayStopIdOf(2)]);
  });
});

describe('D1DisplayStopStore.deleteEndedBefore', () => {
  const CUTOFF = at('2025-10-26T08:00:00.000Z');

  async function insertAgedStops(): Promise<void> {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: at('2025-01-01T10:00:00.000Z'),
        endedAt: at('2025-01-03T10:00:00.000Z'),
      },
      {
        index: 2,
        subject: USER,
        startedAt: at('2025-02-01T10:00:00.000Z'),
        endedAt: at('2025-02-03T10:00:00.000Z'),
      },
      {
        index: 3,
        subject: OTHER_PRODUCT,
        startedAt: at('2024-12-01T10:00:00.000Z'),
        endedAt: at('2025-03-03T10:00:00.000Z'),
      },
      {
        index: 4,
        subject: OTHER_USER,
        startedAt: at('2025-10-01T10:00:00.000Z'),
        endedAt: CUTOFF,
      },
      {
        index: 5,
        subject: { kind: 'product', productId: productIdOf(3) },
        startedAt: at('2024-06-01T10:00:00.000Z'),
      },
      {
        index: 6,
        subject: { kind: 'user', userId: userIdOf(3) },
        startedAt: at('2025-10-20T10:00:00.000Z'),
        endedAt: at('2025-11-01T10:00:00.000Z'),
      },
    ]);
  }

  test('終わりが基準より前の区間を消して件数を返し、基準ちょうどに終わった区間・継続中の区間・後に終わった区間を残す', async () => {
    await insertAgedStops();

    expect(await store.deleteEndedBefore(CUTOFF, 100)).toBe(3);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => row.id)).toEqual([
      displayStopIdOf(4),
      displayStopIdOf(5),
      displayStopIdOf(6),
    ]);
  });

  test('件数の上限までを終わりの古い順に消し、次の呼び出しで残りを消す', async () => {
    await insertAgedStops();

    expect(await store.deleteEndedBefore(CUTOFF, 2)).toBe(2);
    expect((await readDisplayStopRows()).map((row) => row.id)).toEqual([
      displayStopIdOf(3),
      displayStopIdOf(4),
      displayStopIdOf(5),
      displayStopIdOf(6),
    ]);

    expect(await store.deleteEndedBefore(CUTOFF, 2)).toBe(1);
    expect(await store.deleteEndedBefore(CUTOFF, 2)).toBe(0);
    expect((await readDisplayStopRows()).map((row) => row.id)).toEqual([
      displayStopIdOf(4),
      displayStopIdOf(5),
      displayStopIdOf(6),
    ]);
  });
});
