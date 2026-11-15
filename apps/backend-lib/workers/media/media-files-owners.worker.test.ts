import { beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import {
  type MediaFiles,
  OWNER_ID_LIST_MAX_LIMIT,
  OWNER_OPERATION_BATCH_LIMIT,
  type OwnerIdList,
} from '../../core/media/ports.ts';
import {
  ADMIN_A,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
  readFileIds,
  T0,
  USER_A,
  USER_B,
  USER_C,
} from './testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  createOperations,
  filePurposeRow,
  insertManyFiles,
  listObjectKeys,
  purgedKeysOf,
  putObject,
  rangeOf,
  readAllRows,
} from './testing/media-operations-fixtures.ts';
import {
  failingFileStore,
  failingObjectStore,
} from './testing/upload-receiver-fixtures.ts';

const failure = new Error('障害を再現する');

const OWNER = { kind: 'user', id: USER_A } as const;

function userIdOf(index: number): string {
  return `01JC0USER${String(index).padStart(17, '0')}`;
}

async function listAll(
  files: MediaFiles,
  limit: number,
): Promise<{ pages: OwnerIdList[]; ownerIds: string[] }> {
  const pages: OwnerIdList[] = [];
  let after: string | undefined;
  do {
    const page = await files.listOwnerIds({ kind: 'user', after, limit });
    pages.push(page);
    after = page.next;
  } while (after !== undefined);
  return { pages, ownerIds: pages.flatMap((page) => page.ownerIds) };
}

beforeEach(async () => {
  await clearMediaState();
});

describe('MediaFilesServiceの保有者単位の操作', () => {
  describe('eraseOwnedBy', () => {
    test('保有者の全用途・隔離中を含むファイルを全バケットとデータベースから消し、他の保有者のファイルを残す', async () => {
      await insertFile(1);
      await putObject('images', 1);
      await insertFile(2, { location: 'quarantine' });
      await insertReason(2, 'user_suspended');
      await putObject('quarantine', 2);
      await insertFile(3, filePurposeRow());
      await putObject('files', 3);
      await insertFile(4, { storedAt: null, deletedAt: T0 });
      await insertFile(5, { ownerId: USER_B });
      await putObject('images', 5);
      await insertFile(6, { ownerKind: 'admin', ownerId: USER_A });
      const { service, sent } = createOperations();

      const result = await service.eraseOwnedBy(OWNER);

      expect(result).toEqual({ processed: 4, hasMore: false });
      expect(await readFileIds()).toEqual([fileIdOf(5), fileIdOf(6)]);
      expect(await listObjectKeys('images')).toEqual([objectKeyOf(5)]);
      expect(await listObjectKeys('quarantine')).toEqual([]);
      expect(await listObjectKeys('files')).toEqual([]);
      expect(purgedKeysOf(sent)).toEqual([1, 2, 4].map(objectKeyOf));
    });

    test('上限件数ちょうどなら1回で全件を消し、残りが無いと返す', async () => {
      await insertManyFiles(rangeOf(1, OWNER_OPERATION_BATCH_LIMIT));
      const { service } = createOperations();

      const result = await service.eraseOwnedBy(OWNER);

      expect(result).toEqual({
        processed: OWNER_OPERATION_BATCH_LIMIT,
        hasMore: false,
      });
      expect(await readFileIds()).toEqual([]);
    });

    test('上限件数を1件超えると上限件数だけ消して残りがあると返し、繰り返しで全件が消える', async () => {
      const total = OWNER_OPERATION_BATCH_LIMIT + 1;
      await insertManyFiles(rangeOf(1, total));
      await insertFile(total + 1, { ownerId: USER_B });
      const { service } = createOperations();

      const first = await service.eraseOwnedBy(OWNER);
      const remaining = await readFileIds();
      const second = await service.eraseOwnedBy(OWNER);
      const third = await service.eraseOwnedBy(OWNER);

      expect(first).toEqual({
        processed: OWNER_OPERATION_BATCH_LIMIT,
        hasMore: true,
      });
      expect(remaining).toHaveLength(2);
      expect(second).toEqual({ processed: 1, hasMore: false });
      expect(third).toEqual({ processed: 0, hasMore: false });
      expect(await readFileIds()).toEqual([fileIdOf(total + 1)]);
    });

    test('途中で失敗するとAppError(unavailable)を投げ、同じ呼び出しの再実行で全件が消える', async () => {
      await insertFile(1);
      await putObject('images', 1);
      await insertFile(2, filePurposeRow());
      await putObject('files', 2);
      const { service: failing } = createOperations({
        objects: failingObjectStore({ delete: () => Promise.reject(failure) }),
      });

      await expect(failing.eraseOwnedBy(OWNER)).rejects.toMatchObject({
        kind: 'unavailable',
      });
      const result = await createOperations().service.eraseOwnedBy(OWNER);

      expect(result).toEqual({ processed: 2, hasMore: false });
      expect(await readFileIds()).toEqual([]);
      expect(await listObjectKeys('images')).toEqual([]);
      expect(await listObjectKeys('files')).toEqual([]);
    });
  });

  describe('listOwnerIds', () => {
    test('複数のファイルを持つ保有者を1回だけ昇順に返し、続きが無ければnextを返さない', async () => {
      await insertFile(1, { ownerId: USER_C });
      await insertFile(2, { ownerId: USER_A });
      await insertFile(3, { ownerId: USER_C });
      await insertFile(4, { ownerId: USER_B });
      await insertFile(5, { ownerId: USER_A });
      const { service } = createOperations();

      const list = await service.listOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 10,
      });

      expect(list).toEqual({
        ownerIds: [USER_A, USER_B, USER_C],
        next: undefined,
      });
    });

    test('afterはその値を含まない続きを返し、nextをたどると全保有者が重複も欠けも無くそろう', async () => {
      const owners = rangeOf(1, 7).map(userIdOf);
      await insertManyFiles(rangeOf(1, 14), (index) => ({
        ownerId: userIdOf(((index - 1) % 7) + 1),
      }));
      const { service } = createOperations();

      const { pages, ownerIds } = await listAll(service, 3);
      const fromSecond = await service.listOwnerIds({
        kind: 'user',
        after: userIdOf(2),
        limit: 2,
      });

      expect(pages.map((page) => page.ownerIds.length)).toEqual([3, 3, 1]);
      expect(pages.map((page) => page.next)).toEqual([
        userIdOf(3),
        userIdOf(6),
        undefined,
      ]);
      expect(ownerIds).toEqual(owners);
      expect(fromSecond).toEqual({
        ownerIds: [userIdOf(3), userIdOf(4)],
        next: userIdOf(4),
      });
    });

    test('残りがlimitちょうどならnextを返さない', async () => {
      await insertManyFiles(rangeOf(1, 4), (index) => ({
        ownerId: userIdOf(index),
      }));
      const { service } = createOperations();

      const { pages } = await listAll(service, 2);
      const exact = await service.listOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 4,
      });

      expect(pages.map((page) => page.next)).toEqual([userIdOf(2), undefined]);
      expect(exact.next).toBeUndefined();
      expect(exact.ownerIds).toHaveLength(4);
    });

    test.each([1, OWNER_ID_LIST_MAX_LIMIT])(
      'limitの%iを受け付ける',
      async (limit) => {
        await insertManyFiles(rangeOf(1, 2), (index) => ({
          ownerId: userIdOf(index),
        }));
        const { service } = createOperations();

        const list = await service.listOwnerIds({
          kind: 'user',
          after: undefined,
          limit,
        });

        expect(list.ownerIds).toHaveLength(Math.min(limit, 2));
      },
    );

    test.each([0, OWNER_ID_LIST_MAX_LIMIT + 1, 1.5, Number.NaN, -1])(
      'limitの%sを照会せずに不正な要求として拒否する',
      async (limit) => {
        const queried: unknown[] = [];
        const files = failingFileStore({
          findOwnerIds: (input) => {
            queried.push(input);
            return Promise.resolve([]);
          },
        });
        const { service } = createOperations({ files });

        const error: unknown = await service
          .listOwnerIds({ kind: 'user', after: undefined, limit })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          kind: 'bad_request',
          code: 'invalid_limit',
        });
        expect(queried).toEqual([]);
      },
    );

    test('受付中・論理削除・削除待ち・隔離中・ファイル用の用途のファイルの保有者も返す', async () => {
      await insertFile(1, { ownerId: userIdOf(1), storedAt: null });
      await insertFile(2, { ownerId: userIdOf(2), deletedAt: T0 });
      await insertFile(3, { ownerId: userIdOf(3), eraseRequestedAt: T0 });
      await insertFile(4, { ownerId: userIdOf(4), location: 'quarantine' });
      await insertReason(4, 'user_suspended');
      await insertFile(5, { ...filePurposeRow(), ownerId: userIdOf(5) });
      await insertFile(6, { ownerId: userIdOf(6), attachedAt: T0 });
      const { service } = createOperations();

      const list = await service.listOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 10,
      });

      expect(list.ownerIds).toEqual(rangeOf(1, 6).map(userIdOf));
    });

    test('指定と違う種類の保有者を返さない', async () => {
      await insertFile(1, { ownerId: USER_A });
      await insertFile(2, { ownerKind: 'admin', ownerId: ADMIN_A });
      await insertFile(3, { ownerKind: 'admin', ownerId: USER_B });
      await insertFile(4, { ownerKind: 'system', ownerId: null });
      const { service } = createOperations();

      const users = await service.listOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 10,
      });
      const admins = await service.listOwnerIds({
        kind: 'admin',
        after: undefined,
        limit: 10,
      });

      expect(users.ownerIds).toEqual([USER_A]);
      expect(admins.ownerIds).toEqual([ADMIN_A, USER_B]);
    });

    test('列挙の前後でファイルと隔離理由を変えない', async () => {
      await insertFile(1, { ownerId: USER_A });
      await insertFile(2, { ownerId: USER_B, location: 'quarantine' });
      await insertReason(2, 'auto');
      await putObject('images', 1);
      const { service, sent } = createOperations();
      const before = await readAllRows();

      await listAll(service, 1);

      expect(await readAllRows()).toEqual(before);
      expect(await listObjectKeys('images')).toEqual([objectKeyOf(1)]);
      expect(sent).toEqual([]);
    });

    test('user-profile-socialの日次のジョブが呼ぶ形で型検査を通る', async () => {
      await insertFile(1);
      const files: MediaFiles = createOperations().service;

      const list: OwnerIdList = await files.listOwnerIds({
        kind: 'user',
        after: undefined,
        limit: 90,
      });
      const batch = await files.eraseOwnedBy({ kind: 'user', id: USER_A });

      expect(list).toEqual({ ownerIds: [USER_A], next: undefined });
      expect(batch).toEqual({ processed: 1, hasMore: false });
    });
  });
});
