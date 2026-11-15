import { beforeEach, describe, expect, test } from 'vitest';

import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import { AppError } from '../../core/errors/app-error.ts';
import {
  ADMIN_A,
  after,
  clearMediaTables,
  createStore,
  db,
  FILE_PURPOSE,
  fileIdOf,
  FINDINGS,
  insertFile,
  insertReason,
  T0,
  USER_A,
  USER_B,
  USER_C,
} from './testing/media-file-store-fixtures.ts';

beforeEach(async () => {
  await clearMediaTables();
});

describe('D1MediaFileStoreの照会', () => {
  describe('findIdsOwnedBy', () => {
    test('保有者の全用途・全状態のファイルを識別子の昇順に最大件数まで返し、他の保有者を含めない', async () => {
      await insertFile(1, { storedAt: null });
      await insertFile(2, {
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
      });
      await insertFile(3, { attachedAt: T0, deletedAt: T0 });
      await insertFile(4, { eraseRequestedAt: T0 });
      await insertFile(5, { location: 'quarantine' });
      await insertReason(5, 'user_suspended');
      await insertFile(6, { ownerId: USER_B });
      await insertFile(7, { ownerKind: 'admin', ownerId: USER_A });
      const store = createStore();
      const owner = { kind: 'user', id: USER_A } as const;

      const all = await store.findIdsOwnedBy(owner, 10);
      const limited = await store.findIdsOwnedBy(owner, 2);

      expect(all).toEqual([1, 2, 3, 4, 5].map(fileIdOf));
      expect(limited).toEqual([fileIdOf(1), fileIdOf(2)]);
    });
  });

  describe('findOwnedImageIdsByReason', () => {
    const OWNER = { kind: 'user', id: USER_A } as const;

    beforeEach(async () => {
      await insertFile(1);
      await insertFile(2, { deletedAt: T0 });
      await insertFile(3, { eraseRequestedAt: T0 });
      await insertFile(4, {
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
      });
      await insertFile(5, { location: 'quarantine' });
      await insertReason(5, 'user_suspended');
      await insertFile(6, { location: 'quarantine' });
      await insertReason(6, 'auto');
      await insertFile(7, { ownerId: USER_B });
      await insertFile(8, { location: 'quarantine', eraseRequestedAt: T0 });
      await insertReason(8, 'user_suspended');
    });

    test('理由を持たない画像は、削除待ち・ファイル用の用途・他の保有者を除き、論理削除と他の理由の画像を含めて返す', async () => {
      const ids = await createStore().findOwnedImageIdsByReason({
        owner: OWNER,
        reason: 'user_suspended',
        hasReason: false,
        limit: 10,
      });

      expect(ids).toEqual([1, 2, 6].map(fileIdOf));
    });

    test('理由を持つ画像は、その理由を持つ保有者の画像を返す', async () => {
      const ids = await createStore().findOwnedImageIdsByReason({
        owner: OWNER,
        reason: 'user_suspended',
        hasReason: true,
        limit: 10,
      });

      expect(ids).toEqual([fileIdOf(5), fileIdOf(8)]);
    });

    test('件数の上限まで識別子の昇順に返す', async () => {
      const ids = await createStore().findOwnedImageIdsByReason({
        owner: OWNER,
        reason: 'user_suspended',
        hasReason: false,
        limit: 2,
      });

      expect(ids).toEqual([fileIdOf(1), fileIdOf(2)]);
    });
  });

  describe('findEraseCandidates', () => {
    const DELETED_BEFORE = after(10_000);
    const UNATTACHED_CREATED_BEFORE = after(20_000);

    test('削除待ち・期限より前の論理削除・期限より前に作られた未紐付け(保存未完了を含む)を返す', async () => {
      await insertFile(1, { attachedAt: T0, eraseRequestedAt: after(30_000) });
      await insertFile(2, { attachedAt: T0, deletedAt: after(9999) });
      await insertFile(3, { attachedAt: T0, deletedAt: DELETED_BEFORE });
      await insertFile(4, { createdAt: after(19_999) });
      await insertFile(5, { createdAt: after(19_999), storedAt: null });
      await insertFile(6, { createdAt: UNATTACHED_CREATED_BEFORE });
      await insertFile(7, { attachedAt: T0 });
      const store = createStore();
      const query = {
        deletedBefore: DELETED_BEFORE,
        unattachedCreatedBefore: UNATTACHED_CREATED_BEFORE,
      };

      const all = await store.findEraseCandidates({ ...query, limit: 10 });
      const limited = await store.findEraseCandidates({ ...query, limit: 2 });

      expect(all).toEqual([1, 2, 4, 5].map(fileIdOf));
      expect(limited).toEqual([fileIdOf(1), fileIdOf(2)]);
    });
  });

  describe('findModerationRequeueCandidates', () => {
    const PENDING_CREATED_BEFORE = after(10_000);

    test('未判定と、期限より前に作られた判定待ちを、論理削除と削除待ちを除いて作成の古い順に返す', async () => {
      await insertFile(1, {
        moderationStatus: 'undetermined',
        createdAt: after(50_000),
      });
      await insertFile(2, {
        moderationStatus: 'pending',
        createdAt: after(9999),
      });
      await insertFile(3, {
        moderationStatus: 'pending',
        createdAt: PENDING_CREATED_BEFORE,
      });
      await insertFile(4, { moderationStatus: 'passed' });
      await insertFile(5, { moderationStatus: 'flagged' });
      await insertFile(6, { moderationStatus: 'not_required' });
      await insertFile(7, { moderationStatus: 'undetermined', deletedAt: T0 });
      await insertFile(8, {
        moderationStatus: 'pending',
        eraseRequestedAt: T0,
      });
      await insertFile(9, { moderationStatus: 'pending', createdAt: T0 });
      const store = createStore();

      const all = await store.findModerationRequeueCandidates({
        pendingCreatedBefore: PENDING_CREATED_BEFORE,
        limit: 10,
      });
      const limited = await store.findModerationRequeueCandidates({
        pendingCreatedBefore: PENDING_CREATED_BEFORE,
        limit: 1,
      });

      expect(all).toEqual([9, 2, 1].map(fileIdOf));
      expect(limited).toEqual([fileIdOf(9)]);
    });
  });

  describe('findLocationMismatches', () => {
    test('理由があるのに画像用非公開バケットにある画像と、理由が無いのに隔離バケットにある画像を返す', async () => {
      await insertFile(1, { location: 'images' });
      await insertReason(1, 'auto');
      await insertFile(2, { location: 'quarantine' });
      await insertFile(3, { location: 'quarantine' });
      await insertReason(3, 'auto');
      await insertFile(4, { location: 'images' });
      await insertFile(5, {
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
      });
      const store = createStore();

      const all = await store.findLocationMismatches(10);
      const limited = await store.findLocationMismatches(1);

      expect(all).toEqual([fileIdOf(1), fileIdOf(2)]);
      expect(limited).toEqual([fileIdOf(1)]);
    });
  });

  describe('listQuarantined', () => {
    beforeEach(async () => {
      for (const index of [1, 2, 3, 4]) {
        await insertFile(index, {
          location: 'quarantine',
          moderationStatus: 'flagged',
          moderationDetail: index === 2 ? FINDINGS : null,
        });
      }
      await insertReason(1, 'auto', after(1000));
      await insertReason(2, 'auto', after(3000));
      await insertReason(3, 'auto', after(2000));
      await insertReason(4, 'admin_action', after(4000));
      await insertFile(5, {
        location: 'quarantine',
        moderationStatus: 'flagged',
        eraseRequestedAt: T0,
      });
      await insertReason(5, 'auto', after(5000));
    });

    test('指定の理由を持つ画像を理由の新しい順に検出内容とともに返し、削除待ちを含めない', async () => {
      const page = await createStore().listQuarantined({
        reason: 'auto',
        cursor: undefined,
        limit: 10,
      });

      expect(
        page.items.map(({ file, quarantinedAt, findings }) => ({
          id: file.id,
          quarantined: file.quarantined,
          quarantinedAt,
          findings,
        })),
      ).toEqual([
        {
          id: fileIdOf(2),
          quarantined: true,
          quarantinedAt: after(3000),
          findings: FINDINGS,
        },
        {
          id: fileIdOf(3),
          quarantined: true,
          quarantinedAt: after(2000),
          findings: [],
        },
        {
          id: fileIdOf(1),
          quarantined: true,
          quarantinedAt: after(1000),
          findings: [],
        },
      ]);
      expect(page.nextCursor).toBeUndefined();
    });

    test('カーソルで続きを返し、残りが件数ちょうどなら続きのカーソルを返さない', async () => {
      const store = createStore();

      const first = await store.listQuarantined({
        reason: 'auto',
        cursor: undefined,
        limit: 2,
      });
      const second = await store.listQuarantined({
        reason: 'auto',
        cursor: first.nextCursor,
        limit: 1,
      });

      expect(first.items.map((item) => item.file.id)).toEqual([
        fileIdOf(2),
        fileIdOf(3),
      ]);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(second.items.map((item) => item.file.id)).toEqual([fileIdOf(1)]);
      expect(second.nextCursor).toBeUndefined();
    });

    test('理由の作成日時が同じ画像も、カーソルでたどると重複も欠けも無くそろう', async () => {
      await clearMediaTables();
      for (const index of [1, 2, 3]) {
        await insertFile(index, { location: 'quarantine' });
        await insertReason(index, 'admin_action', T0);
      }
      const store = createStore();

      const first = await store.listQuarantined({
        reason: 'admin_action',
        cursor: undefined,
        limit: 2,
      });
      const second = await store.listQuarantined({
        reason: 'admin_action',
        cursor: first.nextCursor,
        limit: 2,
      });

      expect(
        [...first.items, ...second.items]
          .map((item) => item.file.id)
          .toSorted(),
      ).toEqual([1, 2, 3].map(fileIdOf));
      expect(second.nextCursor).toBeUndefined();
    });

    test.each(['not-a-cursor', '1730419200000-lowercase', ''])(
      '形式の正しくないカーソル%sは不正な要求として拒否する',
      async (cursor) => {
        const listing = createStore().listQuarantined({
          reason: 'auto',
          cursor,
          limit: 10,
        });

        await expect(listing).rejects.toBeInstanceOf(AppError);
        await expect(listing).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'invalid_cursor',
        });
      },
    );
  });

  describe('findOwnerIds', () => {
    beforeEach(async () => {
      await insertFile(1, { ownerId: USER_B });
      await insertFile(2, { ownerId: USER_B, deletedAt: T0 });
      await insertFile(3, { ownerId: USER_A, storedAt: null });
      await insertFile(4, {
        ownerId: USER_C,
        purpose: FILE_PURPOSE,
        storage: 'files',
        location: 'files',
        eraseRequestedAt: T0,
      });
      await insertFile(5, { ownerId: USER_C, location: 'quarantine' });
      await insertReason(5, 'user_suspended');
      await insertFile(6, { ownerKind: 'admin', ownerId: ADMIN_A });
      await insertFile(7, { ownerKind: 'system', ownerId: null });
    });

    test('指定の種類の保有者の識別子を、ファイルの状態によらず重複無しの昇順で返し、ファイルを変えない', async () => {
      const before = await db.select().from(mediaFiles);

      const ids = await createStore().findOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 10,
      });

      expect(ids).toEqual([USER_A, USER_B, USER_C]);
      expect(await db.select().from(mediaFiles)).toEqual(before);
    });

    test('afterより後の識別子だけを件数の上限まで返す', async () => {
      const store = createStore();

      const limited = await store.findOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 2,
      });
      const rest = await store.findOwnerIds({
        kind: 'user',
        after: USER_B,
        limit: 2,
      });

      expect(limited).toEqual([USER_A, USER_B]);
      expect(rest).toEqual([USER_C]);
    });

    test('管理者の種類を指定すると利用者と動作確認の主体を含めない', async () => {
      const ids = await createStore().findOwnerIds({
        kind: 'admin',
        after: undefined,
        limit: 10,
      });

      expect(ids).toEqual([ADMIN_A]);
    });
  });
});
