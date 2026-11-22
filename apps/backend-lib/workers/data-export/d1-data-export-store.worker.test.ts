import { beforeEach, describe, expect, test } from 'vitest';

import {
  DATA_EXPORT_FAILURE_KINDS,
  DATA_EXPORT_STATUSES,
} from '../../../common-lib/data-export/data-export-rules.ts';
import type { DataExportStore } from '../../core/data-export/ports.ts';
import { D1DataExportStore } from './d1-data-export-store.ts';
import {
  clearDataExportState,
  daysAfter,
  exportIdOf,
  expiredColumnsOf,
  failedColumnsOf,
  insertUsers,
  minutesAfter,
  queuedRowOf,
  readExportIds,
  readTableSql,
  readyColumnsOf,
  seed,
  T0,
  userIdOf,
  db,
} from './testing/data-export-fixtures.ts';

const store: Pick<
  DataExportStore,
  | 'create'
  | 'remove'
  | 'find'
  | 'findOwnedReady'
  | 'listByUserPage'
  | 'listForUser'
  | 'removeMany'
> = new D1DataExportStore(db);

beforeEach(async () => {
  await clearDataExportState();
  await insertUsers([1, 2]);
});

describe('create', () => {
  test('作成中の記録を作り、他の列は空・試行は0・通知は無しで返し、同じ値を保存する', async () => {
    const requestedAt = minutesAfter(5);

    const created = await store.create({
      id: exportIdOf(1),
      userId: userIdOf(1),
      requestedAt,
    });

    const expected = {
      id: exportIdOf(1),
      userId: userIdOf(1),
      status: 'queued',
      requestedAt,
      runToken: null,
      leaseExpiresAt: null,
      attempts: 0,
      uploadId: null,
      objectKey: null,
      fileName: null,
      byteSize: null,
      completedAt: null,
      expiresAt: null,
      failedAt: null,
      failureKind: null,
      noticeStatus: 'none',
      updatedAt: requestedAt,
    };
    expect(created).toEqual(expected);
    expect(await store.find(exportIdOf(1))).toEqual(expected);
  });

  test('同じIDで作り直すと既存の記録を変えずに失敗する', async () => {
    await store.create({
      id: exportIdOf(1),
      userId: userIdOf(1),
      requestedAt: T0,
    });

    await expect(
      store.create({
        id: exportIdOf(1),
        userId: userIdOf(2),
        requestedAt: minutesAfter(1),
      }),
    ).rejects.toThrow();

    expect((await store.find(exportIdOf(1)))?.userId).toBe(userIdOf(1));
  });
});

describe('remove', () => {
  test('指定した1件だけを消し、他の記録を残す', async () => {
    await seed([queuedRowOf(1, 1), queuedRowOf(2, 1)]);

    await store.remove(exportIdOf(1));

    expect(await readExportIds()).toEqual([exportIdOf(2)]);
  });

  test('存在しないIDの削除は何も変えず成功する', async () => {
    await seed([queuedRowOf(1, 1)]);

    await store.remove(exportIdOf(9));

    expect(await readExportIds()).toEqual([exportIdOf(1)]);
  });
});

describe('find', () => {
  test('状態を問わずIDの記録を返し、完了の列も写す', async () => {
    const expiresAt = daysAfter(7);
    await seed([queuedRowOf(1, 1, readyColumnsOf(expiresAt))]);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      id: exportIdOf(1),
      status: 'ready',
      objectKey: 'data-exports/ready.zip',
      fileName: 'launch-stadium-export.zip',
      byteSize: 1024,
      completedAt: T0,
      expiresAt,
      noticeStatus: 'pending',
    });
  });

  test('失敗の記録の日時と種類を写す', async () => {
    await seed([queuedRowOf(1, 1, failedColumnsOf())]);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'failed',
      failedAt: T0,
      failureKind: 'error',
    });
  });

  test('存在しないIDはundefinedを返す', async () => {
    expect(await store.find(exportIdOf(9))).toBeUndefined();
  });
});

describe('findOwnedReady', () => {
  const now = daysAfter(1);

  test('本人の期限内の完了の記録を返す', async () => {
    await seed([queuedRowOf(1, 1, readyColumnsOf(daysAfter(7)))]);

    const found = await store.findOwnedReady({
      id: exportIdOf(1),
      userId: userIdOf(1),
      now,
    });

    expect(found).toMatchObject({ id: exportIdOf(1), status: 'ready' });
  });

  test('他人の記録は返さない', async () => {
    await seed([queuedRowOf(1, 1, readyColumnsOf(daysAfter(7)))]);

    expect(
      await store.findOwnedReady({
        id: exportIdOf(1),
        userId: userIdOf(2),
        now,
      }),
    ).toBeUndefined();
  });

  test('期限と現在時刻が同じ記録は返さず、1ミリ秒前の期限の記録も返さない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(now)),
      queuedRowOf(2, 1, readyColumnsOf(new Date(now.getTime() - 1))),
      queuedRowOf(3, 1, readyColumnsOf(new Date(now.getTime() + 1))),
    ]);

    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        store.findOwnedReady({
          id: exportIdOf(index),
          userId: userIdOf(1),
          now,
        }),
      ),
    );

    expect(results.map((result) => result?.id)).toEqual([
      undefined,
      undefined,
      exportIdOf(3),
    ]);
  });

  test('作成中・生成中・失敗・期限切れの記録は返さない', async () => {
    await seed([
      queuedRowOf(1, 1),
      queuedRowOf(2, 1, {
        status: 'generating',
        runToken: 'run-token',
        leaseExpiresAt: daysAfter(1),
        attempts: 1,
      }),
      queuedRowOf(3, 1, failedColumnsOf()),
      queuedRowOf(4, 1, expiredColumnsOf()),
    ]);

    const results = await Promise.all(
      [1, 2, 3, 4].map((index) =>
        store.findOwnedReady({
          id: exportIdOf(index),
          userId: userIdOf(1),
          now: T0,
        }),
      ),
    );

    expect(results).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('存在しないIDはundefinedを返す', async () => {
    expect(
      await store.findOwnedReady({
        id: exportIdOf(9),
        userId: userIdOf(1),
        now,
      }),
    ).toBeUndefined();
  });
});

describe('listByUserPage', () => {
  beforeEach(async () => {
    await seed([
      queuedRowOf(1, 1, expiredColumnsOf()),
      queuedRowOf(2, 1, failedColumnsOf()),
      queuedRowOf(3, 2),
      queuedRowOf(4, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(5, 1),
      queuedRowOf(6, 2),
    ]);
  });

  test('本人の記録だけを要求の新しい順に、状態を問わず返す', async () => {
    const page = await store.listByUserPage({
      userId: userIdOf(1),
      afterId: undefined,
      limit: 20,
    });

    expect(page.map((row) => row.id)).toEqual([
      exportIdOf(5),
      exportIdOf(4),
      exportIdOf(2),
      exportIdOf(1),
    ]);
    expect(page.map((row) => row.status)).toEqual([
      'queued',
      'ready',
      'failed',
      'expired',
    ]);
  });

  test('limitを超えるときは続きの有無を判定できるようlimit + 1件を返す', async () => {
    const page = await store.listByUserPage({
      userId: userIdOf(1),
      afterId: undefined,
      limit: 2,
    });

    expect(page.map((row) => row.id)).toEqual([
      exportIdOf(5),
      exportIdOf(4),
      exportIdOf(2),
    ]);
  });

  test('afterIdより前の記録だけを返す', async () => {
    const page = await store.listByUserPage({
      userId: userIdOf(1),
      afterId: exportIdOf(4),
      limit: 20,
    });

    expect(page.map((row) => row.id)).toEqual([exportIdOf(2), exportIdOf(1)]);
  });

  test('afterIdが本人の最も古い記録なら空を返し、他人のIDでも本人の記録を区切る', async () => {
    const afterOldest = await store.listByUserPage({
      userId: userIdOf(1),
      afterId: exportIdOf(1),
      limit: 20,
    });
    const afterOthers = await store.listByUserPage({
      userId: userIdOf(1),
      afterId: exportIdOf(3),
      limit: 20,
    });

    expect(afterOldest).toEqual([]);
    expect(afterOthers.map((row) => row.id)).toEqual([
      exportIdOf(2),
      exportIdOf(1),
    ]);
  });

  test('記録の無い利用者には空を返す', async () => {
    await clearDataExportState();
    await insertUsers([1]);

    expect(
      await store.listByUserPage({
        userId: userIdOf(1),
        afterId: undefined,
        limit: 20,
      }),
    ).toEqual([]);
  });
});

describe('listForUser', () => {
  beforeEach(async () => {
    await seed([
      queuedRowOf(1, 1),
      queuedRowOf(2, 2),
      queuedRowOf(3, 1, failedColumnsOf()),
      queuedRowOf(4, 1, readyColumnsOf(daysAfter(7))),
    ]);
  });

  test('本人の記録だけを状態を問わず返し、他人の記録を含めない', async () => {
    const rows = await store.listForUser({ userId: userIdOf(1), limit: 100 });

    expect(rows.map((row) => row.id).toSorted()).toEqual([
      exportIdOf(1),
      exportIdOf(3),
      exportIdOf(4),
    ]);
  });

  test('limitを超える記録を返さず、返した記録を消すと残りを続けて読める', async () => {
    const first = await store.listForUser({ userId: userIdOf(1), limit: 2 });
    expect(first).toHaveLength(2);

    await store.removeMany(first.map((row) => row.id));
    const second = await store.listForUser({ userId: userIdOf(1), limit: 2 });

    expect(second).toHaveLength(1);
    expect([...first, ...second].map((row) => row.id).toSorted()).toEqual([
      exportIdOf(1),
      exportIdOf(3),
      exportIdOf(4),
    ]);
  });

  test('記録の無い利用者には空を返す', async () => {
    await clearDataExportState();
    await insertUsers([1]);

    expect(
      await store.listForUser({ userId: userIdOf(1), limit: 100 }),
    ).toEqual([]);
  });
});

describe('removeMany', () => {
  const COUNT = 250;

  test('バインド変数の上限を超える件数でも全件を消し、指定しない記録を残す', async () => {
    const targets = Array.from({ length: COUNT }, (_, index) => index + 1);
    await seed([
      ...targets.map((index) => queuedRowOf(index, 1)),
      queuedRowOf(COUNT + 1, 2),
    ]);

    await store.removeMany(targets.map((index) => exportIdOf(index)));

    expect(await readExportIds()).toEqual([exportIdOf(COUNT + 1)]);
  });

  test('90件ちょうどと91件のどちらも消す', async () => {
    await seed(
      Array.from({ length: 91 }, (_, index) => queuedRowOf(index + 1, 1)),
    );

    await store.removeMany(
      Array.from({ length: 90 }, (_, index) => exportIdOf(index + 1)),
    );
    expect(await readExportIds()).toEqual([exportIdOf(91)]);

    await store.removeMany([exportIdOf(91)]);
    expect(await readExportIds()).toEqual([]);
  });

  test('空の配列と存在しないIDだけの指定は何も変えず成功する', async () => {
    await seed([queuedRowOf(1, 1)]);

    await store.removeMany([]);
    await store.removeMany([exportIdOf(9)]);

    expect(await readExportIds()).toEqual([exportIdOf(1)]);
  });
});

describe('テーブルのCHECK', () => {
  function checkValuesOf(sql: string, constraint: string): string[] {
    const pattern = new RegExp(
      `CONSTRAINT "${constraint}" CHECK\\("[a-z_]+" in \\(([^)]*)\\)\\)`,
    );
    const list = pattern.exec(sql)?.[1];
    if (list === undefined) {
      throw new Error(`${constraint}がテーブルの定義に無い`);
    }
    return [...list.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
  }

  test('状態の値が1.1の定数と一致する', async () => {
    const values = checkValuesOf(
      await readTableSql(),
      'data_exports_status_check',
    );

    expect(values.toSorted()).toEqual([...DATA_EXPORT_STATUSES].toSorted());
  });

  test('失敗の種類の値が1.1の定数と一致する', async () => {
    const values = checkValuesOf(
      await readTableSql(),
      'data_exports_failure_kind_check',
    );

    expect(values.toSorted()).toEqual(
      [...DATA_EXPORT_FAILURE_KINDS].toSorted(),
    );
  });

  test('定数の全ての状態を保存でき、定数に無い状態は保存できない', async () => {
    const expiresAt = daysAfter(7);
    const columnsOf = {
      queued: {},
      generating: {},
      ready: readyColumnsOf(expiresAt),
      expired: expiredColumnsOf(),
      failed: failedColumnsOf(),
    } as const;

    for (const [offset, status] of DATA_EXPORT_STATUSES.entries()) {
      await seed([
        queuedRowOf(offset + 1, 1, { ...columnsOf[status], status }),
      ]);
    }
    expect(await readExportIds()).toHaveLength(DATA_EXPORT_STATUSES.length);

    await expect(
      seed([queuedRowOf(90, 1, { status: 'unknown' as 'queued' })]),
    ).rejects.toThrow();
  });
});
