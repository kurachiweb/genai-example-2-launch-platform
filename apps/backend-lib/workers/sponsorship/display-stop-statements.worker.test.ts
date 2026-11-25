import { sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { DisplayStopSubject } from '../../core/sponsorship/ports.ts';
import { D1DisplayStopStatements } from './display-stop-statements.ts';
import {
  clearSponsorshipTables,
  db,
  displayStopIdOf,
  insertDisplayStops,
  productIdOf,
  readDisplayStopRows,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const PRODUCT: DisplayStopSubject = {
  kind: 'product',
  productId: productIdOf(1),
};

const OTHER_PRODUCT: DisplayStopSubject = {
  kind: 'product',
  productId: productIdOf(2),
};

const USER: DisplayStopSubject = { kind: 'user', userId: userIdOf(1) };

const STARTED_AT = new Date('2026-12-02T10:00:00.000Z');

const ENDED_AT = new Date('2026-12-04T12:30:00.000Z');

const EARLIER = new Date('2026-11-20T09:00:00.000Z');

const EARLIER_END = new Date('2026-11-21T09:00:00.000Z');

function sequentialIds(start = 100): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = displayStopIdOf(next);
      next += 1;
      return id;
    },
  };
}

function statements(): D1DisplayStopStatements {
  return new D1DisplayStopStatements(sequentialIds());
}

async function commit(items: readonly BatchItem<'sqlite'>[]): Promise<void> {
  const [first, ...rest] = items;
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest]);
}

function failingStatement(): BatchItem<'sqlite'> {
  return db.run(
    sql`INSERT INTO sponsorship_display_stops (id) VALUES ('broken')`,
  );
}

beforeEach(async () => {
  await clearSponsorshipTables();
});

describe('D1DisplayStopStatements.startStatement', () => {
  test('同じ主体の継続中の区間が無ければ、確定の時刻で始まる継続中の区間を作る', async () => {
    await commit([statements().startStatement(PRODUCT, STARTED_AT, db)]);

    expect(await readDisplayStopRows()).toEqual([
      {
        id: displayStopIdOf(100),
        subjectKind: 'product',
        subjectId: productIdOf(1),
        startedAt: STARTED_AT,
        endedAt: null,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      },
    ]);
  });

  test('投稿者の停止を利用者の主体として記録する', async () => {
    await commit([statements().startStatement(USER, STARTED_AT, db)]);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => [row.subjectKind, row.subjectId])).toEqual([
      ['user', userIdOf(1)],
    ]);
  });

  test('同じ主体の継続中の区間があれば、区間を重ねて作らない', async () => {
    await insertDisplayStops([
      { index: 1, subject: PRODUCT, startedAt: EARLIER },
    ]);
    const before = await readDisplayStopRows();

    await commit([statements().startStatement(PRODUCT, STARTED_AT, db)]);

    expect(await readDisplayStopRows()).toEqual(before);
  });

  test('同じ一括の書き込みで2回始めても、継続中の区間は1つだけになる', async () => {
    const recorder = statements();

    await commit([
      recorder.startStatement(PRODUCT, STARTED_AT, db),
      recorder.startStatement(PRODUCT, ENDED_AT, db),
    ]);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => [row.startedAt, row.endedAt])).toEqual([
      [STARTED_AT, null],
    ]);
  });

  test('同じ主体の区間が終わっていれば、新しい区間を作る', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: EARLIER,
        endedAt: EARLIER_END,
      },
    ]);

    await commit([statements().startStatement(PRODUCT, STARTED_AT, db)]);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => [row.startedAt, row.endedAt])).toEqual([
      [EARLIER, EARLIER_END],
      [STARTED_AT, null],
    ]);
  });

  test('他の主体の継続中の区間は、区間の始まりを妨げない', async () => {
    await insertDisplayStops([
      { index: 1, subject: OTHER_PRODUCT, startedAt: EARLIER },
      {
        index: 2,
        subject: { kind: 'user', userId: productIdOf(1) },
        startedAt: EARLIER,
      },
    ]);

    await commit([statements().startStatement(PRODUCT, STARTED_AT, db)]);

    const rows = await readDisplayStopRows();
    expect(
      rows
        .filter((row) => row.startedAt.getTime() === STARTED_AT.getTime())
        .map((row) => [row.subjectKind, row.subjectId]),
    ).toEqual([['product', productIdOf(1)]]);
  });

  test('一括の書き込みが取り消されれば、区間を記録しない', async () => {
    await expect(
      commit([
        statements().startStatement(PRODUCT, STARTED_AT, db),
        failingStatement(),
      ]),
    ).rejects.toThrow();

    expect(await readDisplayStopRows()).toEqual([]);
  });
});

describe('D1DisplayStopStatements.endStatement', () => {
  test('同じ主体の継続中の区間の終わりと更新日時を確定の時刻にする', async () => {
    await insertDisplayStops([
      { index: 1, subject: PRODUCT, startedAt: STARTED_AT },
    ]);

    await commit([statements().endStatement(PRODUCT, ENDED_AT, db)]);

    expect(await readDisplayStopRows()).toEqual([
      {
        id: displayStopIdOf(1),
        subjectKind: 'product',
        subjectId: productIdOf(1),
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
        createdAt: STARTED_AT,
        updatedAt: ENDED_AT,
      },
    ]);
  });

  test('終わった区間と他の主体の区間は変えない', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: USER,
        startedAt: EARLIER,
        endedAt: EARLIER_END,
      },
      { index: 2, subject: USER, startedAt: STARTED_AT },
      { index: 3, subject: OTHER_PRODUCT, startedAt: STARTED_AT },
      {
        index: 4,
        subject: { kind: 'product', productId: userIdOf(1) },
        startedAt: STARTED_AT,
      },
    ]);

    await commit([statements().endStatement(USER, ENDED_AT, db)]);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => [row.id, row.endedAt])).toEqual([
      [displayStopIdOf(1), EARLIER_END],
      [displayStopIdOf(2), ENDED_AT],
      [displayStopIdOf(3), null],
      [displayStopIdOf(4), null],
    ]);
  });

  test('継続中の区間が無ければ何も変えず、一括の書き込みは成功する', async () => {
    await insertDisplayStops([
      {
        index: 1,
        subject: PRODUCT,
        startedAt: EARLIER,
        endedAt: EARLIER_END,
      },
    ]);
    const before = await readDisplayStopRows();

    await commit([statements().endStatement(PRODUCT, ENDED_AT, db)]);

    expect(await readDisplayStopRows()).toEqual(before);
  });

  test('始まりと終わりを順に確定すると、終わった区間が1つ残り、次の始まりで新しい区間を作る', async () => {
    const recorder = statements();
    const restartedAt = new Date('2026-12-05T01:00:00.000Z');

    await commit([recorder.startStatement(USER, STARTED_AT, db)]);
    await commit([recorder.endStatement(USER, ENDED_AT, db)]);
    await commit([recorder.startStatement(USER, restartedAt, db)]);

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => [row.startedAt, row.endedAt])).toEqual([
      [STARTED_AT, ENDED_AT],
      [restartedAt, null],
    ]);
  });

  test('一括の書き込みが取り消されれば、区間を終えない', async () => {
    await insertDisplayStops([
      { index: 1, subject: PRODUCT, startedAt: STARTED_AT },
    ]);

    await expect(
      commit([
        statements().endStatement(PRODUCT, ENDED_AT, db),
        failingStatement(),
      ]),
    ).rejects.toThrow();

    const rows = await readDisplayStopRows();
    expect(rows.map((row) => row.endedAt)).toEqual([null]);
  });
});
