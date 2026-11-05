import { describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../../../common-lib/inquiry/inquiry-category-constants.ts';
import { insertUser } from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  USER_A,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { filePurposeRow } from '../../../../../lib/workers/media/testing/media-operations-fixtures.ts';
import {
  codesOf,
  fetchInquiryCategories,
  fetchInquiryComposer,
  fetchMemberInquiry,
  fetchMyInquiries,
  insertReplyingAdmin,
  installInquiryGraphQLTest,
  issueUserSession,
  postInquiryMessage,
  replyingAdminIdOf,
} from '../../../../../test/support/inquiry-graphql-operations.ts';
import {
  after,
  categoryIdOf,
  insertAttachments,
  insertCategory,
  insertInquiryMessage,
  insertMemberInquiry,
  memberInquiryIdOf,
  messageIdOf,
  T0,
} from '../../../../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';

const OWNER = 1;

const OTHER = 2;

const REPLYING_ADMIN = 1;

const DELETED_ADMIN = 9;

const MINUTE = 60_000;

installInquiryGraphQLTest();

async function insertOwner(status: 'active' | 'suspended'): Promise<string> {
  await insertUser(OWNER, { status, nickname: '問い合わせる人' });
  return issueUserSession(OWNER);
}

describe('inquiryCategories', () => {
  test('未ログインでも、カテゴリを追加の順に並べ標準カテゴリを末尾に置いて返す', async () => {
    await insertCategory(2, '不具合', after(MINUTE));
    await insertCategory(1, '料金', T0);

    const response = await fetchInquiryCategories();

    expect(response.errors).toBeUndefined();
    expect(response.data?.inquiryCategories).toEqual([
      { id: categoryIdOf(1), name: '料金', systemDefault: false },
      { id: categoryIdOf(2), name: '不具合', systemDefault: false },
      { id: INQUIRY_CATEGORY_OTHER_ID, name: 'その他', systemDefault: true },
    ]);
  });
});

describe('inquiryComposer', () => {
  test('停止していないログイン中の利用者には、ニックネームと空のプロフィール画像を返す', async () => {
    const sessionToken = await insertOwner('active');

    const response = await fetchInquiryComposer({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.inquiryComposer).toEqual({
      nickname: '問い合わせる人',
      avatar: null,
    });
  });

  test('停止中の利用者には空を返す', async () => {
    const sessionToken = await insertOwner('suspended');

    const response = await fetchInquiryComposer({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.inquiryComposer).toBeNull();
  });

  test('未ログインには空を返す', async () => {
    const response = await fetchInquiryComposer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.inquiryComposer).toBeNull();
  });
});

describe('memberInquiry', () => {
  test('本人の問い合わせを、送信日時の古い順のメッセージ・添付・返信した管理者とともに返す', async () => {
    const sessionToken = await insertOwner('active');
    await insertReplyingAdmin(REPLYING_ADMIN, '運営の担当');
    await insertFile(1, { ...filePurposeRow(), ownerId: USER_A });
    await insertMemberInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      status: 'in_progress',
      lastMessageAt: after(2 * MINUTE),
    });
    const inquiryId = memberInquiryIdOf(1);
    await insertInquiryMessage(2, {
      inquiryId,
      senderKind: 'admin',
      adminId: replyingAdminIdOf(REPLYING_ADMIN),
      body: '確認します。',
      createdAt: after(MINUTE),
    });
    await insertInquiryMessage(1, { inquiryId, body: '最初の質問' });
    await insertAttachments(messageIdOf(1), [fileIdOf(1)]);

    const response = await fetchMemberInquiry(inquiryId, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.memberInquiry).toEqual({
      id: inquiryId,
      category: {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
      },
      status: 'IN_PROGRESS',
      createdAt: T0.toISOString(),
      lastMessageAt: after(2 * MINUTE).toISOString(),
      canPost: true,
      messages: [
        {
          id: messageIdOf(1),
          sender: 'USER',
          body: '最初の質問',
          attachments: [
            {
              id: fileIdOf(1),
              originalFileName: 'report.pdf',
              contentType: 'application/pdf',
              byteSize: 1024,
              downloadPath: `/_bff/files/${fileIdOf(1)}`,
            },
          ],
          admin: null,
          createdAt: T0.toISOString(),
        },
        {
          id: messageIdOf(2),
          sender: 'ADMIN',
          body: '確認します。',
          attachments: [],
          admin: { nickname: '運営の担当', avatar: null, deleted: false },
          createdAt: after(MINUTE).toISOString(),
        },
      ],
    });
  });

  test('削除済みの管理者の返信は、管理者の情報を空にして削除済みとして返す', async () => {
    const sessionToken = await insertOwner('active');
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
    await insertInquiryMessage(1, {
      inquiryId: memberInquiryIdOf(1),
      senderKind: 'admin',
      adminId: replyingAdminIdOf(DELETED_ADMIN),
      body: '回答です。',
    });

    const response = await fetchMemberInquiry(memberInquiryIdOf(1), {
      sessionToken,
    });

    expect(response.data?.memberInquiry?.messages[0]?.admin).toEqual({
      nickname: null,
      avatar: null,
      deleted: true,
    });
  });

  test('停止中の本人には、送信できないことを示して問い合わせを返す', async () => {
    const sessionToken = await insertOwner('suspended');
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await fetchMemberInquiry(memberInquiryIdOf(1), {
      sessionToken,
    });

    expect(response.data?.memberInquiry?.canPost).toBe(false);
  });

  test.each([
    ['他人の問い合わせ', OTHER, null],
    ['論理削除した問い合わせ', OWNER, T0],
  ])('%sは空で返す', async (_name, userIndex, deletedAt) => {
    const sessionToken = await insertOwner('active');
    await insertUser(OTHER);
    await insertMemberInquiry(
      1,
      { categoryId: INQUIRY_CATEGORY_OTHER_ID, deletedAt },
      userIndex,
    );

    const response = await fetchMemberInquiry(memberInquiryIdOf(1), {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.memberInquiry).toBeNull();
  });

  test('存在しない問い合わせは空で返す', async () => {
    const sessionToken = await insertOwner('active');

    const response = await fetchMemberInquiry(memberInquiryIdOf(99), {
      sessionToken,
    });

    expect(response.data?.memberInquiry).toBeNull();
  });

  test('未ログインはログインが必要として拒否する', async () => {
    const response = await fetchMemberInquiry(memberInquiryIdOf(1));

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('myInquiries', () => {
  test('停止中の本人にも、自分の問い合わせだけを20件ずつ新しい順に返す', async () => {
    const sessionToken = await insertOwner('suspended');
    await insertUser(OTHER);
    for (let index = 1; index <= 21; index += 1) {
      await insertMemberInquiry(index, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        createdAt: after(index * MINUTE),
      });
    }
    await insertMemberInquiry(
      22,
      { categoryId: INQUIRY_CATEGORY_OTHER_ID, createdAt: after(99 * MINUTE) },
      OTHER,
    );

    const first = await fetchMyInquiries(null, { sessionToken });
    const second = await fetchMyInquiries(
      first.data?.myInquiries?.nextCursor ?? null,
      { sessionToken },
    );

    expect(first.errors).toBeUndefined();
    const items = first.data?.myInquiries?.items ?? [];
    expect(items).toHaveLength(20);
    expect(items[0]).toEqual({
      id: memberInquiryIdOf(21),
      category: {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
      },
      status: 'OPEN',
      createdAt: after(21 * MINUTE).toISOString(),
      lastMessageAt: T0.toISOString(),
    });
    expect(second.data?.myInquiries).toEqual({
      items: [expect.objectContaining({ id: memberInquiryIdOf(1) })],
      nextCursor: null,
    });
  });

  test('不正なカーソルはページの位置の指定のエラーで拒否する', async () => {
    const sessionToken = await insertOwner('active');

    const response = await fetchMyInquiries('not-a-cursor', { sessionToken });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('postInquiryMessage', () => {
  test('添付付きの追加メッセージは、添付を位置の順に返す', async () => {
    const sessionToken = await insertOwner('active');
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
    await insertFile(1, { ...filePurposeRow(), originalFileName: 'a.pdf' });
    await insertFile(2, { ...filePurposeRow(), originalFileName: 'b.pdf' });

    const response = await postInquiryMessage(
      memberInquiryIdOf(1),
      { body: '資料を添付します。', fileIds: [fileIdOf(2), fileIdOf(1)] },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.postInquiryMessage?.attachments.map(
        (attachment) => attachment.originalFileName,
      ),
    ).toEqual(['b.pdf', 'a.pdf']);
  });
});
