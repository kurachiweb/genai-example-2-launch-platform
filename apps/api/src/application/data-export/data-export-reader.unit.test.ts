import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { dataExportDownloadPathOf } from '../../../common-lib/data-export/data-export-rules.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type { DataExportRecord } from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import {
  type DataExportReader,
  StoreDataExportReader,
} from './data-export-reader.ts';
import { DATA_EXPORT_TYPES } from './data-export-types.ts';
import {
  createAccountGuard,
  createStore,
  FIXED_CLOCK,
  NOW,
  OTHER_USER_ID,
  readyRecordOf,
  recordOf,
  SESSION,
  USER_ID,
} from './testing/data-export-request-fakes.ts';

const HOUR_MS = 3_600_000;

const idOf = (serial: number): string =>
  `01JE0DXEXPT${String(serial).padStart(15, '0')}`;

function setup(records: readonly DataExportRecord[], guardError?: Error) {
  const calls: string[] = [];
  const fakeStore = createStore(calls, { records });
  const container = new Container();
  container
    .bind(IDENTITY_PLATFORM_TYPES.AccountGuard)
    .toConstantValue(
      createAccountGuard(
        calls,
        guardError === undefined ? {} : { error: guardError },
      ),
    );
  container
    .bind(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    .toConstantValue(fakeStore.store);
  container.bind(PLATFORM_TYPES.Clock).toConstantValue(FIXED_CLOCK);
  container
    .bind<DataExportReader>(DATA_EXPORT_TYPES.DataExportReader)
    .to(StoreDataExportReader);
  return {
    reader: container.get<DataExportReader>(DATA_EXPORT_TYPES.DataExportReader),
    calls,
    fakeStore,
  };
}

describe('DataExportReader.listMine', () => {
  test('本人の記録だけを、状態を問わず要求の新しい順に最大first + 1件返す', async () => {
    const { reader, fakeStore } = setup([
      recordOf({ id: idOf(1), status: 'expired' }),
      recordOf({ id: idOf(2), status: 'failed', failureKind: 'error' }),
      recordOf({ id: idOf(3), userId: OTHER_USER_ID }),
      recordOf({ id: idOf(4) }),
      recordOf({ id: idOf(5), status: 'generating' }),
    ]);

    const views = await reader.listMine(SESSION, {
      first: 3,
      afterId: undefined,
    });

    expect(views.map(({ record }) => record.id)).toEqual([
      idOf(5),
      idOf(4),
      idOf(2),
      idOf(1),
    ]);
    expect(views.map(({ record }) => record.status)).toEqual([
      'generating',
      'queued',
      'failed',
      'expired',
    ]);
    expect(fakeStore.listCalls).toEqual([
      { userId: USER_ID, afterId: undefined, limit: 3 },
    ]);
  });

  test('afterIdを保存先へ渡し、その前の記録から返す', async () => {
    const { reader, fakeStore } = setup([
      recordOf({ id: idOf(1) }),
      recordOf({ id: idOf(2) }),
      recordOf({ id: idOf(3) }),
    ]);

    const views = await reader.listMine(SESSION, {
      first: 20,
      afterId: idOf(3),
    });

    expect(views.map(({ record }) => record.id)).toEqual([idOf(2), idOf(1)]);
    expect(fakeStore.listCalls[0]?.afterId).toBe(idOf(3));
  });

  test('記録が無ければ空を返す', async () => {
    const { reader } = setup([]);

    const views = await reader.listMine(SESSION, {
      first: 20,
      afterId: undefined,
    });

    expect(views).toEqual([]);
  });

  test('完了で有効期限の前の記録だけにダウンロードのパスを付ける', async () => {
    const { reader } = setup([
      readyRecordOf(idOf(1), new Date(NOW.getTime() + HOUR_MS)),
      readyRecordOf(idOf(2), new Date(NOW.getTime() + 1)),
      readyRecordOf(idOf(3), NOW),
      readyRecordOf(idOf(4), new Date(NOW.getTime() - HOUR_MS)),
      readyRecordOf(idOf(5), new Date(NOW.getTime() + HOUR_MS), {
        status: 'expired',
      }),
      recordOf({ id: idOf(6), status: 'queued' }),
      recordOf({ id: idOf(7), status: 'generating' }),
      recordOf({ id: idOf(8), status: 'failed', failureKind: 'too_large' }),
    ]);

    const views = await reader.listMine(SESSION, {
      first: 20,
      afterId: undefined,
    });
    const pathOf = (serial: number): string | null | undefined =>
      views.find(({ record }) => record.id === idOf(serial))?.downloadPath;

    expect(pathOf(1)).toBe(dataExportDownloadPathOf(idOf(1)));
    expect(pathOf(2)).toBe(dataExportDownloadPathOf(idOf(2)));
    expect(pathOf(3)).toBeNull();
    expect(pathOf(4)).toBeNull();
    expect(pathOf(5)).toBeNull();
    expect(pathOf(6)).toBeNull();
    expect(pathOf(7)).toBeNull();
    expect(pathOf(8)).toBeNull();
  });

  test('完了の記録に期限が無い場合はパスを付けない', async () => {
    const { reader } = setup([
      readyRecordOf(idOf(1), NOW, { expiresAt: null }),
    ]);

    const [view] = await reader.listMine(SESSION, {
      first: 20,
      afterId: undefined,
    });

    expect(view?.downloadPath).toBeNull();
  });

  test('未ログインなど本人を確かめられない場合は、保存先を読まずにそのままの例外で拒否する', async () => {
    const denial = new AppError({
      kind: 'unauthenticated',
      code: 'unauthenticated',
      message: 'ログインしてください。',
    });
    const { reader, calls } = setup([recordOf({ id: idOf(1) })], denial);

    const error = await reader
      .listMine(SESSION, { first: 20, afterId: undefined })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBe(denial);
    expect(calls).toEqual(['guard.requireUser']);
  });
});
