import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import type { ClaimRequest } from '../../core/media/ports.ts';
import {
  ADMIN_A,
  after,
  createStore,
  FILE_PURPOSE,
  fileIdOf,
  IMAGE_PURPOSE,
  insertFile,
  insertReason,
  readFile,
  readFileIds,
  T0,
  USER_A,
  USER_B,
} from './testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  createOperations,
  filePurposeRow,
  listObjectKeys,
  purgedKeysOf,
  putObject,
  readText,
} from './testing/media-operations-fixtures.ts';
import {
  failingFileStore,
  failingObjectStore,
  recordLogs,
  resetLogging,
} from './testing/upload-receiver-fixtures.ts';

const failure = new Error('障害を再現する');

const OWNER = { kind: 'user', id: USER_A } as const;

function claimOf(
  indexes: readonly number[],
  overrides: Partial<ClaimRequest> = {},
): ClaimRequest {
  return {
    fileIds: indexes.map(fileIdOf),
    purpose: IMAGE_PURPOSE,
    owner: OWNER,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearMediaState();
});

afterEach(() => {
  resetLogging();
});

describe('MediaFilesService', () => {
  describe('claim', () => {
    test('全件が条件を満たせば紐付け、同じ用途・同じ主体の2回目は日時を変えずに成功する', async () => {
      await insertFile(1);
      await insertFile(2, { location: 'quarantine' });
      await insertReason(2, 'auto');
      const { service } = createOperations();

      const first = await service.claim(claimOf([1, 2]));
      const attachedAt = (await readFile(1))?.attachedAt;
      const second = await service.claim(claimOf([1, 2]));

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(attachedAt).toEqual(T0);
      expect((await readFile(1))?.attachedAt).toEqual(T0);
      expect((await readFile(2))?.attachedAt).toEqual(T0);
    });

    test('条件を満たさないファイルを全件の理由とともに返し、どのファイルも紐付けない', async () => {
      await insertFile(1);
      await insertFile(2, { storedAt: null });
      await insertFile(3, { deletedAt: T0 });
      await insertFile(4, { eraseRequestedAt: T0 });
      await insertFile(5, filePurposeRow());
      await insertFile(6, { ownerId: USER_B });
      await insertFile(7, { ownerKind: 'admin', ownerId: USER_A });
      await insertFile(8, { ownerKind: 'system', ownerId: null });
      const { service } = createOperations();

      const result = await service.claim(claimOf([1, 2, 3, 4, 5, 6, 7, 8, 9]));

      expect(result).toEqual({
        ok: false,
        failures: [
          { fileId: fileIdOf(2), reason: 'not_stored' },
          { fileId: fileIdOf(3), reason: 'deleted' },
          { fileId: fileIdOf(4), reason: 'deleted' },
          { fileId: fileIdOf(5), reason: 'purpose_mismatch' },
          { fileId: fileIdOf(6), reason: 'owner_mismatch' },
          { fileId: fileIdOf(7), reason: 'owner_mismatch' },
          { fileId: fileIdOf(8), reason: 'owner_mismatch' },
          { fileId: fileIdOf(9), reason: 'not_found' },
        ],
      });
      for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect((await readFile(index))?.attachedAt).toBeNull();
      }
    });

    test('同じ識別子を重ねて渡しても理由を1件だけ返す', async () => {
      const { service } = createOperations();

      const result = await service.claim(claimOf([9, 9]));

      expect(result).toEqual({
        ok: false,
        failures: [{ fileId: fileIdOf(9), reason: 'not_found' }],
      });
    });

    test('管理者の主体は管理者がアップロードしたファイルだけを紐付けられる', async () => {
      await insertFile(1, { ownerKind: 'admin', ownerId: ADMIN_A });
      const { service } = createOperations();

      const result = await service.claim(
        claimOf([1], { owner: { kind: 'admin', id: ADMIN_A } }),
      );

      expect(result).toEqual({ ok: true });
    });

    test('ファイル用の用途を指定すればファイル用の用途のファイルを紐付ける', async () => {
      await insertFile(1, filePurposeRow());
      const { service } = createOperations();

      const result = await service.claim(
        claimOf([1], { purpose: FILE_PURPOSE }),
      );

      expect(result).toEqual({ ok: true });
      expect((await readFile(1))?.attachedAt).toEqual(T0);
    });
  });

  describe('markDeleted', () => {
    test('論理削除の日時を付け、その後の紐付けを拒否し、論理削除済みの日時を変えない', async () => {
      await insertFile(1);
      await insertFile(2, { deletedAt: after(-1000) });
      const { service } = createOperations();

      await service.markDeleted([fileIdOf(1), fileIdOf(2)]);
      const result = await service.claim(claimOf([1]));

      expect((await readFile(1))?.deletedAt).toEqual(T0);
      expect((await readFile(2))?.deletedAt).toEqual(after(-1000));
      expect(result).toEqual({
        ok: false,
        failures: [{ fileId: fileIdOf(1), reason: 'deleted' }],
      });
    });

    test('論理削除の後も画像のオブジェクトは残り、配信を止めない', async () => {
      await insertFile(1);
      await putObject('images', 1);
      const { service } = createOperations();

      await service.markDeleted([fileIdOf(1)]);

      expect(await listObjectKeys('images')).toHaveLength(1);
    });
  });

  describe('eraseNow', () => {
    test('全バケットとデータベースから即時に消し、画像のパージを依頼する', async () => {
      await insertFile(1);
      await putObject('images', 1);
      await insertFile(2, filePurposeRow());
      await putObject('files', 2);
      await insertFile(3);
      const { service, sent } = createOperations();

      const summary = await service.eraseNow([fileIdOf(1), fileIdOf(2)]);

      expect(summary).toEqual({ erased: 2 });
      expect(await readFileIds()).toEqual([fileIdOf(3)]);
      expect(await listObjectKeys('images')).toEqual([]);
      expect(await listObjectKeys('files')).toEqual([]);
      expect(purgedKeysOf(sent)).toHaveLength(1);
    });

    test('物理削除が途中で失敗すると削除待ちの印を残してAppError(unavailable)を投げ、紐付け・内容の読み出し・日次の削除の対象が変わる', async () => {
      const logs = recordLogs();
      await insertFile(1);
      await putObject('images', 1);
      const objects = failingObjectStore({
        delete: () => Promise.reject(failure),
      });
      const { service } = createOperations({ objects });

      const error: unknown = await service
        .eraseNow([fileIdOf(1)])
        .catch((caught: unknown) => caught);
      const { service: healthy } = createOperations();
      const claim = await healthy.claim(claimOf([1]));
      const content = await healthy.openContent(fileIdOf(1));
      const candidates = await createStore().findEraseCandidates({
        deletedBefore: T0,
        unattachedCreatedBefore: T0,
        limit: 10,
      });

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unavailable',
        code: 'storage_unavailable',
        retryAfterSeconds: 5,
      });
      expect((await readFile(1))?.eraseRequestedAt).toEqual(T0);
      expect(claim).toEqual({
        ok: false,
        failures: [{ fileId: fileIdOf(1), reason: 'deleted' }],
      });
      expect(content).toBeUndefined();
      expect(candidates).toEqual([fileIdOf(1)]);
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          category: 'api.media.files',
          fileCount: 1,
        }),
      );
    });

    test('削除待ちの印を付けられなければ何も変えずにAppError(unavailable)を投げる', async () => {
      await insertFile(1);
      const files = failingFileStore({
        markEraseRequested: () => Promise.reject(failure),
      });
      const { service } = createOperations({ files });

      await expect(service.eraseNow([fileIdOf(1)])).rejects.toMatchObject({
        kind: 'unavailable',
      });
      expect((await readFile(1))?.eraseRequestedAt).toBeNull();
    });
  });

  describe('findMany', () => {
    test('存在するファイルの画面向けの情報を識別子ごとに返す', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'admin_action');
      await insertFile(2, filePurposeRow());
      const { service } = createOperations();

      const views = await service.findMany([1, 2, 3].map(fileIdOf));

      expect([...views.keys()].toSorted()).toEqual([1, 2].map(fileIdOf));
      expect(views.get(fileIdOf(1))).toMatchObject({
        originalFileName: 'photo.png',
        contentType: 'image/png',
        byteSize: 1024,
        width: 640,
        height: 480,
        quarantined: true,
        objectKey: expect.any(String) as unknown,
      });
      expect(views.get(fileIdOf(2))).toMatchObject({
        contentType: 'application/pdf',
        quarantined: false,
      });
    });
  });

  describe('openContent', () => {
    test('画像とファイルの内容を現在の保存先から読み出す', async () => {
      await insertFile(1);
      await putObject('images', 1, 'image-body');
      await insertFile(2, filePurposeRow());
      await putObject('files', 2, 'file-body');
      const { service } = createOperations();

      const image = await service.openContent(fileIdOf(1));
      const file = await service.openContent(fileIdOf(2));

      expect(image?.file.id).toBe(fileIdOf(1));
      expect(await readText(image?.body ?? new ReadableStream())).toBe(
        'image-body',
      );
      expect(file?.file.contentType).toBe('application/pdf');
      expect(await readText(file?.body ?? new ReadableStream())).toBe(
        'file-body',
      );
    });

    test('理由の解除の後で移動が済んでいない画像は、記録の保存先から読み出し、無ければ画像用非公開バケットから読み出す', async () => {
      await insertFile(1, { location: 'quarantine' });
      await putObject('quarantine', 1, 'not-yet-moved');
      await insertFile(2, { location: 'quarantine' });
      await putObject('images', 2, 'already-copied');
      const { service } = createOperations();

      const notMoved = await service.openContent(fileIdOf(1));
      const copied = await service.openContent(fileIdOf(2));

      expect(await readText(notMoved?.body ?? new ReadableStream())).toBe(
        'not-yet-moved',
      );
      expect(await readText(copied?.body ?? new ReadableStream())).toBe(
        'already-copied',
      );
    });

    test.each([
      ['隔離中の', 1],
      ['削除待ちの', 2],
      ['論理削除済みの', 3],
      ['保存未完了の', 4],
      ['オブジェクトが無い', 5],
      ['記録が無い', 6],
    ])('%sファイルは読み出さない', async (_, index) => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'auto');
      await putObject('quarantine', 1);
      await insertFile(2, { eraseRequestedAt: T0 });
      await putObject('images', 2);
      await insertFile(3, { deletedAt: T0 });
      await putObject('images', 3);
      await insertFile(4, { storedAt: null });
      await putObject('images', 4);
      await insertFile(5);
      const { service } = createOperations();

      const content = await service.openContent(fileIdOf(index));

      expect(content).toBeUndefined();
    });
  });
});
