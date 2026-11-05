import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type { MediaOwner } from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { mediaFileViewOf } from '../../../test/support/media-file-view.ts';
import type { FileReadPolicy } from '../../application/media/file-access-policies.ts';
import { InquiryAttachmentReadPolicy } from './inquiry-attachment-read-policy.ts';
import {
  after,
  db,
  fileIdOf,
  insertAttachments,
  insertInquiryMessage,
  insertMemberInquiry,
  memberInquiryIdOf,
  messageIdOf,
  OPERATOR_ADMIN_ID,
  resetInquiryTables,
} from './testing/inquiry-store-fixtures.ts';

const OWNER_INDEX = 1;

const OTHER_INDEX = 2;

const OWN_INQUIRY_ID = memberInquiryIdOf(1);

const OTHER_INQUIRY_ID = memberInquiryIdOf(2);

const DELETED_INQUIRY_ID = memberInquiryIdOf(3);

const OWN_MESSAGE_ID = messageIdOf(1);

const OTHER_MESSAGE_ID = messageIdOf(2);

const DELETED_MESSAGE_ID = messageIdOf(3);

const UNLINKED_FILE_ID = fileIdOf(1);

const OWN_LINKED_FILE_ID = fileIdOf(2);

const OTHER_LINKED_FILE_ID = fileIdOf(3);

const DELETED_LINKED_FILE_ID = fileIdOf(4);

function principalOf(
  subjectKind: AuthenticatedPrincipal['subjectKind'],
  subjectId: string,
): AuthenticatedPrincipal {
  return Object.freeze({
    kind: 'authenticated',
    subjectKind,
    subjectId,
    sessionId: '01JC0SESSN0000000000000001',
  });
}

const OWNER = principalOf('user', userIdOf(OWNER_INDEX));

const OTHER = principalOf('user', userIdOf(OTHER_INDEX));

const ADMIN = principalOf('admin', OPERATOR_ADMIN_ID);

function userOwner(index: number): MediaOwner {
  return { kind: 'user', id: userIdOf(index) };
}

function fileOf(id: string, owner: MediaOwner) {
  return mediaFileViewOf({ id, owner });
}

function createPolicy(): FileReadPolicy {
  return new InquiryAttachmentReadPolicy(db);
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
  await insertUser(OWNER_INDEX);
  await insertUser(OTHER_INDEX);
  await insertMemberInquiry(
    1,
    { categoryId: INQUIRY_CATEGORY_OTHER_ID },
    OWNER_INDEX,
  );
  await insertMemberInquiry(
    2,
    { categoryId: INQUIRY_CATEGORY_OTHER_ID },
    OTHER_INDEX,
  );
  await insertMemberInquiry(
    3,
    { categoryId: INQUIRY_CATEGORY_OTHER_ID, deletedAt: after(1000) },
    OWNER_INDEX,
  );
  await insertInquiryMessage(1, { inquiryId: OWN_INQUIRY_ID });
  await insertInquiryMessage(2, { inquiryId: OTHER_INQUIRY_ID });
  await insertInquiryMessage(3, { inquiryId: DELETED_INQUIRY_ID });
  await insertAttachments(OWN_MESSAGE_ID, [OWN_LINKED_FILE_ID]);
  await insertAttachments(OTHER_MESSAGE_ID, [OTHER_LINKED_FILE_ID]);
  await insertAttachments(DELETED_MESSAGE_ID, [DELETED_LINKED_FILE_ID]);
});

describe('InquiryAttachmentReadPolicy.canRead(利用者)', () => {
  test('送信前でまだメッセージに紐付いていない自分のファイルは閲覧を許可する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(UNLINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(true);
  });

  test('自分の問い合わせのメッセージに紐付いた自分のファイルは閲覧を許可する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(OWN_LINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(true);
  });

  test('他人の問い合わせに紐付いた他人のファイルは閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(OTHER_LINKED_FILE_ID, userOwner(OTHER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test('紐付いていない他人のファイルは閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OTHER,
      file: fileOf(UNLINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test('論理削除された自分の問い合わせに紐付いたファイルは閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(DELETED_LINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test('保有者が自分でも他人の問い合わせに紐付いたファイルは閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(OTHER_LINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test('自分の問い合わせへの紐付きと他人の問い合わせへの紐付きを併せ持つファイルは閲覧を拒否する', async () => {
    await insertAttachments(OTHER_MESSAGE_ID, [OWN_LINKED_FILE_ID]);

    const allowed = await createPolicy().canRead({
      principal: OWNER,
      file: fileOf(OWN_LINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test.each<[string, MediaOwner]>([
    ['同じ識別子の管理者', { kind: 'admin', id: userIdOf(OWNER_INDEX) }],
    ['動作確認の主体', { kind: 'system' }],
  ])(
    '保有者が利用者でない(%s)ファイルは紐付けが無くても閲覧を拒否する',
    async (_, owner) => {
      const allowed = await createPolicy().canRead({
        principal: OWNER,
        file: fileOf(UNLINKED_FILE_ID, owner),
      });

      expect(allowed).toBe(false);
    },
  );
});

describe('InquiryAttachmentReadPolicy.canRead(管理者)', () => {
  test.each([
    ['ログインの問い合わせ', OWN_LINKED_FILE_ID],
    ['他の利用者の問い合わせ', OTHER_LINKED_FILE_ID],
    ['論理削除された問い合わせ', DELETED_LINKED_FILE_ID],
  ])(
    '%sのメッセージに紐付いたファイルは保有者によらず閲覧を許可する',
    async (_, fileId) => {
      const allowed = await createPolicy().canRead({
        principal: ADMIN,
        file: fileOf(fileId, userOwner(OWNER_INDEX)),
      });

      expect(allowed).toBe(true);
    },
  );

  test('メッセージに紐付いていないファイルは閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: ADMIN,
      file: fileOf(UNLINKED_FILE_ID, userOwner(OWNER_INDEX)),
    });

    expect(allowed).toBe(false);
  });

  test('自分がアップロードした紐付けの無いファイルも閲覧を拒否する', async () => {
    const allowed = await createPolicy().canRead({
      principal: ADMIN,
      file: fileOf(UNLINKED_FILE_ID, { kind: 'admin', id: OPERATOR_ADMIN_ID }),
    });

    expect(allowed).toBe(false);
  });
});
