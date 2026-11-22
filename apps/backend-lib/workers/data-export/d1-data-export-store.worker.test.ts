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
  type ExportRow,
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

const store: DataExportStore = new D1DataExportStore(db);

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

function generatingColumnsOf(
  overrides: Partial<ExportRow> = {},
): Partial<ExportRow> {
  return {
    status: 'generating',
    runToken: 'run-token-a',
    leaseExpiresAt: minutesAfter(30),
    attempts: 1,
    ...overrides,
  };
}

describe('claim', () => {
  const now = minutesAfter(10);
  const leaseUntil = minutesAfter(30);

  function claimWith(runToken: string, id = exportIdOf(1)) {
    return store.claim({ id, runToken, now, leaseUntil });
  }

  test('作成中の記録を生成中にし、実行の印・リース・試行の回数を同じ更新で書く', async () => {
    await seed([queuedRowOf(1, 1)]);

    const result = await claimWith('run-token-a');

    const expected = {
      status: 'generating',
      runToken: 'run-token-a',
      leaseExpiresAt: leaseUntil,
      attempts: 1,
      updatedAt: now,
    };
    expect(result).toMatchObject({ kind: 'claimed', record: expected });
    expect(await store.find(exportIdOf(1))).toMatchObject(expected);
  });

  test('2つの実行が同時に取ろうとしても1つだけが取れ、もう1つは使用中を返す', async () => {
    await seed([queuedRowOf(1, 1)]);

    const results = await Promise.all([
      claimWith('run-token-a'),
      claimWith('run-token-b'),
    ]);

    expect(results.map((result) => result.kind).toSorted()).toEqual([
      'busy',
      'claimed',
    ]);
    const winner = results.find((result) => result.kind === 'claimed');
    const stored = await store.find(exportIdOf(1));
    expect(stored?.runToken).toBe(
      winner?.kind === 'claimed' ? winner.record.runToken : undefined,
    );
    expect(stored?.attempts).toBe(1);
  });

  test('リースが有効な生成中の記録は使用中を返し、何も変えない', async () => {
    await seed([
      queuedRowOf(
        1,
        1,
        generatingColumnsOf({ leaseExpiresAt: minutesAfter(11) }),
      ),
    ]);

    const result = await claimWith('run-token-b');

    expect(result).toEqual({ kind: 'busy' });
    expect(await store.find(exportIdOf(1))).toMatchObject({
      runToken: 'run-token-a',
      leaseExpiresAt: minutesAfter(11),
      attempts: 1,
    });
  });

  test('リースの期限が現在時刻と同じか過ぎていれば取り直し、試行の回数を増やす', async () => {
    await seed([
      queuedRowOf(1, 1, generatingColumnsOf({ leaseExpiresAt: now })),
      queuedRowOf(
        2,
        1,
        generatingColumnsOf({
          leaseExpiresAt: new Date(now.getTime() - 1),
          attempts: 2,
        }),
      ),
    ]);

    const first = await claimWith('run-token-b', exportIdOf(1));
    const second = await claimWith('run-token-b', exportIdOf(2));

    expect(first).toMatchObject({
      kind: 'claimed',
      record: {
        runToken: 'run-token-b',
        attempts: 2,
        leaseExpiresAt: leaseUntil,
      },
    });
    expect(second).toMatchObject({
      kind: 'claimed',
      record: { runToken: 'run-token-b', attempts: 3 },
    });
  });

  test('リースを外した生成中の記録は取れ、前の実行のアップロードのIDを残して返す', async () => {
    await seed([
      queuedRowOf(
        1,
        1,
        generatingColumnsOf({
          runToken: null,
          leaseExpiresAt: null,
          uploadId: 'upload-previous',
          objectKey: 'data-exports/previous.zip',
        }),
      ),
    ]);

    const result = await claimWith('run-token-b');

    expect(result).toMatchObject({
      kind: 'claimed',
      record: {
        runToken: 'run-token-b',
        uploadId: 'upload-previous',
        attempts: 2,
      },
    });
  });

  test('完了・期限切れ・失敗の記録は終了を返し、何も変えない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(2, 1, expiredColumnsOf()),
      queuedRowOf(3, 1, failedColumnsOf()),
    ]);
    const before = await Promise.all(
      [1, 2, 3].map((index) => store.find(exportIdOf(index))),
    );

    const results = await Promise.all(
      [1, 2, 3].map((index) => claimWith('run-token-b', exportIdOf(index))),
    );

    expect(results).toEqual([
      { kind: 'finished' },
      { kind: 'finished' },
      { kind: 'finished' },
    ]);
    expect(
      await Promise.all(
        [1, 2, 3].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(before);
  });

  test('存在しない記録は無いことを返す', async () => {
    expect(await claimWith('run-token-a', exportIdOf(9))).toEqual({
      kind: 'not_found',
    });
  });
});

describe('recordUpload', () => {
  test('実行の印が一致する生成中の記録へアップロードのIDと置き場所を書き、trueを返す', async () => {
    await seed([queuedRowOf(1, 1, generatingColumnsOf())]);

    const recorded = await store.recordUpload({
      id: exportIdOf(1),
      runToken: 'run-token-a',
      uploadId: 'upload-1',
      objectKey: 'data-exports/1.zip',
    });

    expect(recorded).toBe(true);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'generating',
      uploadId: 'upload-1',
      objectKey: 'data-exports/1.zip',
      runToken: 'run-token-a',
    });
  });

  test('実行の印が一致しない・生成中でない・存在しない記録にはfalseを返し、何も変えない', async () => {
    await seed([
      queuedRowOf(1, 1, generatingColumnsOf({ runToken: 'run-token-b' })),
      queuedRowOf(2, 1),
      queuedRowOf(3, 1, failedColumnsOf()),
    ]);
    const before = await Promise.all(
      [1, 2, 3].map((index) => store.find(exportIdOf(index))),
    );

    const results = await Promise.all(
      [1, 2, 3, 9].map((index) =>
        store.recordUpload({
          id: exportIdOf(index),
          runToken: 'run-token-a',
          uploadId: 'upload-1',
          objectKey: 'data-exports/1.zip',
        }),
      ),
    );

    expect(results).toEqual([false, false, false, false]);
    expect(
      await Promise.all(
        [1, 2, 3].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(before);
  });
});

describe('releaseLease', () => {
  test('実行の印が一致する生成中の記録から実行の印・リース・アップロードのIDを外し、状態と試行の回数を残す', async () => {
    await seed([
      queuedRowOf(
        1,
        1,
        generatingColumnsOf({ attempts: 2, uploadId: 'upload-1' }),
      ),
    ]);

    await store.releaseLease({ id: exportIdOf(1), runToken: 'run-token-a' });

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'generating',
      runToken: null,
      leaseExpiresAt: null,
      uploadId: null,
      attempts: 2,
    });
  });

  test('実行の印が一致しない記録や生成中でない記録は変えない', async () => {
    await seed([
      queuedRowOf(
        1,
        1,
        generatingColumnsOf({ runToken: 'run-token-b', uploadId: 'upload-1' }),
      ),
      queuedRowOf(2, 1, {
        ...failedColumnsOf(),
        runToken: 'run-token-a',
        uploadId: 'upload-2',
      }),
    ]);
    const before = await Promise.all(
      [1, 2].map((index) => store.find(exportIdOf(index))),
    );

    await store.releaseLease({ id: exportIdOf(1), runToken: 'run-token-a' });
    await store.releaseLease({ id: exportIdOf(2), runToken: 'run-token-a' });
    await store.releaseLease({ id: exportIdOf(9), runToken: 'run-token-a' });

    expect(
      await Promise.all([1, 2].map((index) => store.find(exportIdOf(index)))),
    ).toEqual(before);
  });
});

describe('markReady', () => {
  const completedAt = minutesAfter(20);
  const expiresAt = daysAfter(7, completedAt);

  function markReadyWith(runToken: string, id = exportIdOf(1)) {
    return store.markReady({
      id,
      runToken,
      fileName: 'launch-stadium-export.zip',
      byteSize: 2048,
      completedAt,
      expiresAt,
    });
  }

  const uploading = generatingColumnsOf({
    uploadId: 'upload-1',
    objectKey: 'data-exports/1.zip',
  });

  test('実行の印が一致する生成中の記録を完了にし、通知を依頼待ちにして実行の印とアップロードのIDを外す', async () => {
    await seed([queuedRowOf(1, 1, uploading)]);

    expect(await markReadyWith('run-token-a')).toBe(true);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'ready',
      objectKey: 'data-exports/1.zip',
      fileName: 'launch-stadium-export.zip',
      byteSize: 2048,
      completedAt,
      expiresAt,
      noticeStatus: 'pending',
      runToken: null,
      leaseExpiresAt: null,
      uploadId: null,
      updatedAt: completedAt,
    });
  });

  test('実行の印が一致しない記録にはfalseを返し、何も変えない', async () => {
    await seed([queuedRowOf(1, 1, uploading)]);

    expect(await markReadyWith('run-token-b')).toBe(false);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'generating',
      uploadId: 'upload-1',
      noticeStatus: 'none',
    });
  });

  test('先に失敗が確定した記録は完了にせず、失敗の記録を変えない', async () => {
    await seed([
      queuedRowOf(1, 1, {
        ...failedColumnsOf(),
        runToken: 'run-token-a',
        objectKey: 'data-exports/1.zip',
      }),
    ]);

    expect(await markReadyWith('run-token-a')).toBe(false);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'failed',
      completedAt: null,
    });
  });

  test('同じ実行の印で2回呼んでも完了は1回だけで、存在しない記録にはfalseを返す', async () => {
    await seed([queuedRowOf(1, 1, uploading)]);

    expect(await markReadyWith('run-token-a')).toBe(true);
    expect(await markReadyWith('run-token-a')).toBe(false);
    expect(await markReadyWith('run-token-a', exportIdOf(9))).toBe(false);
  });

  test('完了と失敗の確定が競合しても片方だけが成り立つ', async () => {
    await seed([queuedRowOf(1, 1, uploading)]);

    const [ready, failed] = await Promise.all([
      markReadyWith('run-token-a'),
      store.markFailed({
        id: exportIdOf(1),
        kind: 'error',
        failedAt: completedAt,
        notice: 'pending',
      }),
    ]);

    const stored = await store.find(exportIdOf(1));
    expect(ready === (failed === undefined)).toBe(true);
    expect(stored?.status).toBe(ready ? 'ready' : 'failed');
  });
});

describe('markFailed', () => {
  const failedAt = minutesAfter(40);

  test('作成中の記録を失敗にし、種類・日時・通知の状態を同じ更新で書いて更新後の記録を返す', async () => {
    await seed([queuedRowOf(1, 1)]);

    const result = await store.markFailed({
      id: exportIdOf(1),
      kind: 'too_large',
      failedAt,
      notice: 'pending',
    });

    const expected = {
      id: exportIdOf(1),
      status: 'failed',
      failureKind: 'too_large',
      failedAt,
      noticeStatus: 'pending',
      updatedAt: failedAt,
    };
    expect(result).toMatchObject(expected);
    expect(await store.find(exportIdOf(1))).toMatchObject(expected);
  });

  test('生成中の記録も失敗にし、残ったアップロードのIDを後の破棄のために残す', async () => {
    await seed([
      queuedRowOf(1, 1, generatingColumnsOf({ uploadId: 'upload-1' })),
    ]);

    const result = await store.markFailed({
      id: exportIdOf(1),
      kind: 'error',
      failedAt,
      notice: 'skipped',
    });

    expect(result).toMatchObject({
      status: 'failed',
      failureKind: 'error',
      noticeStatus: 'skipped',
      uploadId: 'upload-1',
    });
  });

  test('完了・期限切れ・失敗・存在しない記録にはundefinedを返し、何も変えない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(2, 1, expiredColumnsOf()),
      queuedRowOf(3, 1, failedColumnsOf()),
    ]);
    const before = await Promise.all(
      [1, 2, 3].map((index) => store.find(exportIdOf(index))),
    );

    const results = await Promise.all(
      [1, 2, 3, 9].map((index) =>
        store.markFailed({
          id: exportIdOf(index),
          kind: 'too_large',
          failedAt,
          notice: 'pending',
        }),
      ),
    );

    expect(results).toEqual([undefined, undefined, undefined, undefined]);
    expect(
      await Promise.all(
        [1, 2, 3].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(before);
  });

  test('同時に2回確定しても1回だけが成り立ち、先の種類を後の確定が上書きしない', async () => {
    await seed([queuedRowOf(1, 1)]);

    const results = await Promise.all([
      store.markFailed({
        id: exportIdOf(1),
        kind: 'error',
        failedAt,
        notice: 'pending',
      }),
      store.markFailed({
        id: exportIdOf(1),
        kind: 'too_large',
        failedAt: minutesAfter(41),
        notice: 'skipped',
      }),
    ]);

    const winners = results.filter((result) => result !== undefined);
    expect(winners).toHaveLength(1);
    const stored = await store.find(exportIdOf(1));
    expect(stored).toMatchObject({
      failureKind: winners[0]?.failureKind,
      noticeStatus: winners[0]?.noticeStatus,
    });
  });
});

describe('advanceNotice', () => {
  test('依頼待ちの通知を依頼済みまたは見送りへ進め、trueを返す', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(2, 1, { ...failedColumnsOf(), noticeStatus: 'pending' }),
    ]);

    const requested = await store.advanceNotice({
      id: exportIdOf(1),
      to: 'requested',
    });
    const skipped = await store.advanceNotice({
      id: exportIdOf(2),
      to: 'skipped',
    });

    expect(requested).toBe(true);
    expect(skipped).toBe(true);
    expect((await store.find(exportIdOf(1)))?.noticeStatus).toBe('requested');
    expect((await store.find(exportIdOf(2)))?.noticeStatus).toBe('skipped');
  });

  test('依頼待ちでない通知と存在しない記録にはfalseを返し、何も変えない', async () => {
    await seed([
      queuedRowOf(1, 1),
      queuedRowOf(2, 1, failedColumnsOf()),
      queuedRowOf(3, 1, { ...failedColumnsOf(), noticeStatus: 'skipped' }),
    ]);

    const results = await Promise.all(
      [1, 2, 3, 9].map((index) =>
        store.advanceNotice({ id: exportIdOf(index), to: 'requested' }),
      ),
    );

    expect(results).toEqual([false, false, false, false]);
    expect(
      (
        await Promise.all(
          [1, 2, 3].map((index) => store.find(exportIdOf(index))),
        )
      ).map((record) => record?.noticeStatus),
    ).toEqual(['none', 'requested', 'skipped']);
  });

  test('同時に2回進めても1回だけが成り立つ', async () => {
    await seed([queuedRowOf(1, 1, readyColumnsOf(daysAfter(7)))]);

    const results = await Promise.all([
      store.advanceNotice({ id: exportIdOf(1), to: 'requested' }),
      store.advanceNotice({ id: exportIdOf(1), to: 'skipped' }),
    ]);

    expect(results.toSorted()).toEqual([false, true]);
  });
});

describe('listStalled', () => {
  const requestedBefore = minutesAfter(5);

  test('要求の日時が基準より前の作成中と生成中だけを古い順に返し、基準と同じ日時は返さない', async () => {
    await seed([
      queuedRowOf(4, 1, generatingColumnsOf()),
      queuedRowOf(1, 1),
      queuedRowOf(5, 1),
      queuedRowOf(6, 1),
      queuedRowOf(2, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(3, 1, failedColumnsOf()),
      queuedRowOf(0, 1, expiredColumnsOf()),
    ]);

    const rows = await store.listStalled({ requestedBefore, limit: 100 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(4)]);
  });

  test('limitを超える件数を返さず、古いものから返す', async () => {
    await seed([queuedRowOf(1, 1), queuedRowOf(2, 1), queuedRowOf(3, 1)]);

    const rows = await store.listStalled({ requestedBefore, limit: 2 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(2)]);
  });

  test('該当する記録が無ければ空を返す', async () => {
    expect(await store.listStalled({ requestedBefore, limit: 100 })).toEqual(
      [],
    );
  });
});

describe('listPendingNotices', () => {
  const updatedBefore = minutesAfter(60);

  function pendingRowOf(
    index: number,
    updatedAt: Date,
    columns: Partial<ExportRow> = readyColumnsOf(daysAfter(7)),
  ): ExportRow {
    return queuedRowOf(index, 1, {
      ...columns,
      noticeStatus: 'pending',
      updatedAt,
    });
  }

  test('依頼待ちで更新日時が基準より前の記録だけを古い順に返し、基準と同じ日時は返さない', async () => {
    await seed([
      pendingRowOf(1, minutesAfter(30)),
      pendingRowOf(2, minutesAfter(10), failedColumnsOf()),
      pendingRowOf(3, updatedBefore),
      pendingRowOf(4, new Date(updatedBefore.getTime() + 1)),
      queuedRowOf(5, 1, {
        ...readyColumnsOf(daysAfter(7)),
        noticeStatus: 'requested',
        updatedAt: minutesAfter(1),
      }),
      queuedRowOf(6, 1, { updatedAt: minutesAfter(1) }),
      queuedRowOf(7, 1, {
        ...failedColumnsOf(),
        noticeStatus: 'skipped',
        updatedAt: minutesAfter(1),
      }),
    ]);

    const rows = await store.listPendingNotices({ updatedBefore, limit: 100 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(2), exportIdOf(1)]);
  });

  test('limitを超える件数を返さない', async () => {
    await seed([
      pendingRowOf(1, minutesAfter(10)),
      pendingRowOf(2, minutesAfter(20)),
      pendingRowOf(3, minutesAfter(30)),
    ]);

    const rows = await store.listPendingNotices({ updatedBefore, limit: 2 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(2)]);
  });
});

describe('listExpired', () => {
  const now = daysAfter(8);

  test('期限が現在時刻と同じか過ぎた完了だけを期限の古い順に返し、まだ先の期限の完了は返さない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(now)),
      queuedRowOf(2, 1, readyColumnsOf(new Date(now.getTime() - 1))),
      queuedRowOf(3, 1, readyColumnsOf(new Date(now.getTime() + 1))),
      queuedRowOf(4, 1, readyColumnsOf(daysAfter(1))),
      queuedRowOf(5, 1, { ...expiredColumnsOf(), expiresAt: daysAfter(1) }),
      queuedRowOf(6, 1, failedColumnsOf()),
      queuedRowOf(7, 1),
    ]);

    const rows = await store.listExpired({ now, limit: 100 });

    expect(rows.map((row) => row.id)).toEqual([
      exportIdOf(4),
      exportIdOf(2),
      exportIdOf(1),
    ]);
  });

  test('limitを超える件数を返さない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(daysAfter(1))),
      queuedRowOf(2, 1, readyColumnsOf(daysAfter(2))),
      queuedRowOf(3, 1, readyColumnsOf(daysAfter(3))),
    ]);

    const rows = await store.listExpired({ now, limit: 2 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(2)]);
  });
});

describe('markExpired', () => {
  test('完了を期限切れにして置き場所を外し、履歴の列と通知の状態を残してtrueを返す', async () => {
    const expiresAt = daysAfter(7);
    await seed([queuedRowOf(1, 1, readyColumnsOf(expiresAt))]);

    expect(await store.markExpired(exportIdOf(1))).toBe(true);

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'expired',
      objectKey: null,
      uploadId: null,
      fileName: 'launch-stadium-export.zip',
      byteSize: 1024,
      completedAt: T0,
      expiresAt,
      noticeStatus: 'pending',
    });
  });

  test('2回目と、完了でない記録と、存在しない記録にはfalseを返し、何も変えない', async () => {
    await seed([
      queuedRowOf(1, 1, readyColumnsOf(daysAfter(7))),
      queuedRowOf(2, 1),
      queuedRowOf(3, 1, failedColumnsOf()),
      queuedRowOf(4, 1, generatingColumnsOf()),
    ]);
    const before = await Promise.all(
      [2, 3, 4].map((index) => store.find(exportIdOf(index))),
    );

    expect(await store.markExpired(exportIdOf(1))).toBe(true);
    expect(await store.markExpired(exportIdOf(1))).toBe(false);
    expect(await store.markExpired(exportIdOf(2))).toBe(false);
    expect(await store.markExpired(exportIdOf(3))).toBe(false);
    expect(await store.markExpired(exportIdOf(4))).toBe(false);
    expect(await store.markExpired(exportIdOf(9))).toBe(false);

    expect(
      await Promise.all(
        [2, 3, 4].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(before);
  });

  test('同時に2回呼んでも1回だけが成り立つ', async () => {
    await seed([queuedRowOf(1, 1, readyColumnsOf(daysAfter(7)))]);

    const results = await Promise.all([
      store.markExpired(exportIdOf(1)),
      store.markExpired(exportIdOf(1)),
    ]);

    expect(results.toSorted()).toEqual([false, true]);
  });
});

describe('listFailedWithUpload', () => {
  test('アップロードのIDが残る失敗だけをIDの順に返す', async () => {
    await seed([
      queuedRowOf(3, 1, { ...failedColumnsOf(), uploadId: 'upload-3' }),
      queuedRowOf(1, 1, { ...failedColumnsOf(), uploadId: 'upload-1' }),
      queuedRowOf(2, 1, failedColumnsOf()),
      queuedRowOf(4, 1, generatingColumnsOf({ uploadId: 'upload-4' })),
      queuedRowOf(5, 1, readyColumnsOf(daysAfter(7))),
    ]);

    const rows = await store.listFailedWithUpload({ limit: 100 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(3)]);
    expect(rows.map((row) => row.uploadId)).toEqual(['upload-1', 'upload-3']);
  });

  test('limitを超える件数を返さない', async () => {
    await seed([
      queuedRowOf(1, 1, { ...failedColumnsOf(), uploadId: 'upload-1' }),
      queuedRowOf(2, 1, { ...failedColumnsOf(), uploadId: 'upload-2' }),
      queuedRowOf(3, 1, { ...failedColumnsOf(), uploadId: 'upload-3' }),
    ]);

    const rows = await store.listFailedWithUpload({ limit: 2 });

    expect(rows.map((row) => row.id)).toEqual([exportIdOf(1), exportIdOf(2)]);
  });
});

describe('clearUpload', () => {
  test('失敗の記録のアップロードのIDだけを外し、読み出しの対象から外す', async () => {
    await seed([
      queuedRowOf(1, 1, { ...failedColumnsOf(), uploadId: 'upload-1' }),
    ]);

    await store.clearUpload(exportIdOf(1));

    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'failed',
      uploadId: null,
      failureKind: 'error',
      failedAt: T0,
    });
    expect(await store.listFailedWithUpload({ limit: 100 })).toEqual([]);
  });

  test('失敗でない記録と存在しない記録は変えない', async () => {
    await seed([
      queuedRowOf(1, 1, generatingColumnsOf({ uploadId: 'upload-1' })),
    ]);

    await store.clearUpload(exportIdOf(1));
    await store.clearUpload(exportIdOf(9));

    expect((await store.find(exportIdOf(1)))?.uploadId).toBe('upload-1');
  });
});
