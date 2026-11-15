import { beforeEach, describe, expect, test } from 'vitest';

import {
  createStore,
  fileIdOf,
  fileIdsOf,
  insertFile,
  insertReason,
  objectKeyOf,
  readFileIds,
  readReasons,
  T0,
  USER_B,
} from './testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  createOperations,
  filePurposeRow,
  insertManyFiles,
  LOCATIONS,
  listObjectKeys,
  objectExists,
  type OperationParts,
  purgedKeysOf,
  purgeMessagesOf,
  putObject,
  rangeOf,
} from './testing/media-operations-fixtures.ts';
import {
  createObjectStore,
  createRecordingQueue,
  failingFileStore,
  failingObjectStore,
} from './testing/upload-receiver-fixtures.ts';

const failure = new Error('障害を再現する');

async function arrangeMixedFiles(): Promise<void> {
  await insertFile(1);
  await putObject('images', 1);
  await insertFile(2, { location: 'quarantine' });
  await insertReason(2, 'auto');
  await putObject('quarantine', 2);
  await insertFile(3, filePurposeRow());
  await putObject('files', 3);
  await insertFile(4, { storedAt: null, deletedAt: T0 });
  await insertFile(5, { ownerId: USER_B });
  await putObject('images', 5);
}

async function expectMixedFilesErased(): Promise<void> {
  expect(await readFileIds()).toEqual([fileIdOf(5)]);
  expect(await readReasons()).toEqual([]);
  expect(await listObjectKeys('images')).toEqual([objectKeyOf(5)]);
  expect(await listObjectKeys('quarantine')).toEqual([]);
  expect(await listObjectKeys('files')).toEqual([]);
}

beforeEach(async () => {
  await clearMediaState();
});

describe('MediaFileEraser', () => {
  test('画像用の用途は画像用非公開バケットと隔離バケットから、ファイル用の用途はファイル用非公開バケットから消し、画像だけのパージを依頼して記録を消す', async () => {
    await arrangeMixedFiles();
    await putObject('quarantine', 1);
    await putObject('images', 2);
    const { eraser, sent } = createOperations();

    const summary = await eraser.erase([1, 2, 3, 4].map(fileIdOf));

    expect(summary).toEqual({ erased: 4 });
    await expectMixedFilesErased();
    expect(purgedKeysOf(sent)).toEqual([1, 2, 4].map(objectKeyOf));
  });

  test('存在しない識別子は数えず、何も送らない', async () => {
    await insertFile(1);
    const { eraser, sent } = createOperations();

    const summary = await eraser.erase([fileIdOf(9), fileIdOf(9)]);

    expect(summary).toEqual({ erased: 0 });
    expect(await readFileIds()).toEqual([fileIdOf(1)]);
    expect(sent).toEqual([]);
  });

  test('同じ識別子を重ねて渡しても1件として消す', async () => {
    await insertFile(1);
    const { eraser, sent } = createOperations();

    const summary = await eraser.erase([fileIdOf(1), fileIdOf(1)]);

    expect(summary).toEqual({ erased: 1 });
    expect(purgeMessagesOf(sent)).toEqual([[objectKeyOf(1)]]);
  });

  test('画像のパージは100件ずつ依頼し、全ての画像のキーをそろえる', async () => {
    await insertManyFiles(rangeOf(1, 250));
    await insertManyFiles(rangeOf(251, 260), filePurposeRow);
    const { eraser, sent } = createOperations();

    const summary = await eraser.erase(fileIdsOf(260));

    expect(summary).toEqual({ erased: 260 });
    expect(purgeMessagesOf(sent).map((keys) => keys.length)).toEqual([
      100, 100, 50,
    ]);
    expect(purgedKeysOf(sent)).toEqual(rangeOf(1, 250).map(objectKeyOf));
    expect(await readFileIds()).toEqual([]);
  });

  test('重複した要求の2回目は何も消さずに同じ状態を保つ', async () => {
    await arrangeMixedFiles();
    const { eraser } = createOperations();
    const ids = [1, 2, 3, 4].map(fileIdOf);

    await eraser.erase(ids);
    const second = await eraser.erase(ids);

    expect(second).toEqual({ erased: 0 });
    await expectMixedFilesErased();
  });

  describe('途中の失敗の後の再実行', () => {
    const stages: readonly [string, () => OperationParts][] = [
      [
        '記録の読み出し',
        () => ({
          files: failingFileStore({ findViews: () => Promise.reject(failure) }),
        }),
      ],
      [
        '隔離バケットからの削除',
        () => {
          const real = createObjectStore();
          return {
            objects: failingObjectStore({
              delete: (location, keys) =>
                location === 'quarantine'
                  ? Promise.reject(failure)
                  : real.delete(location, keys),
            }),
          };
        },
      ],
      ['パージの依頼', () => ({ queue: createRecordingQueue(failure).queue })],
      [
        '記録の削除',
        () => ({
          files: failingFileStore({ remove: () => Promise.reject(failure) }),
        }),
      ],
    ];

    test.each(stages)(
      '%sで失敗すると例外を投げ、再実行で全バケットとデータベースから消える',
      async (_, failingParts) => {
        await arrangeMixedFiles();
        const ids = [1, 2, 3, 4].map(fileIdOf);

        await expect(
          createOperations(failingParts()).eraser.erase(ids),
        ).rejects.toBe(failure);
        const retry = createOperations();
        const summary = await retry.eraser.erase(ids);

        expect(summary).toEqual({ erased: 4 });
        await expectMixedFilesErased();
        expect(purgedKeysOf(retry.sent)).toEqual([1, 2, 4].map(objectKeyOf));
      },
    );

    test('記録の削除に失敗した後も、オブジェクトは全バケットから消えている', async () => {
      await arrangeMixedFiles();
      const files = failingFileStore({
        remove: () => Promise.reject(failure),
      });

      await expect(
        createOperations({ files }).eraser.erase([1, 2, 3].map(fileIdOf)),
      ).rejects.toBe(failure);

      for (const location of LOCATIONS) {
        for (const index of [1, 2, 3]) {
          expect(await objectExists(location, index)).toBe(false);
        }
      }
      expect(await createStore().findViews([fileIdOf(1)])).toHaveProperty(
        'size',
        1,
      );
    });
  });
});
