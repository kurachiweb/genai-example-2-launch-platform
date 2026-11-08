import { describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../../../common-lib/inquiry/inquiry-category-constants.ts';
import { userProfiles } from '../../../../../db/schema/profile/user-profiles.ts';
import {
  db,
  insertUser,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  fileIdOf,
  insertFile,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  ADMIN_INQUIRIES,
  ADMIN_INQUIRY,
  ADMIN_INQUIRY_CATEGORIES,
  ADMIN_UNHANDLED_INQUIRY_COUNT,
  CHANGE_INQUIRY_STATUS,
  codesOf,
  CREATE_INQUIRY_CATEGORY,
  DELETE_INQUIRY_CATEGORY,
  detailsOf,
  fetchAdminInquiries,
  fetchAdminInquiry,
  fetchAdminInquiryCategories,
  fetchAdminUnhandledInquiryCount,
  INQUIRY_ADMINS,
  inquiryAdminGateway,
  inquiryAdminIdOf,
  inquiryAdminSessionOf,
  installInquiryAdminGraphQLTest,
  issueUserSession,
  RENAME_INQUIRY_CATEGORY,
  REPLY_TO_INQUIRY,
} from '../../../../../test/support/inquiry-graphql-operations.ts';
import {
  after,
  categoryIdOf,
  guestInquiryIdOf,
  insertCategory,
  insertGuestInquiry,
  insertInquiryMessage,
  insertMemberInquiry,
  memberInquiryIdOf,
  messageIdOf,
  readAuditLogs,
  readCategoryRows,
  readMemberInquiryRows,
  readMessageRows,
  T0,
} from '../../../../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';

installInquiryAdminGraphQLTest();

const { moderator, viewer } = INQUIRY_ADMINS;

const MINUTE = 60_000;

const INQUIRER = 1;

async function insertMemberInquiryWithReply(): Promise<string> {
  await insertUser(INQUIRER, { nickname: '問い合わせる人', handle: 'asker' });
  await insertMemberInquiry(1, {
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    status: 'in_progress',
    lastMessageAt: after(MINUTE),
  });
  const inquiryId = memberInquiryIdOf(1);
  await insertInquiryMessage(2, {
    inquiryId,
    senderKind: 'admin',
    adminId: inquiryAdminIdOf(moderator),
    body: '確認します。',
    createdAt: after(MINUTE),
  });
  await insertInquiryMessage(1, { inquiryId, body: '最初の質問' });
  return inquiryId;
}

const OPERATIONS = [
  { name: 'adminInquiries', document: ADMIN_INQUIRIES, variables: {} },
  {
    name: 'adminInquiry',
    document: ADMIN_INQUIRY,
    variables: { id: memberInquiryIdOf(1) },
  },
  {
    name: 'adminUnhandledInquiryCount',
    document: ADMIN_UNHANDLED_INQUIRY_COUNT,
    variables: {},
  },
  {
    name: 'adminInquiryCategories',
    document: ADMIN_INQUIRY_CATEGORIES,
    variables: {},
  },
  {
    name: 'replyToInquiry',
    document: REPLY_TO_INQUIRY,
    variables: { inquiryId: memberInquiryIdOf(1), body: '返信です。' },
  },
  {
    name: 'changeInquiryStatus',
    document: CHANGE_INQUIRY_STATUS,
    variables: { inquiryId: memberInquiryIdOf(1), status: 'RESOLVED' },
  },
  {
    name: 'createInquiryCategory',
    document: CREATE_INQUIRY_CATEGORY,
    variables: { name: '料金' },
  },
  {
    name: 'renameInquiryCategory',
    document: RENAME_INQUIRY_CATEGORY,
    variables: { id: categoryIdOf(1), name: '請求' },
  },
  {
    name: 'deleteInquiryCategory',
    document: DELETE_INQUIRY_CATEGORY,
    variables: { id: categoryIdOf(1) },
  },
] as const;

const MUTATIONS = OPERATIONS.slice(4);

describe('管理者側の操作の呼び出し元とログイン', () => {
  test.each(OPERATIONS)(
    '$nameは、モデレーターのセッションでも利用者側の呼び出し元からならforbiddenで拒否し、何も変えない',
    async ({ document, variables }) => {
      await insertMemberInquiryWithReply();
      await insertCategory(1, '料金');

      const response = await inquiryAdminGateway.call(document, variables, {
        caller: 'client',
        sessionToken: inquiryAdminSessionOf(moderator),
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.errors?.[0]?.message).toBe('この操作はできません。');
      expect(await readMessageRows()).toHaveLength(2);
      expect(await readCategoryRows()).toHaveLength(2);
      expect(await readAuditLogs()).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    '$nameは、利用者のセッションと未ログインをunauthenticatedで拒否する',
    async ({ document, variables }) => {
      await insertMemberInquiryWithReply();
      const userSession = await issueUserSession(INQUIRER);

      const asUser = await inquiryAdminGateway.call(document, variables, {
        sessionToken: userSession,
      });
      const anonymous = await inquiryAdminGateway.call(document, variables);

      expect(codesOf(asUser)).toEqual(['unauthenticated']);
      expect(codesOf(anonymous)).toEqual(['unauthenticated']);
    },
  );
});

describe('閲覧のみの管理者の認可', () => {
  test.each(MUTATIONS)(
    '$nameは、閲覧のみの管理者をforbiddenで拒否し、何も変えない',
    async ({ document, variables }) => {
      await insertMemberInquiryWithReply();
      await insertCategory(1, '料金');

      const response = await inquiryAdminGateway.call(document, variables, {
        sessionToken: inquiryAdminSessionOf(viewer),
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await readMessageRows()).toHaveLength(2);
      expect(await readMemberInquiryRows()).toEqual([
        expect.objectContaining({ status: 'in_progress' }),
      ]);
      expect(await readCategoryRows()).toEqual([
        expect.objectContaining({ id: INQUIRY_CATEGORY_OTHER_ID }),
        expect.objectContaining({ name: '料金' }),
      ]);
      expect(await readAuditLogs()).toEqual([]);
    },
  );

  test('閲覧のみの管理者は、一覧・詳細・未対応の件数・紐付く件数付きのカテゴリを読める', async () => {
    const inquiryId = await insertMemberInquiryWithReply();

    const responses = await Promise.all([
      fetchAdminInquiries(viewer),
      fetchAdminInquiry(viewer, inquiryId),
      fetchAdminUnhandledInquiryCount(viewer),
      fetchAdminInquiryCategories(viewer),
    ]);

    expect(responses.map((response) => response.errors)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('adminInquiries', () => {
  test('ログインと未ログインの問い合わせを受付日時の新しい順に1つの一覧で返す', async () => {
    await insertMemberInquiryWithReply();
    await insertGuestInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      nickname: 'ゲスト',
      createdAt: after(3 * MINUTE),
    });

    const response = await fetchAdminInquiries(viewer);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiries).toEqual({
      entries: [
        {
          id: guestInquiryIdOf(1),
          kind: 'GUEST',
          category: {
            id: INQUIRY_CATEGORY_OTHER_ID,
            name: 'その他',
            systemDefault: true,
          },
          status: 'OPEN',
          senderName: 'ゲスト',
          withdrawn: false,
          createdAt: after(3 * MINUTE).toISOString(),
          lastMessageAt: after(3 * MINUTE).toISOString(),
        },
        {
          id: memberInquiryIdOf(1),
          kind: 'MEMBER',
          category: {
            id: INQUIRY_CATEGORY_OTHER_ID,
            name: 'その他',
            systemDefault: true,
          },
          status: 'IN_PROGRESS',
          senderName: '問い合わせる人',
          withdrawn: false,
          createdAt: T0.toISOString(),
          lastMessageAt: after(MINUTE).toISOString(),
        },
      ],
      nextCursor: null,
    });
  });

  test('対応ステータス・種別・カテゴリ・受付日時の期間の条件をすべて満たす問い合わせだけを返す', async () => {
    await insertCategory(1, '料金');
    await insertGuestInquiry(1, {
      categoryId: categoryIdOf(1),
      createdAt: after(MINUTE),
    });
    await insertGuestInquiry(2, {
      categoryId: categoryIdOf(1),
      createdAt: after(2 * MINUTE),
    });
    await insertGuestInquiry(3, {
      categoryId: categoryIdOf(1),
      status: 'resolved',
      createdAt: after(MINUTE),
    });
    await insertGuestInquiry(4, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      createdAt: after(MINUTE),
    });
    await insertUser(INQUIRER);
    await insertMemberInquiry(1, {
      categoryId: categoryIdOf(1),
      createdAt: after(MINUTE),
    });

    const response = await fetchAdminInquiries(viewer, {
      filter: {
        status: 'OPEN',
        kind: 'GUEST',
        categoryId: categoryIdOf(1),
        receivedFrom: after(MINUTE).toISOString(),
        receivedBefore: after(2 * MINUTE).toISOString(),
      },
    });

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.adminInquiries?.entries.map((entry) => entry.id),
    ).toEqual([guestInquiryIdOf(1)]);
  });

  test('長すぎるカーソルを検証のエラーで拒否する', async () => {
    const response = await fetchAdminInquiries(viewer, {
      after: 'a'.repeat(257),
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'after' }),
    ]);
  });
});

describe('adminInquiry', () => {
  test('ログインの問い合わせを、送った利用者・送信日時の古い順のメッセージ・返信した管理者とともに返す', async () => {
    const inquiryId = await insertMemberInquiryWithReply();

    const response = await fetchAdminInquiry(viewer, inquiryId);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry).toEqual({
      id: inquiryId,
      kind: 'MEMBER',
      category: {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
      },
      status: 'IN_PROGRESS',
      statusChangedAt: T0.toISOString(),
      withdrawn: false,
      createdAt: T0.toISOString(),
      lastMessageAt: after(MINUTE).toISOString(),
      member: {
        userId: userIdOf(INQUIRER),
        nickname: '問い合わせる人',
        handle: 'asker',
        avatar: null,
      },
      guest: null,
      messages: [
        {
          id: messageIdOf(1),
          sender: 'USER',
          body: '最初の質問',
          attachments: [],
          admin: null,
          createdAt: T0.toISOString(),
        },
        {
          id: messageIdOf(2),
          sender: 'ADMIN',
          body: '確認します。',
          attachments: [],
          admin: {
            nickname: `運営${String(moderator)}`,
            avatar: null,
            deleted: false,
          },
          createdAt: after(MINUTE).toISOString(),
        },
      ],
    });
  });

  test('未ログインの問い合わせを、連絡先と受付時の本文の1件のメッセージとともに返す', async () => {
    await insertGuestInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      nickname: 'ゲスト',
      email: 'guest@mail.example',
      body: 'ログインできません。',
      status: 'resolved',
      statusChangedAt: after(MINUTE),
    });

    const response = await fetchAdminInquiry(viewer, guestInquiryIdOf(1));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry).toEqual({
      id: guestInquiryIdOf(1),
      kind: 'GUEST',
      category: {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
      },
      status: 'RESOLVED',
      statusChangedAt: after(MINUTE).toISOString(),
      withdrawn: false,
      createdAt: T0.toISOString(),
      lastMessageAt: T0.toISOString(),
      member: null,
      guest: {
        nickname: 'ゲスト',
        email: 'guest@mail.example',
        body: 'ログインできません。',
      },
      messages: [
        {
          id: guestInquiryIdOf(1),
          sender: 'USER',
          body: 'ログインできません。',
          attachments: [],
          admin: null,
          createdAt: T0.toISOString(),
        },
      ],
    });
  });

  test('退会済みの問い合わせを退会済みとして返す', async () => {
    await insertUser(INQUIRER);
    await insertMemberInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      deletedAt: after(MINUTE),
    });

    const response = await fetchAdminInquiry(viewer, memberInquiryIdOf(1));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry?.withdrawn).toBe(true);
  });

  test('退会済み(物理削除前)の利用者が送った問い合わせの詳細でも、送った利用者のニックネームとハンドルを返す', async () => {
    await insertUser(INQUIRER, {
      nickname: '退会した人',
      handle: 'withdrawn-asker',
      deletedAt: after(MINUTE),
    });
    await insertMemberInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      deletedAt: after(MINUTE),
    });

    const response = await fetchAdminInquiry(viewer, memberInquiryIdOf(1));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry?.withdrawn).toBe(true);
    expect(response.data?.adminInquiry?.member).toEqual({
      userId: userIdOf(INQUIRER),
      nickname: '退会した人',
      handle: 'withdrawn-asker',
      avatar: null,
    });
  });

  test('プロフィール画像のある利用者の詳細では、送った利用者の画像を返す', async () => {
    await insertUser(INQUIRER, { nickname: '画像のある人', handle: 'asker' });
    await insertFile(1, {
      purpose: 'user-avatar',
      ownerId: userIdOf(INQUIRER),
      moderationStatus: 'passed',
    });
    await db.insert(userProfiles).values({
      id: '01JC0PROF000000000000000001',
      userId: userIdOf(INQUIRER),
      avatarFileId: fileIdOf(1),
      createdAt: T0,
      updatedAt: T0,
    });
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await fetchAdminInquiry(viewer, memberInquiryIdOf(1));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry?.member).toEqual({
      userId: userIdOf(INQUIRER),
      nickname: '画像のある人',
      handle: 'asker',
      avatar: { id: fileIdOf(1) },
    });
  });

  test('存在しない問い合わせには空を返す', async () => {
    const response = await fetchAdminInquiry(viewer, memberInquiryIdOf(99));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiry).toBeNull();
  });
});

describe('adminUnhandledInquiryCount', () => {
  test('未対応のログインと未ログインの問い合わせの合計を、退会済みを除いて返す', async () => {
    await insertUser(INQUIRER);
    await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
    await insertMemberInquiry(2, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      deletedAt: after(MINUTE),
    });
    await insertMemberInquiry(3, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      status: 'in_progress',
    });
    await insertGuestInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
    await insertGuestInquiry(2, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      status: 'rejected',
    });

    const response = await fetchAdminUnhandledInquiryCount(viewer);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminUnhandledInquiryCount).toBe(2);
  });
});

describe('adminInquiryCategories', () => {
  test('カテゴリを追加の順に標準カテゴリを末尾にして、紐付くログイン・未ログインの問い合わせの件数とともに返す', async () => {
    await insertCategory(2, '不具合', after(MINUTE));
    await insertCategory(1, '料金', T0);
    await insertUser(INQUIRER);
    await insertMemberInquiry(1, { categoryId: categoryIdOf(1) });
    await insertGuestInquiry(1, { categoryId: categoryIdOf(1) });
    await insertGuestInquiry(2, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await fetchAdminInquiryCategories(viewer);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminInquiryCategories).toEqual([
      {
        id: categoryIdOf(1),
        name: '料金',
        systemDefault: false,
        linkedCount: 2,
      },
      {
        id: categoryIdOf(2),
        name: '不具合',
        systemDefault: false,
        linkedCount: 0,
      },
      {
        id: INQUIRY_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
        linkedCount: 1,
      },
    ]);
  });
});
