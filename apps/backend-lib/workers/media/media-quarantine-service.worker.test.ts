import { inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { mediaFileQuarantineReasons } from '../../../db/schema/media/media-file-quarantine-reasons.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type { QuarantineReason } from '../../core/media/media-file.ts';
import { QUARANTINED_IMAGE_LIST_MAX_LIMIT } from '../../core/media/ports.ts';
import {
  after,
  db,
  FINDINGS,
  fileIdOf,
  insertFile,
  insertReason,
  readReasons,
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

async function reasonsAtSend(
  fileIds: readonly string[],
  reason: QuarantineReason,
): Promise<string[]> {
  const rows = await db
    .select({
      fileId: mediaFileQuarantineReasons.fileId,
      reason: mediaFileQuarantineReasons.reason,
    })
    .from(mediaFileQuarantineReasons)
    .where(inArray(mediaFileQuarantineReasons.fileId, [...fileIds]));
  return rows
    .filter((row) => row.reason === reason)
    .map((row) => row.fileId)
    .toSorted();
}

beforeEach(async () => {
  await clearMediaState();
});

describe('MediaQuarantineService', () => {
  describe('addReason', () => {
    test('理由を記録してから、保存先が変わる画像の移動を25件ずつ依頼する', async () => {
      const ids = rangeOf(1, 30).map(fileIdOf);
      await insertManyFiles(rangeOf(1, 30));
      const recordedAtSend: string[][] = [];
      const hooked = createHookedQueue(async (envelope) => {
        const { fileIds } = envelope.body as { fileIds: readonly string[] };
        recordedAtSend.push(await reasonsAtSend(fileIds, 'admin_action'));
      });
      const { quarantine } = createQuarantine({ queue: hooked.queue });

      await quarantine.addReason(ids, 'admin_action');

      const messages = relocateMessagesOf(hooked.sent);
      expect(messages.map((fileIds) => fileIds.length)).toEqual([25, 5]);
      expect(relocatedIdsOf(hooked.sent)).toEqual(ids);
      expect(recordedAtSend).toEqual(
        messages.map((fileIds) => [...fileIds].toSorted()),
      );
      expect((await readReasons()).map((row) => row.fileId)).toEqual(ids);
    });

    test('既に他の理由で隔離バケットにある画像には理由を加えるだけで、移動を依頼しない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'auto');
      await insertFile(2);
      const { quarantine, sent } = createQuarantine();

      await quarantine.addReason([fileIdOf(1), fileIdOf(2)], 'product_hidden');

      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(2)]]);
      expect(
        (await readReasons()).map((row) => [row.fileId, row.reason]),
      ).toEqual([
        [fileIdOf(1), 'auto'],
        [fileIdOf(1), 'product_hidden'],
        [fileIdOf(2), 'product_hidden'],
      ]);
    });

    test('ファイル用の用途のファイルを含むと不正な要求として拒否し、何も変えない', async () => {
      await insertFile(1);
      await insertFile(2, filePurposeRow());
      const { quarantine, sent } = createQuarantine();

      const error: unknown = await quarantine
        .addReason([fileIdOf(1), fileIdOf(2)], 'admin_action')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'quarantine_not_applicable',
      });
      expect(await readReasons()).toEqual([]);
      expect(sent).toEqual([]);
    });

    test('存在しない識別子は無視し、存在する画像だけに理由を加える', async () => {
      await insertFile(1);
      const { quarantine, sent } = createQuarantine();

      await quarantine.addReason([fileIdOf(1), fileIdOf(99)], 'admin_action');

      expect((await readReasons()).map((row) => row.fileId)).toEqual([
        fileIdOf(1),
      ]);
      expect(relocatedIdsOf(sent)).toEqual([fileIdOf(1)]);
    });

    test('削除待ちの画像には理由を加えるだけで、移動を依頼しない', async () => {
      await insertFile(1, { eraseRequestedAt: after(0) });
      const { quarantine, sent } = createQuarantine();

      await quarantine.addReason([fileIdOf(1)], 'admin_action');

      expect((await readReasons()).map((row) => row.fileId)).toEqual([
        fileIdOf(1),
      ]);
      expect(sent).toEqual([]);
    });

    test('同じ理由の重複の追加は記録を変えず、移動済みの画像の移動を依頼し直さない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'admin_action', after(-60_000));
      const before = await readReasons();
      const { quarantine, sent } = createQuarantine();

      await quarantine.addReason([fileIdOf(1), fileIdOf(1)], 'admin_action');

      expect(await readReasons()).toEqual(before);
      expect(sent).toEqual([]);
    });

    test('依頼の送信の失敗は一時的な失敗として返し、理由は確定したまま再実行で移動を依頼し直す', async () => {
      await insertManyFiles(rangeOf(1, 30));
      const ids = rangeOf(1, 30).map(fileIdOf);
      const failing = createHookedQueue(failingFromAttempt(2, failure));

      const error: unknown = await createQuarantine({ queue: failing.queue })
        .quarantine.addReason(ids, 'admin_action')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unavailable',
        code: 'storage_unavailable',
      });
      expect((await readReasons()).map((row) => row.fileId)).toEqual(ids);
      const before = await readReasons();
      const retried = createQuarantine();
      await retried.quarantine.addReason(ids, 'admin_action');
      expect(await readReasons()).toEqual(before);
      expect(relocatedIdsOf(retried.sent)).toEqual(ids);
    });

    test('理由の記録の失敗は送信せずにそのまま伝え、何も変えない', async () => {
      await insertFile(1);
      const files = failingFileStore({
        addReasons: () => Promise.reject(failure),
      });
      const { quarantine, sent } = createQuarantine({ files });

      await expect(
        quarantine.addReason([fileIdOf(1)], 'admin_action'),
      ).rejects.toBe(failure);
      expect(await readReasons()).toEqual([]);
      expect(sent).toEqual([]);
    });
  });

  describe('removeReason', () => {
    test('その理由だけを取り除き、他の理由が残る画像の移動は依頼しない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'auto');
      await insertReason(1, 'admin_action');
      await insertFile(2, { location: 'quarantine' });
      await insertReason(2, 'admin_action');
      const { quarantine, sent } = createQuarantine();

      await quarantine.removeReason([fileIdOf(1), fileIdOf(2)], 'admin_action');

      expect(
        (await readReasons()).map((row) => [row.fileId, row.reason]),
      ).toEqual([[fileIdOf(1), 'auto']]);
      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(2)]]);
    });

    test('理由を取り除いてから、戻す画像の移動を25件ずつ依頼する', async () => {
      await insertManyFiles(rangeOf(1, 26), () => ({ location: 'quarantine' }));
      for (const index of rangeOf(1, 26)) {
        await insertReason(index, 'product_hidden');
      }
      const ids = rangeOf(1, 26).map(fileIdOf);
      const remainingAtSend: string[][] = [];
      const hooked = createHookedQueue(async (envelope) => {
        const { fileIds } = envelope.body as { fileIds: readonly string[] };
        remainingAtSend.push(await reasonsAtSend(fileIds, 'product_hidden'));
      });
      const { quarantine } = createQuarantine({ queue: hooked.queue });

      await quarantine.removeReason(ids, 'product_hidden');

      expect(
        relocateMessagesOf(hooked.sent).map((fileIds) => fileIds.length),
      ).toEqual([25, 1]);
      expect(relocatedIdsOf(hooked.sent)).toEqual(ids);
      expect(remainingAtSend).toEqual([[], []]);
      expect(await readReasons()).toEqual([]);
    });

    test('持っていない理由の解除は記録を変えず、移動を依頼しない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'auto');
      await insertFile(2);
      const before = await readReasons();
      const { quarantine, sent } = createQuarantine();

      await quarantine.removeReason(
        [fileIdOf(1), fileIdOf(2)],
        'user_suspended',
      );

      expect(await readReasons()).toEqual(before);
      expect(sent).toEqual([]);
    });

    test('ファイル用の用途のファイルを含むと不正な要求として拒否し、何も変えない', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'admin_action');
      await insertFile(2, filePurposeRow());
      const before = await readReasons();
      const { quarantine, sent } = createQuarantine();

      await expect(
        quarantine.removeReason([fileIdOf(1), fileIdOf(2)], 'admin_action'),
      ).rejects.toMatchObject({
        kind: 'bad_request',
        code: 'quarantine_not_applicable',
      });
      expect(await readReasons()).toEqual(before);
      expect(sent).toEqual([]);
    });

    test('依頼の送信の失敗は一時的な失敗として返し、再実行で戻す画像の移動を依頼し直す', async () => {
      await insertFile(1, { location: 'quarantine' });
      await insertReason(1, 'admin_action');
      const failing = createHookedQueue(failingFromAttempt(1, failure));

      await expect(
        createQuarantine({ queue: failing.queue }).quarantine.removeReason(
          [fileIdOf(1)],
          'admin_action',
        ),
      ).rejects.toMatchObject({ kind: 'unavailable' });
      expect(await readReasons()).toEqual([]);
      const retried = createQuarantine();
      await retried.quarantine.removeReason([fileIdOf(1)], 'admin_action');
      expect(relocateMessagesOf(retried.sent)).toEqual([[fileIdOf(1)]]);
    });
  });

  describe('listByReason', () => {
    beforeEach(async () => {
      for (const index of [1, 2, 3]) {
        await insertFile(index, {
          location: 'quarantine',
          moderationStatus: 'flagged',
          moderationDetail: FINDINGS,
        });
        await insertReason(index, 'auto', after(index * 1000));
      }
      await insertFile(4, { location: 'quarantine' });
      await insertReason(4, 'admin_action', after(10_000));
    });

    test('理由ごとに、隔離された日時の新しい順に検出内容とともに返し、続きをたどれる', async () => {
      const { quarantine } = createQuarantine();

      const first = await quarantine.listByReason({
        reason: 'auto',
        cursor: undefined,
        limit: 2,
      });
      const second = await quarantine.listByReason({
        reason: 'auto',
        cursor: first.nextCursor,
        limit: 2,
      });

      expect(first.items.map((item) => item.file.id)).toEqual([
        fileIdOf(3),
        fileIdOf(2),
      ]);
      expect(first.items[0]).toMatchObject({
        quarantinedAt: after(3000),
        findings: FINDINGS,
        file: { quarantined: true, quarantineReasons: ['auto'] },
      });
      expect(first.nextCursor).toBeTypeOf('string');
      expect(second.items.map((item) => item.file.id)).toEqual([fileIdOf(1)]);
      expect(second.nextCursor).toBeUndefined();
    });

    test.each([1, QUARANTINED_IMAGE_LIST_MAX_LIMIT])(
      '件数%iを受け付ける',
      async (limit) => {
        const page = await createQuarantine().quarantine.listByReason({
          reason: 'auto',
          cursor: undefined,
          limit,
        });

        expect(page.items).toHaveLength(Math.min(limit, 3));
      },
    );

    test.each([0, QUARANTINED_IMAGE_LIST_MAX_LIMIT + 1, 1.5, Number.NaN])(
      '件数%sを照会せずに不正な要求として拒否する',
      async (limit) => {
        const queried: unknown[] = [];
        const files = failingFileStore({
          listQuarantined: (input) => {
            queried.push(input);
            return Promise.resolve({ items: [], nextCursor: undefined });
          },
        });

        const error: unknown = await createQuarantine({ files })
          .quarantine.listByReason({ reason: 'auto', cursor: undefined, limit })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          kind: 'bad_request',
          code: 'invalid_limit',
        });
        expect(queried).toEqual([]);
      },
    );

    test('不正なカーソルを不正な要求として拒否する', async () => {
      await expect(
        createQuarantine().quarantine.listByReason({
          reason: 'auto',
          cursor: 'not-a-cursor',
          limit: 10,
        }),
      ).rejects.toMatchObject({ kind: 'bad_request', code: 'invalid_cursor' });
    });
  });
});
