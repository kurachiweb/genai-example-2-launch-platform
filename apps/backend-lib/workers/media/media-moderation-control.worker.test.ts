import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type { QuarantineReason } from '../../core/media/media-file.ts';
import type { MediaEraser } from '../../core/media/ports.ts';
import type { MediaModerationResult } from './media-moderation-control.ts';
import {
  after,
  createStore,
  db,
  fileIdOf,
  insertFile,
  insertReason,
  readFile,
  readReasons,
} from './testing/media-file-store-fixtures.ts';
import {
  callerMarkExists,
  callerStatements,
  createModerationControl,
  OPERATED_AT,
  racingFileStore,
} from './testing/media-moderation-control-fixtures.ts';
import {
  clearMediaState,
  filePurposeRow,
  objectExists,
  purgedKeysOf,
  putObject,
} from './testing/media-operations-fixtures.ts';
import {
  createHookedQueue,
  failingFromAttempt,
  relocateMessagesOf,
} from './testing/media-quarantine-fixtures.ts';
import {
  recordLogs,
  resetLogging,
} from './testing/upload-receiver-fixtures.ts';

const failure = new Error('障害を再現する');

const FILE = 1;

const MISSING = 99;

type ReasonOperation = 'addReason' | 'removeReason';

async function reasonsOf(index: number): Promise<QuarantineReason[]> {
  return (await readReasons())
    .filter((row) => row.fileId === fileIdOf(index))
    .map((row) => row.reason);
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

function expectStorageUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    kind: 'unavailable',
    code: 'storage_unavailable',
  });
}

function expectNotApplicable(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    kind: 'bad_request',
    code: 'quarantine_not_applicable',
  });
}

async function eraseRequestedElsewhere(index: number): Promise<void> {
  await db
    .update(mediaFiles)
    .set({ eraseRequestedAt: after(30_000) })
    .where(eq(mediaFiles.id, fileIdOf(index)));
}

async function removedElsewhere(index: number): Promise<void> {
  await db.delete(mediaFiles).where(eq(mediaFiles.id, fileIdOf(index)));
}

beforeEach(async () => {
  await clearMediaState();
});

afterEach(() => {
  resetLogging();
});

describe('D1MediaModerationControl', () => {
  describe('addReason', () => {
    test('理由の追加と呼び出し側の文を同じ一括の書き込みで確定し、隔離バケットへの移動を依頼する', async () => {
      await insertFile(FILE);
      const { control, sent } = createModerationControl();

      const result = await control.addReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe<MediaModerationResult>('changed');
      expect(await readReasons()).toEqual([
        expect.objectContaining({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          createdAt: OPERATED_AT,
        }),
      ]);
      expect(await callerMarkExists()).toBe(true);
      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(FILE)]]);
    });

    test('既に他の理由で隔離バケットにある画像には理由を加えるだけで、移動を依頼しない', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'auto');
      const { control, sent } = createModerationControl();

      const result = await control.addReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe('changed');
      expect(await reasonsOf(FILE)).toEqual(['admin_action', 'auto']);
      expect(await callerMarkExists()).toBe(true);
      expect(relocateMessagesOf(sent)).toEqual([]);
    });

    test('既に同じ理由を持てば呼び出し側の文を書かずにunchangedを返し、保存先が食い違えば移動を依頼し直す', async () => {
      await insertFile(FILE);
      await insertReason(FILE, 'admin_action');
      const { control, sent } = createModerationControl();

      const result = await control.addReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect(await reasonsOf(FILE)).toEqual(['admin_action']);
      expect(await callerMarkExists()).toBe(false);
      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(FILE)]]);
    });

    test('既に同じ理由を持ち保存先も隔離バケットなら、何も書かず移動も依頼しない', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'admin_action');
      const { control, sent } = createModerationControl();

      const result = await control.addReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect(await callerMarkExists()).toBe(false);
      expect(sent).toEqual([]);
    });

    test('読み取りの後に別の操作が同じ理由を加えると、呼び出し側の文ごと取り消してunchangedを返す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      const files = racingFileStore(() => insertReason(FILE, 'admin_action'));
      const { control, sent } = createModerationControl({ files });

      const result = await control.addReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect(await readReasons()).toEqual([
        expect.objectContaining({
          reason: 'admin_action',
          createdAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
      ]);
      expect(await callerMarkExists()).toBe(false);
      expect(sent).toEqual([]);
    });

    test.each([
      ['削除待ちの印が付く', eraseRequestedElsewhere],
      ['記録が物理削除される', removedElsewhere],
    ])(
      '読み取りの後に%sと、呼び出し側の文ごと取り消してnot-foundを返す',
      async (_label, race) => {
        await insertFile(FILE);
        const files = racingFileStore(() => race(FILE));
        const { control, sent } = createModerationControl({ files });

        const result = await control.addReason({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: callerStatements(),
        });

        expect(result).toBe('not-found');
        expect(await readReasons()).toEqual([]);
        expect(await callerMarkExists()).toBe(false);
        expect(sent).toEqual([]);
      },
    );

    test('呼び出し側の文の違反は理由の追加ごと取り消し、そのまま投げる', async () => {
      await insertFile(FILE);
      const { control, sent } = createModerationControl();

      const error = await errorOf(
        control.addReason({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: callerStatements({ violate: true }),
        }),
      );

      expect(error).not.toBeInstanceOf(AppError);
      expect(String((error as Error).cause ?? error)).toMatch(
        /NOT NULL constraint failed: media_files\.object_key/u,
      );
      expect(await readReasons()).toEqual([]);
      expect(await callerMarkExists()).toBe(false);
      expect(sent).toEqual([]);
    });

    test('移動の依頼に失敗するとstorage_unavailableを投げ、理由と呼び出し側の文は確定したまま残す', async () => {
      const logs = recordLogs();
      await insertFile(FILE);
      const hooked = createHookedQueue(failingFromAttempt(1, failure));
      const { control } = createModerationControl({ queue: hooked.queue });

      const error = await errorOf(
        control.addReason({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: callerStatements(),
        }),
      );

      expectStorageUnavailable(error);
      expect(await reasonsOf(FILE)).toEqual(['admin_action']);
      expect(await callerMarkExists()).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          category: 'api.media.moderation-control',
          reason: 'admin_action',
        }),
      );
    });
  });

  describe('removeReason', () => {
    test('最後の理由の解除と呼び出し側の文を同じ一括の書き込みで確定し、画像用のバケットへの移動を依頼する', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'auto');
      const { control, sent } = createModerationControl();

      const result = await control.removeReason({
        fileId: fileIdOf(FILE),
        reason: 'auto',
        statements: callerStatements(),
      });

      expect(result).toBe('changed');
      expect(await readReasons()).toEqual([]);
      expect(await callerMarkExists()).toBe(true);
      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(FILE)]]);
    });

    test('他の理由が残れば指定の理由だけを外し、移動を依頼しない', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'admin_action');
      await insertReason(FILE, 'product_hidden');
      const { control, sent } = createModerationControl();

      const result = await control.removeReason({
        fileId: fileIdOf(FILE),
        reason: 'admin_action',
        statements: callerStatements(),
      });

      expect(result).toBe('changed');
      expect(await reasonsOf(FILE)).toEqual(['product_hidden']);
      expect(await callerMarkExists()).toBe(true);
      expect(sent).toEqual([]);
    });

    test('理由を持たなければ呼び出し側の文を書かずにunchangedを返し、保存先が食い違えば移動を依頼し直す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      const { control, sent } = createModerationControl();

      const result = await control.removeReason({
        fileId: fileIdOf(FILE),
        reason: 'auto',
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect(await callerMarkExists()).toBe(false);
      expect(relocateMessagesOf(sent)).toEqual([[fileIdOf(FILE)]]);
    });

    test('読み取りの後に別の操作が同じ理由を外すと、呼び出し側の文ごと取り消してunchangedを返す', async () => {
      await insertFile(FILE);
      await insertReason(FILE, 'auto');
      await insertReason(FILE, 'admin_action');
      const files = racingFileStore(async () => {
        await createStore().removeReasons([fileIdOf(FILE)], 'auto');
      });
      const { control } = createModerationControl({ files });

      const result = await control.removeReason({
        fileId: fileIdOf(FILE),
        reason: 'auto',
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect(await reasonsOf(FILE)).toEqual(['admin_action']);
      expect(await callerMarkExists()).toBe(false);
    });

    test('読み取りの後に削除待ちの印が付くと、理由を残したまま呼び出し側の文ごと取り消してnot-foundを返す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'auto');
      const files = racingFileStore(() => eraseRequestedElsewhere(FILE));
      const { control, sent } = createModerationControl({ files });

      const result = await control.removeReason({
        fileId: fileIdOf(FILE),
        reason: 'auto',
        statements: callerStatements(),
      });

      expect(result).toBe('not-found');
      expect(await reasonsOf(FILE)).toEqual(['auto']);
      expect(await callerMarkExists()).toBe(false);
      expect(sent).toEqual([]);
    });

    test('移動の依頼に失敗するとstorage_unavailableを投げ、理由の解除と呼び出し側の文は確定したまま残す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'admin_action');
      const hooked = createHookedQueue(failingFromAttempt(1, failure));
      const { control } = createModerationControl({ queue: hooked.queue });

      const error = await errorOf(
        control.removeReason({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: callerStatements(),
        }),
      );

      expectStorageUnavailable(error);
      expect(await readReasons()).toEqual([]);
      expect(await callerMarkExists()).toBe(true);
    });
  });

  describe.each<ReasonOperation>(['addReason', 'removeReason'])(
    '%sの対象の確かめ',
    (operation) => {
      test('対象のファイルが無ければnot-foundを返し、何も書かない', async () => {
        const { control, sent } = createModerationControl();

        const result = await control[operation]({
          fileId: fileIdOf(MISSING),
          reason: 'admin_action',
          statements: callerStatements(),
        });

        expect(result).toBe('not-found');
        expect(await callerMarkExists()).toBe(false);
        expect(sent).toEqual([]);
      });

      test('削除待ちのファイルはnot-foundを返し、理由も呼び出し側の文も書かない', async () => {
        await insertFile(FILE, {
          location: 'quarantine',
          eraseRequestedAt: after(0),
        });
        await insertReason(FILE, 'auto');
        const { control, sent } = createModerationControl();

        const result = await control[operation]({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: callerStatements(),
        });

        expect(result).toBe('not-found');
        expect(await reasonsOf(FILE)).toEqual(['auto']);
        expect(await callerMarkExists()).toBe(false);
        expect(sent).toEqual([]);
      });

      test('ファイル用の用途のファイルはquarantine_not_applicableで拒否し、何も書かない', async () => {
        await insertFile(FILE, filePurposeRow());
        const { control, sent } = createModerationControl();

        const error = await errorOf(
          control[operation]({
            fileId: fileIdOf(FILE),
            reason: 'admin_action',
            statements: callerStatements(),
          }),
        );

        expectNotApplicable(error);
        expect(await readReasons()).toEqual([]);
        expect(await callerMarkExists()).toBe(false);
        expect(sent).toEqual([]);
      });
    },
  );

  describe('requestErase', () => {
    test('削除待ちの印と呼び出し側の文を確定してから、オブジェクトと記録を即時に削除する', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'auto');
      await putObject('quarantine', FILE);
      const { control, sent } = createModerationControl();

      const result = await control.requestErase({
        fileId: fileIdOf(FILE),
        statements: callerStatements(),
      });

      expect(result).toBe('changed');
      expect(await readFile(FILE)).toBeUndefined();
      expect(await objectExists('quarantine', FILE)).toBe(false);
      expect(purgedKeysOf(sent)).toHaveLength(1);
      expect(await callerMarkExists()).toBe(true);
    });

    test('即時の削除に失敗するとstorage_unavailableを投げ、削除待ちの印と呼び出し側の文は確定したまま残す', async () => {
      const logs = recordLogs();
      await insertFile(FILE, { location: 'quarantine' });
      await insertReason(FILE, 'auto');
      const eraser: MediaEraser = { erase: () => Promise.reject(failure) };
      const { control } = createModerationControl({ eraser });

      const error = await errorOf(
        control.requestErase({
          fileId: fileIdOf(FILE),
          statements: callerStatements(),
        }),
      );

      expectStorageUnavailable(error);
      expect((await readFile(FILE))?.eraseRequestedAt).toEqual(OPERATED_AT);
      expect(await callerMarkExists()).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          category: 'api.media.moderation-control',
        }),
      );
    });

    test('既に削除待ちならunchangedを返し、呼び出し側の文を書かず削除も試みない', async () => {
      await insertFile(FILE, {
        location: 'quarantine',
        eraseRequestedAt: after(0),
      });
      let erased = 0;
      const eraser: MediaEraser = {
        erase: () => {
          erased += 1;
          return Promise.resolve({ erased: 0 });
        },
      };
      const { control } = createModerationControl({ eraser });

      const result = await control.requestErase({
        fileId: fileIdOf(FILE),
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect((await readFile(FILE))?.eraseRequestedAt).toEqual(after(0));
      expect(await callerMarkExists()).toBe(false);
      expect(erased).toBe(0);
    });

    test('読み取りの後に別の操作が削除待ちの印を付けると、呼び出し側の文ごと取り消してunchangedを返す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      const files = racingFileStore(() => eraseRequestedElsewhere(FILE));
      const { control } = createModerationControl({ files });

      const result = await control.requestErase({
        fileId: fileIdOf(FILE),
        statements: callerStatements(),
      });

      expect(result).toBe('unchanged');
      expect((await readFile(FILE))?.eraseRequestedAt).toEqual(after(30_000));
      expect(await callerMarkExists()).toBe(false);
    });

    test('読み取りの後に記録が物理削除されると、呼び出し側の文ごと取り消してnot-foundを返す', async () => {
      await insertFile(FILE, { location: 'quarantine' });
      const files = racingFileStore(() => removedElsewhere(FILE));
      const { control } = createModerationControl({ files });

      const result = await control.requestErase({
        fileId: fileIdOf(FILE),
        statements: callerStatements(),
      });

      expect(result).toBe('not-found');
      expect(await callerMarkExists()).toBe(false);
    });

    test('対象のファイルが無ければnot-foundを返し、何も書かない', async () => {
      const { control } = createModerationControl();

      const result = await control.requestErase({
        fileId: fileIdOf(MISSING),
        statements: callerStatements(),
      });

      expect(result).toBe('not-found');
      expect(await callerMarkExists()).toBe(false);
    });

    test('ファイル用の用途のファイルはquarantine_not_applicableで拒否し、何も書かない', async () => {
      await insertFile(FILE, filePurposeRow());
      const { control } = createModerationControl();

      const error = await errorOf(
        control.requestErase({
          fileId: fileIdOf(FILE),
          statements: callerStatements(),
        }),
      );

      expectNotApplicable(error);
      expect((await readFile(FILE))?.eraseRequestedAt).toBeNull();
      expect(await callerMarkExists()).toBe(false);
    });
  });
});
