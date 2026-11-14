import { beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import { OWNER_OPERATION_BATCH_LIMIT } from '../../core/media/ports.ts';
import {
  createStore,
  fileIdOf,
  insertFile,
  insertReason,
  readReasons,
  T0,
  USER_A,
  USER_B,
} from './testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  filePurposeRow,
  insertManyFiles,
  rangeOf,
} from './testing/media-operations-fixtures.ts';
import {
  createHookedQueue,
  createQuarantine,
  failingFromAttempt,
  relocatedIdsOf,
  relocateMessagesOf,
} from './testing/media-quarantine-fixtures.ts';
import { failingFileStore } from './testing/upload-receiver-fixtures.ts';

const failure = new Error('障害を再現する');

const OWNER = { kind: 'user', id: USER_A } as const;

async function reasonPairs(): Promise<[string, string][]> {
  return (await readReasons()).map((row) => [row.fileId, row.reason]);
}

beforeEach(async () => {
  await clearMediaState();
});

describe('MediaQuarantineServiceの保有者単位の操作', () => {
  describe('addReasonForOwner', () => {
    test('保有者の画像用の用途のファイル(削除待ちを除く)だけに理由を加え、保存先が変わる画像の移動を依頼する', async () => {
      await insertFile(1);
      await insertFile(2, { location: 'quarantine' });
      await insertReason(2, 'auto');
      await insertFile(3, { deletedAt: T0 });
      await insertFile(4, filePurposeRow());
      await insertFile(5, { eraseRequestedAt: T0 });
      await insertFile(6, { ownerId: USER_B });
      await insertFile(7, { ownerKind: 'admin', ownerId: USER_A });
      const { quarantine, sent } = createQuarantine();

      const result = await quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 3, hasMore: false });
      expect(await reasonPairs()).toEqual([
        [fileIdOf(1), 'user_suspended'],
        [fileIdOf(2), 'auto'],
        [fileIdOf(2), 'user_suspended'],
        [fileIdOf(3), 'user_suspended'],
      ]);
      expect(relocatedIdsOf(sent)).toEqual([fileIdOf(1), fileIdOf(3)]);
    });

    test('既に理由を持つ画像だけなら何も変えずに0件を返す', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'user_suspended');
      const before = await readReasons();
      const { quarantine, sent } = createQuarantine();

      const result = await quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 0, hasMore: false });
      expect(await readReasons()).toEqual(before);
      expect(sent).toEqual([]);
    });

    test('上限件数ちょうどなら残りが無いことを返す', async () => {
      await insertManyFiles(rangeOf(1, OWNER_OPERATION_BATCH_LIMIT));
      const { quarantine, sent } = createQuarantine();

      const result = await quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({
        processed: OWNER_OPERATION_BATCH_LIMIT,
        hasMore: false,
      });
      expect(relocateMessagesOf(sent)).toHaveLength(
        OWNER_OPERATION_BATCH_LIMIT / 25,
      );
    });

    test('上限件数を超えると残りがあることを返し、繰り返しで全件に理由を加える', async () => {
      const total = OWNER_OPERATION_BATCH_LIMIT + 1;
      await insertManyFiles(rangeOf(1, total));
      const { quarantine, sent } = createQuarantine();

      const first = await quarantine.addReasonForOwner(OWNER, 'user_suspended');
      const second = await quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(first).toEqual({
        processed: OWNER_OPERATION_BATCH_LIMIT,
        hasMore: true,
      });
      expect(second).toEqual({ processed: 1, hasMore: false });
      expect((await readReasons()).map((row) => row.fileId)).toEqual(
        rangeOf(1, total).map(fileIdOf),
      );
      expect(relocatedIdsOf(sent)).toEqual(rangeOf(1, total).map(fileIdOf));
      expect(
        relocateMessagesOf(sent).every((fileIds) => fileIds.length <= 25),
      ).toBe(true);
    });

    test('理由の記録で失敗した後の再実行で、失敗しなかった場合と同じ結果になる', async () => {
      await insertManyFiles(rangeOf(1, 3));
      const files = failingFileStore({
        addReasons: () => Promise.reject(failure),
      });

      await expect(
        createQuarantine({ files }).quarantine.addReasonForOwner(
          OWNER,
          'user_suspended',
        ),
      ).rejects.toBe(failure);
      expect(await readReasons()).toEqual([]);
      const retried = createQuarantine();
      const result = await retried.quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 3, hasMore: false });
      expect((await readReasons()).map((row) => row.fileId)).toEqual(
        rangeOf(1, 3).map(fileIdOf),
      );
      expect(relocatedIdsOf(retried.sent)).toEqual(rangeOf(1, 3).map(fileIdOf));
    });

    test('依頼の送信で失敗すると一時的な失敗を返し、再実行は確定済みの理由を変えずに依頼し直さず、送れなかった画像の移動を日次の保存先の照合に任せる', async () => {
      await insertManyFiles(rangeOf(1, 30));
      const failing = createHookedQueue(failingFromAttempt(2, failure));

      const error: unknown = await createQuarantine({ queue: failing.queue })
        .quarantine.addReasonForOwner(OWNER, 'user_suspended')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unavailable',
        code: 'storage_unavailable',
      });
      const recorded = await readReasons();
      expect(recorded.map((row) => row.fileId)).toEqual(
        rangeOf(1, 30).map(fileIdOf),
      );
      const retried = createQuarantine();
      const result = await retried.quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 0, hasMore: false });
      expect(await readReasons()).toEqual(recorded);
      expect(retried.sent).toEqual([]);
      expect(await createStore().findLocationMismatches(100)).toEqual(
        rangeOf(1, 30).map(fileIdOf),
      );
    });
  });

  describe('removeReasonForOwner', () => {
    test('保有者の画像からその理由だけを取り除き、他の理由を持つ画像は隔離のまま残し、削除待ちの画像の移動は依頼しない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'user_suspended');
      await insertFile(2, { location: 'quarantine' });
      await insertReason(2, 'user_suspended');
      await insertReason(2, 'auto');
      await insertFile(3, { location: 'quarantine', eraseRequestedAt: T0 });
      await insertReason(3, 'user_suspended');
      await insertFile(4, { location: 'quarantine', ownerId: USER_B });
      await insertReason(4, 'user_suspended');
      const { quarantine, sent } = createQuarantine();

      const result = await quarantine.removeReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 3, hasMore: false });
      expect(await reasonPairs()).toEqual([
        [fileIdOf(2), 'auto'],
        [fileIdOf(4), 'user_suspended'],
      ]);
      expect(relocatedIdsOf(sent)).toEqual([fileIdOf(1)]);
    });

    test('上限件数を超えると残りがあることを返し、繰り返しで全件から理由を取り除く', async () => {
      const total = OWNER_OPERATION_BATCH_LIMIT + 1;
      await insertManyFiles(rangeOf(1, total));
      await createQuarantine().quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );
      await createQuarantine().quarantine.addReasonForOwner(
        OWNER,
        'user_suspended',
      );
      const { quarantine, sent } = createQuarantine();

      const first = await quarantine.removeReasonForOwner(
        OWNER,
        'user_suspended',
      );
      const second = await quarantine.removeReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(first).toEqual({
        processed: OWNER_OPERATION_BATCH_LIMIT,
        hasMore: true,
      });
      expect(second).toEqual({ processed: 1, hasMore: false });
      expect(await readReasons()).toEqual([]);
      expect(relocatedIdsOf(sent)).toEqual(rangeOf(1, total).map(fileIdOf));
    });

    test('理由の解除で失敗した後の再実行で、失敗しなかった場合と同じ結果になる', async () => {
      for (const index of [1, 2]) {
        await insertFile(index, { location: 'quarantine' });
        await insertReason(index, 'user_suspended');
      }
      const before = await readReasons();
      const files = failingFileStore({
        removeReasons: () => Promise.reject(failure),
      });

      await expect(
        createQuarantine({ files }).quarantine.removeReasonForOwner(
          OWNER,
          'user_suspended',
        ),
      ).rejects.toBe(failure);
      expect(await readReasons()).toEqual(before);
      const retried = createQuarantine();
      const result = await retried.quarantine.removeReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 2, hasMore: false });
      expect(await readReasons()).toEqual([]);
      expect(relocatedIdsOf(retried.sent)).toEqual([fileIdOf(1), fileIdOf(2)]);
    });

    test('依頼の送信で失敗すると一時的な失敗を返し、再実行は解除済みの理由を変えずに依頼し直さず、送れなかった画像の移動を日次の保存先の照合に任せる', async () => {
      await insertManyFiles(rangeOf(1, 30), () => ({ location: 'quarantine' }));
      for (const index of rangeOf(1, 30)) {
        await insertReason(index, 'user_suspended');
      }
      const failing = createHookedQueue(failingFromAttempt(2, failure));

      const error: unknown = await createQuarantine({ queue: failing.queue })
        .quarantine.removeReasonForOwner(OWNER, 'user_suspended')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unavailable',
        code: 'storage_unavailable',
      });
      expect(await readReasons()).toEqual([]);
      const retried = createQuarantine();
      const result = await retried.quarantine.removeReasonForOwner(
        OWNER,
        'user_suspended',
      );

      expect(result).toEqual({ processed: 0, hasMore: false });
      expect(await readReasons()).toEqual([]);
      expect(retried.sent).toEqual([]);
      expect(await createStore().findLocationMismatches(100)).toEqual(
        rangeOf(1, 30).map(fileIdOf),
      );
    });
  });
});
