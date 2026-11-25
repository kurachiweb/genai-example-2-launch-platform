import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type { DataExportRecord } from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import {
  type ArchiveDownloadService,
  StoreArchiveDownloadService,
} from './archive-download-service.ts';
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

const EXPORT_ID = '01JE0DXEXPT000000000000001';

const futureOf = (hours: number): Date =>
  new Date(NOW.getTime() + hours * HOUR_MS);

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
    .bind<ArchiveDownloadService>(DATA_EXPORT_TYPES.ArchiveDownloadService)
    .to(StoreArchiveDownloadService);
  return {
    service: container.get<ArchiveDownloadService>(
      DATA_EXPORT_TYPES.ArchiveDownloadService,
    ),
    calls,
    fakeStore,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されませんでした');
}

describe('ArchiveDownloadService.authorize', () => {
  test('本人の有効期限内の完了の記録を、現在時刻と本人のIDで照会して返す', async () => {
    const record = readyRecordOf(EXPORT_ID, futureOf(24));
    const { service, fakeStore } = setup([record]);

    const authorized = await service.authorize(SESSION, EXPORT_ID);

    expect(authorized).toBe(record);
    expect(fakeStore.ownedReadyCalls).toEqual([
      { id: EXPORT_ID, userId: USER_ID, now: NOW },
    ]);
  });

  test('未ログインの確認の失敗はそのまま投げ、記録を照会しない', async () => {
    const failure = new AppError({
      kind: 'unauthenticated',
      code: 'unauthenticated',
      message: 'ログインが必要です。',
    });
    const { service, calls } = setup(
      [readyRecordOf(EXPORT_ID, futureOf(24))],
      failure,
    );

    const error = await rejectionOf(service.authorize(SESSION, EXPORT_ID));

    expect(error).toBe(failure);
    expect(calls).toEqual(['guard.requireUser']);
  });

  test.each([
    ['小文字のID', EXPORT_ID.toLowerCase()],
    ['25文字のID', EXPORT_ID.slice(1)],
    ['空のID', ''],
    ['ULIDの文字を含まないID', 'I'.repeat(26)],
  ])('%sは、記録を照会せずに定型のnot_foundにする', async (_label, id) => {
    const { service, calls } = setup([readyRecordOf(EXPORT_ID, futureOf(24))]);

    const error = await rejectionOf(service.authorize(SESSION, id));

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(NOT_FOUND_RESPONSE.body.error.code);
    expect(calls).toEqual(['guard.requireUser']);
  });

  test.each([
    [
      '他の利用者の記録',
      readyRecordOf(EXPORT_ID, futureOf(24), { userId: OTHER_USER_ID }),
    ],
    ['作成中の記録', recordOf({ id: EXPORT_ID, status: 'generating' })],
    [
      '期限切れの状態の記録',
      recordOf({
        id: EXPORT_ID,
        status: 'expired',
        expiresAt: futureOf(24),
      }),
    ],
    ['有効期限を過ぎた完了の記録', readyRecordOf(EXPORT_ID, futureOf(-1))],
    [
      '存在しない記録',
      readyRecordOf('01JE0DXEXPT000000000000002', futureOf(24)),
    ],
  ])('%sは、同じ定型のnot_foundにする', async (_label, record) => {
    const { service } = setup([record]);

    const error = await rejectionOf(service.authorize(SESSION, EXPORT_ID));

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(NOT_FOUND_RESPONSE.body.error.code);
    expect(error.message).toBe(NOT_FOUND_RESPONSE.body.error.message);
  });
});
