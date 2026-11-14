import { beforeEach, describe, expect, test } from 'vitest';

import type { MediaFileView } from '../../core/media/media-file.ts';
import {
  after,
  clearMediaTables,
  createRecordingStore,
  createStore,
  createTestClock,
  expectSplitWithinBindLimit,
  expectWithinBindLimit,
  FILE_PURPOSE,
  fileIdOf,
  fileIdsOf,
  FINDINGS,
  IMAGE_PURPOSE,
  insertFile,
  insertFiles,
  insertReason,
  objectKeyOf,
  readFile,
  readFileIds,
  readReasons,
  recordOf,
  T0,
  USER_A,
} from './testing/media-file-store-fixtures.ts';

beforeEach(async () => {
  await clearMediaTables();
});

describe('D1MediaFileStoreの記録の書き込みと取得', () => {
  describe('insertReceiving・markStored', () => {
    test('受付中の画像の記録を保存先の現在値・未保存・未紐付けで追加し、保存完了で日時を付ける', async () => {
      const clock = createTestClock(T0);
      const store = createStore(clock);

      await store.insertReceiving(recordOf(1));

      expect(await readFile(1)).toEqual({
        id: fileIdOf(1),
        objectKey: objectKeyOf(1),
        purpose: IMAGE_PURPOSE,
        storage: 'images',
        location: 'images',
        ownerKind: 'user',
        ownerId: USER_A,
        originalFileName: 'photo.png',
        contentType: 'image/png',
        byteSize: 1024,
        width: 640,
        height: 480,
        storedAt: null,
        attachedAt: null,
        moderationStatus: 'pending',
        moderationDetail: null,
        moderatedAt: null,
        eraseRequestedAt: null,
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
      });

      clock.set(after(1000));
      await store.markStored(fileIdOf(1));

      expect(await readFile(1)).toMatchObject({
        storedAt: after(1000),
        updatedAt: after(1000),
        createdAt: T0,
      });
    });

    test('ファイル用の用途と動作確認の主体は、ファイル用の保存先と識別子の無い保有者で記録する', async () => {
      await createStore().insertReceiving(
        recordOf(1, {
          purpose: FILE_PURPOSE,
          storage: 'files',
          owner: { kind: 'system' },
          originalFileName: 'notes.txt',
          contentType: 'text/plain; charset=utf-8',
          width: null,
          height: null,
          moderationStatus: 'not_required',
        }),
      );

      expect(await readFile(1)).toMatchObject({
        storage: 'files',
        location: 'files',
        ownerKind: 'system',
        ownerId: null,
        contentType: 'text/plain; charset=utf-8',
        width: null,
        height: null,
        moderationStatus: 'not_required',
      });
    });

    test('保存完了の2回目は最初の日時を変えない', async () => {
      const clock = createTestClock(T0);
      const store = createStore(clock);
      await store.insertReceiving(recordOf(1));
      await store.markStored(fileIdOf(1));

      clock.set(after(5000));
      await store.markStored(fileIdOf(1));

      expect(await readFile(1)).toMatchObject({ storedAt: T0 });
    });
  });

  describe('findViews', () => {
    test('記録を隔離理由を含む画面向けの形にし、MIMEタイプの引数を除き、無い識別子を含めない', async () => {
      await insertFile(1, {
        attachedAt: after(1),
        moderationStatus: 'flagged',
        location: 'quarantine',
      });
      await insertReason(1, 'admin_action');
      await insertReason(1, 'auto');
      await insertFile(2, {
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
        ownerKind: 'system',
        ownerId: null,
        originalFileName: 'notes.txt',
        contentType: 'text/plain; charset=utf-8',
        width: null,
        height: null,
        storedAt: null,
        deletedAt: after(2),
        eraseRequestedAt: after(3),
        moderationStatus: 'not_required',
      });

      const views = await createStore().findViews([
        fileIdOf(1),
        fileIdOf(2),
        fileIdOf(3),
      ]);

      expect([...views.keys()].toSorted()).toEqual([fileIdOf(1), fileIdOf(2)]);
      expect(views.get(fileIdOf(1))).toEqual({
        id: fileIdOf(1),
        objectKey: objectKeyOf(1),
        purpose: IMAGE_PURPOSE,
        storage: 'images',
        location: 'quarantine',
        owner: { kind: 'user', id: USER_A },
        originalFileName: 'photo.png',
        contentType: 'image/png',
        byteSize: 1024,
        width: 640,
        height: 480,
        stored: true,
        attached: true,
        deletedAt: null,
        eraseRequested: false,
        moderationStatus: 'flagged',
        quarantineReasons: ['auto', 'admin_action'],
        quarantined: true,
        createdAt: T0,
      } satisfies MediaFileView);
      expect(views.get(fileIdOf(2))).toEqual({
        id: fileIdOf(2),
        objectKey: objectKeyOf(2),
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
        owner: { kind: 'system' },
        originalFileName: 'notes.txt',
        contentType: 'text/plain',
        byteSize: 1024,
        width: null,
        height: null,
        stored: false,
        attached: false,
        deletedAt: after(2),
        eraseRequested: true,
        moderationStatus: 'not_required',
        quarantineReasons: [],
        quarantined: false,
        createdAt: T0,
      } satisfies MediaFileView);
    });

    test('90件を超える識別子はバインド変数の上限に収まるよう分けて照会し、全件を返す', async () => {
      await insertFiles(200);
      await insertReason(150, 'product_hidden');
      const { store, placeholderCounts } = createRecordingStore();

      const views = await store.findViews(fileIdsOf(200));

      expect(views.size).toBe(200);
      expect(views.get(fileIdOf(150))?.quarantineReasons).toEqual([
        'product_hidden',
      ]);
      expectSplitWithinBindLimit(placeholderCounts);
    });

    test('識別子が空なら照会しない', async () => {
      const { store, placeholderCounts } = createRecordingStore();

      const views = await store.findViews([]);

      expect(views.size).toBe(0);
      expect(placeholderCounts).toEqual([]);
    });
  });

  describe('attach', () => {
    test('未紐付けの記録だけに紐付けの日時を付け、紐付け済みの紐付けと更新の日時を変えずに空の一覧を返す', async () => {
      await insertFile(1);
      await insertFile(2, { attachedAt: T0 });

      const unattachable = await createStore(
        createTestClock(after(1000)),
      ).attach([fileIdOf(1), fileIdOf(2), fileIdOf(1)]);

      expect(unattachable).toEqual([]);
      expect(await readFile(1)).toMatchObject({
        attachedAt: after(1000),
        updatedAt: after(1000),
      });
      expect(await readFile(2)).toMatchObject({
        attachedAt: T0,
        updatedAt: T0,
      });
    });

    test('存在しない・論理削除済み・削除待ちの識別子を1件ずつ返し、どの記録も紐付けない', async () => {
      await insertFile(1);
      await insertFile(2, { deletedAt: T0 });
      await insertFile(3, { eraseRequestedAt: T0 });

      const unattachable = await createStore(
        createTestClock(after(1000)),
      ).attach([
        fileIdOf(1),
        fileIdOf(2),
        fileIdOf(3),
        fileIdOf(4),
        fileIdOf(4),
      ]);

      expect(unattachable.toSorted()).toEqual([
        fileIdOf(2),
        fileIdOf(3),
        fileIdOf(4),
      ]);
      for (const index of [1, 2, 3]) {
        expect(await readFile(index)).toMatchObject({
          attachedAt: null,
          updatedAt: T0,
        });
      }
    });

    test('90件を超える識別子をバインド変数の上限に収めて全件に紐付けの日時を付ける', async () => {
      await insertFiles(200);
      const { store, placeholderCounts } = createRecordingStore();

      const unattachable = await store.attach(fileIdsOf(200));

      const views = await createStore().findViews(fileIdsOf(200));
      expect(unattachable).toEqual([]);
      expect([...views.values()].every((view) => view.attached)).toBe(true);
      expectWithinBindLimit(placeholderCounts);
    });

    test('90件を超える識別子の最後の1件が論理削除済みなら、先頭の記録も紐付けない', async () => {
      await insertFiles(200);
      await createStore().markDeleted([fileIdOf(200)]);

      const unattachable = await createStore().attach(fileIdsOf(200));

      const views = await createStore().findViews(fileIdsOf(200));
      expect(unattachable).toEqual([fileIdOf(200)]);
      expect([...views.values()].some((view) => view.attached)).toBe(false);
    });
  });

  describe.each([
    ['markDeleted', 'deletedAt'],
    ['markEraseRequested', 'eraseRequestedAt'],
  ] as const)('%s', (method, column) => {
    test(`${column}が空の記録だけに日時を付け、既にある日時を変えない`, async () => {
      await insertFile(1);
      await insertFile(2, { [column]: T0 });
      await insertFile(3);

      await createStore(createTestClock(after(1000)))[method]([
        fileIdOf(1),
        fileIdOf(2),
      ]);

      expect((await readFile(1))?.[column]).toEqual(after(1000));
      expect((await readFile(2))?.[column]).toEqual(T0);
      expect((await readFile(3))?.[column]).toBeNull();
    });
  });

  describe('remove', () => {
    test('指定の記録とその隔離理由を消し、他の記録と理由を残す', async () => {
      await insertFile(1);
      await insertReason(1, 'auto');
      await insertFile(2);
      await insertReason(2, 'auto');

      await createStore().remove([fileIdOf(1)]);

      expect(await readFileIds()).toEqual([fileIdOf(2)]);
      expect((await readReasons()).map((row) => row.fileId)).toEqual([
        fileIdOf(2),
      ]);
    });

    test('90件を超える識別子を分けて消す', async () => {
      await insertFiles(200);
      const { store, placeholderCounts } = createRecordingStore();

      await store.remove(fileIdsOf(200));

      expect(await readFileIds()).toEqual([]);
      expectSplitWithinBindLimit(placeholderCounts);
    });
  });

  describe('recordModeration', () => {
    test('判定待ちの画像を問題なしとして記録し、隔離理由を加えない', async () => {
      await insertFile(1, { moderationStatus: 'pending' });

      const recorded = await createStore(
        createTestClock(after(1000)),
      ).recordModeration(fileIdOf(1), { verdict: 'passed' });

      expect(recorded).toBe(true);
      expect(await readFile(1)).toMatchObject({
        moderationStatus: 'passed',
        moderationDetail: null,
        moderatedAt: after(1000),
      });
      expect(await readReasons()).toEqual([]);
    });

    test('不適切の判定は状態・検出内容・自動判定の理由をまとめて記録し、2回目は理由が1件のまま状態も最初の結果のまま変わらない', async () => {
      await insertFile(1, { moderationStatus: 'pending' });
      const clock = createTestClock(after(1000));
      const store = createStore(clock);

      const first = await store.recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: FINDINGS,
      });
      clock.set(after(2000));
      const second = await store.recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: [{ source: 'unprocessable', reason: 'rejected-by-service' }],
      });

      expect([first, second]).toEqual([true, false]);
      expect(await readFile(1)).toMatchObject({
        moderationStatus: 'flagged',
        moderationDetail: FINDINGS,
        moderatedAt: after(1000),
      });
      expect(await readReasons()).toEqual([
        {
          id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/) as unknown,
          fileId: fileIdOf(1),
          reason: 'auto',
          createdAt: after(1000),
        },
      ]);
    });

    test('未判定の画像は判定し直せ、不適切なら他の理由を残して自動判定の理由を加える', async () => {
      await insertFile(1, { moderationStatus: 'undetermined' });
      await insertReason(1, 'product_hidden');

      const recorded = await createStore().recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: FINDINGS,
      });

      expect(recorded).toBe(true);
      expect((await readReasons()).map((row) => row.reason)).toEqual([
        'auto',
        'product_hidden',
      ]);
    });

    test('判定待ちを未判定として記録した後も、未判定から再び記録できる', async () => {
      await insertFile(1, { moderationStatus: 'pending' });
      const store = createStore();

      const undetermined = await store.recordModeration(fileIdOf(1), {
        verdict: 'undetermined',
      });
      const passed = await store.recordModeration(fileIdOf(1), {
        verdict: 'passed',
      });

      expect([undetermined, passed]).toEqual([true, true]);
      expect(await readFile(1)).toMatchObject({ moderationStatus: 'passed' });
    });

    test.each(['passed', 'not_required'] as const)(
      '状態が%sの画像は不適切の判定を記録せず、隔離理由も加えない',
      async (status) => {
        await insertFile(1, { moderationStatus: status });

        const recorded = await createStore().recordModeration(fileIdOf(1), {
          verdict: 'flagged',
          findings: FINDINGS,
        });

        expect(recorded).toBe(false);
        expect(await readFile(1)).toMatchObject({
          moderationStatus: status,
          moderationDetail: null,
          moderatedAt: null,
        });
        expect(await readReasons()).toEqual([]);
      },
    );

    test('管理者が自動判定の理由を外した後に重複の依頼が届いても、再び理由を加えない', async () => {
      await insertFile(1, { moderationStatus: 'pending' });
      const clock = createTestClock(after(1000));
      const store = createStore(clock);
      await store.recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: FINDINGS,
      });
      clock.set(after(2000));
      await store.removeReasons([fileIdOf(1)], 'auto');

      clock.set(after(3000));
      const recorded = await store.recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: FINDINGS,
      });

      expect(recorded).toBe(false);
      expect(await readReasons()).toEqual([]);
    });

    test('記録が無い画像の判定は何も書かずに偽を返す', async () => {
      const recorded = await createStore().recordModeration(fileIdOf(1), {
        verdict: 'flagged',
        findings: FINDINGS,
      });

      expect(recorded).toBe(false);
      expect(await readReasons()).toEqual([]);
    });
  });

  describe('updateLocation', () => {
    test('保存先の現在値が移動元と同じときだけ更新して真を返す', async () => {
      await insertFile(1, { location: 'images' });
      const store = createStore(createTestClock(after(1000)));

      const mismatched = await store.updateLocation(
        fileIdOf(1),
        'quarantine',
        'images',
      );
      const moved = await store.updateLocation(
        fileIdOf(1),
        'images',
        'quarantine',
      );

      expect([mismatched, moved]).toEqual([false, true]);
      expect(await readFile(1)).toMatchObject({
        location: 'quarantine',
        updatedAt: after(1000),
      });
    });
  });

  describe('addReasons・removeReasons', () => {
    test('理由を各記録へ加え、既にある理由・重複した識別子・記録の無い識別子は無視する', async () => {
      await insertFile(1);
      await insertReason(1, 'admin_action', T0);
      await insertFile(2);

      await createStore(createTestClock(after(1000))).addReasons(
        [fileIdOf(1), fileIdOf(2), fileIdOf(2), fileIdOf(3)],
        'admin_action',
      );

      expect(
        (await readReasons()).map(({ fileId, reason, createdAt }) => ({
          fileId,
          reason,
          createdAt,
        })),
      ).toEqual([
        { fileId: fileIdOf(1), reason: 'admin_action', createdAt: T0 },
        {
          fileId: fileIdOf(2),
          reason: 'admin_action',
          createdAt: after(1000),
        },
      ]);
    });

    test('多数の識別子への追加と解除をバインド変数の上限に収まるよう分けて行う', async () => {
      await insertFiles(200);
      const adding = createRecordingStore();

      await adding.store.addReasons(fileIdsOf(200), 'user_suspended');

      expect(await readReasons()).toHaveLength(200);
      expectSplitWithinBindLimit(adding.placeholderCounts);

      const removing = createRecordingStore();
      await removing.store.removeReasons(fileIdsOf(200), 'user_suspended');

      expect(await readReasons()).toEqual([]);
      expectSplitWithinBindLimit(removing.placeholderCounts);
    });

    test('解除は指定の記録から指定の理由だけを取り除く', async () => {
      await insertFile(1);
      await insertReason(1, 'auto');
      await insertReason(1, 'admin_action');
      await insertFile(2);
      await insertReason(2, 'admin_action');

      await createStore().removeReasons([fileIdOf(1)], 'admin_action');

      expect(
        (await readReasons()).map(({ fileId, reason }) => ({ fileId, reason })),
      ).toEqual([
        { fileId: fileIdOf(1), reason: 'auto' },
        { fileId: fileIdOf(2), reason: 'admin_action' },
      ]);
    });
  });
});
