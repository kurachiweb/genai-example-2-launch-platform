import { describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../../../common-lib/inquiry/inquiry-category-constants.ts';
import {
  emailOf,
  insertUser,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  changeInquiryStatus,
  codesOf,
  createInquiryCategory,
  deleteInquiryCategory,
  detailsOf,
  INQUIRY_ADMINS,
  inquiryAdminIdOf,
  installInquiryAdminGraphQLTest,
  renameInquiryCategory,
  replyNotificationOutbox,
  replyToInquiry,
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
  readGuestInquiryCategoryIds,
  readGuestInquiryRows,
  readMemberInquiryRows,
  readMessageRows,
  T0,
} from '../../../../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';

installInquiryAdminGraphQLTest();

const { superAdmin, moderator } = INQUIRY_ADMINS;

const MINUTE = 60_000;

const INQUIRER = 1;

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const TOO_LONG_REASON = 'あ'.repeat(501);

async function insertOpenMemberInquiry(
  columns: { readonly deletedAt?: Date } = {},
): Promise<string> {
  await insertUser(INQUIRER, { nickname: '問い合わせる人', handle: 'asker' });
  await insertMemberInquiry(1, {
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    ...columns,
  });
  const inquiryId = memberInquiryIdOf(1);
  await insertInquiryMessage(1, { inquiryId, body: '最初の質問' });
  return inquiryId;
}

describe('replyToInquiry', () => {
  test('モデレーターの返信を返信した管理者とともに保存して返し、通知メールを送り、ステータスを変えない', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await replyToInquiry(moderator, {
      inquiryId,
      body: '確認します。',
      reason: '一次回答',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.replyToInquiry).toEqual({
      message: {
        id: expect.any(String) as string,
        sender: 'ADMIN',
        body: '確認します。',
        attachments: [],
        admin: {
          nickname: `運営${String(moderator)}`,
          avatar: null,
          deleted: false,
        },
        createdAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
      },
      notificationQueued: true,
    });
    expect(replyNotificationOutbox.sent).toEqual([
      expect.objectContaining({
        to: emailOf(INQUIRER),
        nickname: '問い合わせる人',
        inquiryId,
      }),
    ]);
    expect(await readMessageRows()).toEqual([
      expect.objectContaining({ id: messageIdOf(1), senderKind: 'user' }),
      expect.objectContaining({
        id: response.data?.replyToInquiry?.message.id,
        senderKind: 'admin',
        adminId: inquiryAdminIdOf(moderator),
        body: '確認します。',
      }),
    ]);
    expect(await readMemberInquiryRows()).toEqual([
      expect.objectContaining({ status: 'open' }),
    ]);
    expect(await readAuditLogs()).toEqual([
      expect.objectContaining({
        operatorAdminId: inquiryAdminIdOf(moderator),
        action: 'inquiry.reply',
        targetIds: [inquiryId],
      }),
    ]);
  });

  test('通知メールの送信要求に失敗しても返信を保存し、通知できなかったことを返す', async () => {
    const inquiryId = await insertOpenMemberInquiry();
    replyNotificationOutbox.failing = true;

    const response = await replyToInquiry(moderator, {
      inquiryId,
      body: '確認します。',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.replyToInquiry?.notificationQueued).toBe(false);
    expect(await readMessageRows()).toHaveLength(2);
  });

  test('未ログインの問い合わせへの返信をinquiry_not_repliableで拒否する', async () => {
    await insertGuestInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });

    const response = await replyToInquiry(moderator, {
      inquiryId: guestInquiryIdOf(1),
      body: '確認します。',
    });

    expect(codesOf(response)).toEqual(['inquiry_not_repliable']);
    expect(await readAuditLogs()).toEqual([]);
  });

  test('退会済みの問い合わせへの返信をinquiry_read_onlyで拒否する', async () => {
    const inquiryId = await insertOpenMemberInquiry({
      deletedAt: after(MINUTE),
    });

    const response = await replyToInquiry(moderator, {
      inquiryId,
      body: '確認します。',
    });

    expect(codesOf(response)).toEqual(['inquiry_read_only']);
    expect(await readMessageRows()).toHaveLength(1);
    expect(replyNotificationOutbox.sent).toEqual([]);
  });

  test('存在しない問い合わせへの返信をinquiry_not_foundで拒否する', async () => {
    const response = await replyToInquiry(moderator, {
      inquiryId: memberInquiryIdOf(99),
      body: '確認します。',
    });

    expect(codesOf(response)).toEqual(['inquiry_not_found']);
  });

  test('空の返信を本文の欄の検証のエラーで拒否する', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await replyToInquiry(moderator, {
      inquiryId,
      body: ' \n ',
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'body',
        code: 'empty',
        message: 'メッセージを入力してください。',
      },
    ]);
    expect(await readMessageRows()).toHaveLength(1);
  });

  test('501文字の理由を理由の欄の検証のエラーで拒否し、保存しない', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await replyToInquiry(moderator, {
      inquiryId,
      body: '確認します。',
      reason: TOO_LONG_REASON,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reason',
        message: '理由は500文字以内で入力してください。',
      }),
    ]);
    expect(await readMessageRows()).toHaveLength(1);
  });
});

describe('changeInquiryStatus', () => {
  test('ログインの問い合わせのステータスを変えて変更日時を記録し、メッセージと送った利用者を含む詳細を返す', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await changeInquiryStatus(moderator, {
      inquiryId,
      status: 'RESOLVED',
      reason: '解決済み',
    });

    expect(response.errors).toBeUndefined();
    const changed = response.data?.changeInquiryStatus;
    expect(changed).toEqual(
      expect.objectContaining({
        id: inquiryId,
        kind: 'MEMBER',
        status: 'RESOLVED',
        member: {
          userId: userIdOf(INQUIRER),
          nickname: '問い合わせる人',
          handle: 'asker',
          avatar: null,
        },
        guest: null,
        messages: [expect.objectContaining({ body: '最初の質問' })],
      }),
    );
    expect(changed?.statusChangedAt).not.toBe(T0.toISOString());
    expect(await readMemberInquiryRows()).toEqual([
      expect.objectContaining({
        status: 'resolved',
        statusChangedAt: new Date(changed?.statusChangedAt ?? 0),
      }),
    ]);
    expect(await readAuditLogs()).toEqual([
      expect.objectContaining({
        action: 'inquiry.status-change',
        targetIds: [inquiryId],
        detail: { kind: 'member', fromStatus: 'open', toStatus: 'resolved' },
      }),
    ]);
  });

  test('未ログインの問い合わせのステータスを変え、連絡先を含む詳細を返す', async () => {
    await insertGuestInquiry(1, {
      categoryId: INQUIRY_CATEGORY_OTHER_ID,
      nickname: 'ゲスト',
    });

    const response = await changeInquiryStatus(moderator, {
      inquiryId: guestInquiryIdOf(1),
      status: 'REJECTED',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.changeInquiryStatus).toEqual(
      expect.objectContaining({
        kind: 'GUEST',
        status: 'REJECTED',
        guest: expect.objectContaining({ nickname: 'ゲスト' }) as object,
      }),
    );
    expect(await readGuestInquiryRows()).toEqual([
      expect.objectContaining({ status: 'rejected' }),
    ]);
  });

  test('現在と同じステータスへの変更をステータスの欄の検証のエラーで拒否する', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await changeInquiryStatus(moderator, {
      inquiryId,
      status: 'OPEN',
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'status', code: 'unchanged' }),
    ]);
    expect(await readAuditLogs()).toEqual([]);
  });

  test('退会済みの問い合わせのステータスの変更をinquiry_read_onlyで拒否する', async () => {
    const inquiryId = await insertOpenMemberInquiry({
      deletedAt: after(MINUTE),
    });

    const response = await changeInquiryStatus(moderator, {
      inquiryId,
      status: 'RESOLVED',
    });

    expect(codesOf(response)).toEqual(['inquiry_read_only']);
    expect(await readMemberInquiryRows()).toEqual([
      expect.objectContaining({ status: 'open' }),
    ]);
  });

  test('501文字の理由を理由の欄の検証のエラーで拒否し、変えない', async () => {
    const inquiryId = await insertOpenMemberInquiry();

    const response = await changeInquiryStatus(moderator, {
      inquiryId,
      status: 'RESOLVED',
      reason: TOO_LONG_REASON,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'reason' }),
    ]);
    expect(await readMemberInquiryRows()).toEqual([
      expect.objectContaining({ status: 'open' }),
    ]);
  });
});

describe('カテゴリの追加・名前の変更・削除', () => {
  test('最上位管理者とモデレーターは、前後の空白を除いた名前でカテゴリを追加できる', async () => {
    const bySuperAdmin = await createInquiryCategory(superAdmin, {
      name: ' 料金 ',
    });
    const byModerator = await createInquiryCategory(moderator, {
      name: '不具合',
    });

    expect(bySuperAdmin.errors).toBeUndefined();
    expect(bySuperAdmin.data?.createInquiryCategory).toEqual({
      id: expect.any(String) as string,
      name: '料金',
      systemDefault: false,
    });
    expect(byModerator.errors).toBeUndefined();
    expect(await readCategoryRows()).toHaveLength(3);
    expect((await readAuditLogs()).map(({ action }) => action).sort()).toEqual([
      'inquiry-category.create',
      'inquiry-category.create',
    ]);
  });

  test('大文字小文字だけが異なる名前の追加を、名前の欄の詳細を付けたinquiry_category_name_takenで拒否する', async () => {
    await insertCategory(1, 'Billing');

    const response = await createInquiryCategory(moderator, {
      name: 'billing',
    });

    expect(codesOf(response)).toEqual(['inquiry_category_name_taken']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'name', code: 'name-taken' }),
    ]);
  });

  test('空の名前を名前の欄の検証のエラーで拒否する', async () => {
    const response = await createInquiryCategory(moderator, { name: '  ' });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'name', code: 'empty' }),
    ]);
    expect(await readCategoryRows()).toHaveLength(1);
  });

  test('カテゴリの名前を変更して返す', async () => {
    await insertCategory(1, '料金');

    const response = await renameInquiryCategory(moderator, {
      id: categoryIdOf(1),
      name: '請求',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.renameInquiryCategory).toEqual({
      id: categoryIdOf(1),
      name: '請求',
      systemDefault: false,
    });
  });

  test('標準カテゴリの名前の変更と削除をinquiry_category_protectedで拒否する', async () => {
    const rename = await renameInquiryCategory(moderator, {
      id: INQUIRY_CATEGORY_OTHER_ID,
      name: '雑談',
    });
    const deletion = await deleteInquiryCategory(moderator, {
      id: INQUIRY_CATEGORY_OTHER_ID,
    });

    expect(codesOf(rename)).toEqual(['inquiry_category_protected']);
    expect(codesOf(deletion)).toEqual(['inquiry_category_protected']);
    expect(await readCategoryRows()).toEqual([
      expect.objectContaining({ name: 'その他' }),
    ]);
  });

  test('存在しないカテゴリの名前の変更と削除をinquiry_category_not_foundで拒否する', async () => {
    const rename = await renameInquiryCategory(moderator, {
      id: categoryIdOf(99),
      name: '請求',
    });
    const deletion = await deleteInquiryCategory(moderator, {
      id: categoryIdOf(99),
    });

    expect(codesOf(rename)).toEqual(['inquiry_category_not_found']);
    expect(codesOf(deletion)).toEqual(['inquiry_category_not_found']);
  });

  test('カテゴリを削除し、紐付く問い合わせを標準カテゴリへ付け替える', async () => {
    await insertCategory(1, '料金');
    await insertGuestInquiry(1, { categoryId: categoryIdOf(1) });

    const response = await deleteInquiryCategory(moderator, {
      id: categoryIdOf(1),
      reason: '統合',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteInquiryCategory).toBe(true);
    expect(await readGuestInquiryCategoryIds()).toEqual([
      { id: guestInquiryIdOf(1), categoryId: INQUIRY_CATEGORY_OTHER_ID },
    ]);
    expect(await readAuditLogs()).toEqual([
      expect.objectContaining({
        action: 'inquiry-category.delete',
        targetIds: [categoryIdOf(1)],
        detail: { reassignedCount: '1' },
      }),
    ]);
  });

  test('501文字の理由を理由の欄の検証のエラーで拒否し、追加しない', async () => {
    const response = await createInquiryCategory(moderator, {
      name: '料金',
      reason: TOO_LONG_REASON,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'reason' }),
    ]);
    expect(await readCategoryRows()).toHaveLength(1);
  });
});
