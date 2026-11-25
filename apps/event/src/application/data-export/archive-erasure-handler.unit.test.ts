import { describe, expect, test } from 'bun:test';

import type {
  DataExportRecord,
  DataExportStore,
  ExportArchiveStorage,
} from '../../../lib/core/data-export/ports.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { rejectionOf } from './archive-generation-service.fixtures.ts';
import {
  ARCHIVE_ERASURE_BATCH_SIZE,
  ArchiveErasureHandler,
} from './archive-erasure-handler.ts';
import { recordOf, USER_ID } from './data-export-handlers.fixtures.ts';

const OTHER_USER_ID = '01JE0DXUS00000000000000002';

const EVENT_TYPES = ['withdrawn', 'purge_due'] as const;

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: '01JE0DXEV00000000000000001',
    userId: USER_ID,
    type,
    occurredAt: new Date('2026-11-22T00:00:00.000Z'),
  };
}

function idOf(index: number): string {
  return `01JE0DXPT${String(index).padStart(17, '0')}`;
}

function keyOf(index: number): string {
  return `data-exports/${idOf(index)}.zip`;
}

function readyRecord(index: number, userId = USER_ID): DataExportRecord {
  return recordOf({
    id: idOf(index),
    userId,
    status: 'ready',
    objectKey: keyOf(index),
  });
}

function uploadingRecord(
  index: number,
  status: 'queued' | 'generating' | 'failed',
): DataExportRecord {
  return recordOf({
    id: idOf(index),
    status,
    objectKey: keyOf(index),
    uploadId: `UPLOAD-${String(index)}`,
  });
}

interface Harness {
  readonly handler: ArchiveErasureHandler;
  readonly rows: DataExportRecord[];
  readonly calls: string[];
  readonly listLimits: number[];
}

interface Failures {
  readonly abort?: Error;
  readonly remove?: Error;
  readonly delete?: Error;
}

function createHarness(
  initial: readonly DataExportRecord[],
  failures: Failures = {},
): Harness {
  const rows = [...initial];
  const calls: string[] = [];
  const listLimits: number[] = [];
  const store: Pick<DataExportStore, 'listForUser' | 'removeMany'> = {
    listForUser: ({ userId, limit }) => {
      listLimits.push(limit);
      return Promise.resolve(
        rows.filter((row) => row.userId === userId).slice(0, limit),
      );
    },
    removeMany: (ids) => {
      if (failures.remove !== undefined) {
        return Promise.reject(failures.remove);
      }
      calls.push(`remove:${String(ids.length)}`);
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) {
          rows.splice(index, 1);
        }
      }
      return Promise.resolve();
    },
  };
  const storage: Pick<ExportArchiveStorage, 'abortUpload' | 'delete'> = {
    abortUpload: (objectKey, uploadId) => {
      if (failures.abort !== undefined) {
        return Promise.reject(failures.abort);
      }
      calls.push(`abort:${objectKey}:${uploadId}`);
      return Promise.resolve();
    },
    delete: (objectKeys) => {
      if (failures.delete !== undefined) {
        return Promise.reject(failures.delete);
      }
      calls.push(`delete:${objectKeys.join(',')}`);
      return Promise.resolve();
    },
  };
  return {
    handler: new ArchiveErasureHandler(store, storage),
    rows,
    calls,
    listLimits,
  };
}

describe('ArchiveErasureHandler', () => {
  test('1回に消す記録の上限は100件である', () => {
    expect(ARCHIVE_ERASURE_BATCH_SIZE).toBe(100);
  });

  describe.each(EVENT_TYPES)('%s', (type) => {
    const event = eventOf(type);

    test('利用者の記録を上限で読み、オブジェクトの削除の後に記録を削除してdoneにする', async () => {
      const harness = createHarness([readyRecord(1), readyRecord(2)]);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });

      expect(harness.listLimits).toStrictEqual([100]);
      expect(harness.calls).toStrictEqual([
        `delete:${keyOf(1)},${keyOf(2)}`,
        'remove:2',
      ]);
      expect(harness.rows).toStrictEqual([]);
    });

    test.each(['queued', 'generating', 'failed'] as const)(
      '%sで未完了のアップロードが残る記録は、アップロードを破棄してからオブジェクトと記録を削除する',
      async (status) => {
        const harness = createHarness([uploadingRecord(1, status)]);

        await harness.handler.handle(event);

        expect(harness.calls).toStrictEqual([
          `abort:${keyOf(1)}:UPLOAD-1`,
          `delete:${keyOf(1)}`,
          'remove:1',
        ]);
        expect(harness.rows).toStrictEqual([]);
      },
    );

    test('期限切れ・オブジェクトの無い失敗の記録は、破棄も削除も呼ばずに記録だけを削除する', async () => {
      const harness = createHarness([
        recordOf({ id: idOf(1), status: 'expired' }),
        recordOf({ id: idOf(2), status: 'failed' }),
      ]);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });

      expect(harness.calls).toStrictEqual(['remove:2']);
      expect(harness.rows).toStrictEqual([]);
    });

    test('アップロードの識別子だけでオブジェクトのキーが無い記録は破棄を呼ばない', async () => {
      const harness = createHarness([
        recordOf({ id: idOf(1), status: 'failed', uploadId: 'UPLOAD-1' }),
      ]);

      await harness.handler.handle(event);

      expect(harness.calls).toStrictEqual(['remove:1']);
    });

    test('記録が1件も無ければ何も呼ばずにdoneにする', async () => {
      const harness = createHarness([]);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });
      expect(harness.calls).toStrictEqual([]);
    });

    test('100件を消した回は続きを返し、次の呼び出しで残りを消してdoneにする', async () => {
      const rows = Array.from({ length: 101 }, (_, index) =>
        readyRecord(index + 1),
      );
      const harness = createHarness(rows);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'continue',
      });
      expect(harness.rows.map(({ id }) => id)).toStrictEqual([idOf(101)]);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });
      expect(harness.rows).toStrictEqual([]);
    });

    test('99件なら続きを返さずdoneにする', async () => {
      const rows = Array.from({ length: 99 }, (_, index) =>
        readyRecord(index + 1),
      );
      const harness = createHarness(rows);

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });
    });

    test('他の利用者の記録は読まず、削除せず、オブジェクトも消さない', async () => {
      const other = readyRecord(9, OTHER_USER_ID);
      const harness = createHarness([readyRecord(1), other]);

      await harness.handler.handle(event);

      expect(harness.rows).toStrictEqual([other]);
      expect(harness.calls).toStrictEqual([`delete:${keyOf(1)}`, 'remove:1']);
    });

    test('同じイベントの2回目の呼び出しは何も変えずdoneにする', async () => {
      const other = readyRecord(9, OTHER_USER_ID);
      const harness = createHarness([readyRecord(1), other]);
      await harness.handler.handle(event);
      const callsAfterFirst = [...harness.calls];

      expect(await harness.handler.handle(event)).toStrictEqual({
        kind: 'done',
      });

      expect(harness.calls).toStrictEqual(callsAfterFirst);
      expect(harness.rows).toStrictEqual([other]);
    });

    test('アップロードの破棄の失敗はそのまま投げ、オブジェクトも記録も消さない', async () => {
      const failure = new Error('R2が使えない');
      const harness = createHarness([uploadingRecord(1, 'failed')], {
        abort: failure,
      });

      expect(await rejectionOf(harness.handler.handle(event))).toBe(failure);
      expect(harness.calls).toStrictEqual([]);
      expect(harness.rows).toHaveLength(1);
    });

    test('オブジェクトの削除の失敗はそのまま投げ、記録を残して次の実行で消し直せるようにする', async () => {
      const failure = new Error('R2の削除に失敗');
      const harness = createHarness([readyRecord(1)], { delete: failure });

      expect(await rejectionOf(harness.handler.handle(event))).toBe(failure);
      expect(harness.rows).toHaveLength(1);
    });

    test('記録の削除の失敗はそのまま投げる', async () => {
      const failure = new Error('D1が使えない');
      const harness = createHarness([readyRecord(1)], { remove: failure });

      expect(await rejectionOf(harness.handler.handle(event))).toBe(failure);
    });
  });
});
