import { describe, expect, test } from 'vitest';

import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../../../../common-lib/admin/audit-actions/notifications.ts';
import { SENDER_INFO_MAX_GRAPHEMES } from '../../../../../common-lib/notifications/sender-info-input-rules.ts';
import type { SenderInfo } from '../../../../../lib/core/email/ports.ts';
import { SENDER_INFO_SEED_ROW } from '../../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import type {
  GatewayCallOptions,
  GatewayResponse,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  asSenderInfoAdmin,
  codesOf,
  detailsOf,
  fetchNotificationSenderInfo,
  installNotificationsGraphQLTest,
  installSenderInfoAdminFixtures,
  markSenderInfoUpdatedBy,
  readSenderInfoRow,
  SENDER_INFO_ADMINS,
  updateNotificationSenderInfo,
} from '../../../../../test/support/notifications-graphql-operations.ts';
import { NOTIFICATIONS_ERRORS } from '../../../../application/notifications/notifications-errors.ts';
import {
  adminIdOf,
  insertInvitedAdmin,
  readAuditLogSummaries,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const INFO: SenderInfo = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
};

const UNSET_STATE = {
  info: null,
  version: 0,
  updatedAt: null,
  updatedByNickname: null,
};

const { superAdmin, moderator, viewer, secondSuperAdmin, invited, deleted } =
  SENDER_INFO_ADMINS;

installNotificationsGraphQLTest();

installSenderInfoAdminFixtures();

const nicknameOf = (adminIndex: number): string =>
  `管理者${String(adminIndex)}`;

const OPERATIONS: readonly {
  readonly name: string;
  readonly call: (options: GatewayCallOptions) => Promise<GatewayResponse>;
}[] = [
  {
    name: 'notificationSenderInfo',
    call: (options) => fetchNotificationSenderInfo(options),
  },
  {
    name: 'updateNotificationSenderInfo',
    call: (options) =>
      updateNotificationSenderInfo({ ...INFO, expectedVersion: 0 }, options),
  },
];

async function expectNothingWritten(): Promise<void> {
  await expect(readSenderInfoRow()).resolves.toEqual(SENDER_INFO_SEED_ROW);
  await expect(readAuditLogSummaries()).resolves.toEqual([]);
}

describe('呼び出し元とログイン', () => {
  test.each(OPERATIONS)(
    '$nameは、最上位管理者のセッションでも利用者側の呼び出し元からならforbiddenで拒否し、送信者情報を変えない',
    async ({ name, call }) => {
      const response = await call({
        ...asSenderInfoAdmin(superAdmin),
        caller: 'client',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.[name] ?? null).toBeNull();
      await expectNothingWritten();
    },
  );

  test.each(OPERATIONS)(
    '$nameは、管理者側の呼び出し元でも未ログインならunauthenticatedで拒否し、送信者情報を変えない',
    async ({ name, call }) => {
      const response = await call({ caller: 'admin' });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(response.data?.[name] ?? null).toBeNull();
      await expectNothingWritten();
    },
  );
});

describe('notificationSenderInfo', () => {
  test.each([
    ['閲覧のみ', viewer],
    ['モデレーター', moderator],
    ['最上位管理者', superAdmin],
  ])(
    '%sの管理者に、初期の版0の行を未設定(値・日時・変更した管理者がnull)として返す',
    async (_, adminIndex) => {
      const response = await fetchNotificationSenderInfo(
        asSenderInfoAdmin(adminIndex),
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.notificationSenderInfo).toEqual(UNSET_STATE);
    },
  );

  test('最上位管理者が保存した後は、閲覧のみの管理者にも値・進んだ版・変更の日時と変更した管理者のニックネームを返す', async () => {
    const saved = await updateNotificationSenderInfo(
      { ...INFO, expectedVersion: 0 },
      asSenderInfoAdmin(superAdmin),
    );
    expect(saved.errors).toBeUndefined();

    const response = await fetchNotificationSenderInfo(
      asSenderInfoAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.notificationSenderInfo).toEqual({
      info: INFO,
      version: 1,
      updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
      updatedByNickname: nicknameOf(superAdmin),
    });
  });

  test.each([
    ['削除済み', deleted, () => Promise.resolve()],
    ['招待中', invited, () => insertInvitedAdmin(invited)],
  ])(
    '最後に保存した管理者が%sなら、値と日時を返し、ニックネームだけをnullにする',
    async (_, adminIndex, arrange) => {
      await arrange();
      const at = new Date('2026-11-20T03:00:00.000Z');
      await markSenderInfoUpdatedBy(adminIdOf(adminIndex), INFO, at);

      const response = await fetchNotificationSenderInfo(
        asSenderInfoAdmin(viewer),
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.notificationSenderInfo).toEqual({
        info: INFO,
        version: 1,
        updatedAt: at.toISOString(),
        updatedByNickname: null,
      });
    },
  );
});

describe('updateNotificationSenderInfo', () => {
  test.each([
    ['閲覧のみ', viewer],
    ['モデレーター', moderator],
  ])(
    '%sの管理者はforbiddenで拒否し、送信者情報も監査ログも変えない',
    async (_, adminIndex) => {
      const response = await updateNotificationSenderInfo(
        { ...INFO, expectedVersion: 0, reason: '権限の無い変更' },
        asSenderInfoAdmin(adminIndex),
      );

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.updateNotificationSenderInfo ?? null).toBeNull();
      await expectNothingWritten();
    },
  );

  test('空白だけの項目は項目ごとの未入力の文言で、3項目すべてをvalidation_errorで拒否し、何も書かない', async () => {
    const response = await updateNotificationSenderInfo(
      {
        businessName: '',
        contactEmail: ' \u3000',
        postalAddress: '\n',
        expectedVersion: 0,
      },
      asSenderInfoAdmin(superAdmin),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.errors?.[0]?.message).toBe(VALIDATION_ERROR_MESSAGE);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.businessName',
        code: 'empty',
        message: '事業者名を入力してください。',
      },
      {
        field: 'input.contactEmail',
        code: 'empty',
        message: '連絡先メールアドレスを入力してください。',
      },
      {
        field: 'input.postalAddress',
        code: 'empty',
        message: '物理的郵送先住所を入力してください。',
      },
    ]);
    await expectNothingWritten();
  });

  test('201書記素の項目は文字数の超過、形式の違うメールアドレスは形式の違反として、違反の項目だけをvalidation_errorで拒否する', async () => {
    const tooLong = 'あ'.repeat(SENDER_INFO_MAX_GRAPHEMES + 1);

    const response = await updateNotificationSenderInfo(
      {
        businessName: INFO.businessName,
        contactEmail: 'support@',
        postalAddress: tooLong,
        expectedVersion: 0,
      },
      asSenderInfoAdmin(superAdmin),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.contactEmail',
        code: 'invalid-email',
        message: 'メールアドレスの形式が正しくありません。',
      },
      {
        field: 'input.postalAddress',
        code: 'too-long',
        message: '物理的郵送先住所は200文字以内で入力してください。',
      },
    ]);
    await expectNothingWritten();
  });

  test('理由が501書記素ならvalidation_errorで拒否し、何も書かない', async () => {
    const response = await updateNotificationSenderInfo(
      {
        ...INFO,
        expectedVersion: 0,
        reason: 'あ'.repeat(AUDIT_REASON_MAX + 1),
      },
      asSenderInfoAdmin(superAdmin),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.reason',
        code: 'custom',
        message: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
      },
    ]);
    await expectNothingWritten();
  });

  test('負の版はvalidation_errorで拒否し、何も書かない', async () => {
    const response = await updateNotificationSenderInfo(
      { ...INFO, expectedVersion: -1 },
      asSenderInfoAdmin(superAdmin),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.expectedVersion',
        code: 'too_small',
        message: '版は0以上の整数で指定してください。',
      },
    ]);
    await expectNothingWritten();
  });

  test('他の最上位管理者が同じ版から先に保存していたらversion_conflictで拒否し、送信者情報も監査ログも変えない', async () => {
    const first = await updateNotificationSenderInfo(
      { ...INFO, expectedVersion: 0 },
      asSenderInfoAdmin(secondSuperAdmin),
    );
    expect(first.errors).toBeUndefined();
    const before = await readSenderInfoRow();

    const response = await updateNotificationSenderInfo(
      { ...INFO, postalAddress: '大阪府大阪市4-5-6', expectedVersion: 0 },
      asSenderInfoAdmin(superAdmin),
    );

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['version_conflict']);
    expect(response.errors?.[0]?.message).toBe(
      NOTIFICATIONS_ERRORS.version_conflict.message,
    );
    expect(response.data?.updateNotificationSenderInfo ?? null).toBeNull();
    await expect(readSenderInfoRow()).resolves.toEqual(before);
    await expect(readAuditLogSummaries()).resolves.toHaveLength(1);
  });

  test('最上位管理者は読み取った版と一致すれば前後の空白を除いて保存し、値・進んだ版・変更の日時・自分のニックネームを返し、値を含めずに監査ログへ記録する', async () => {
    const response = await updateNotificationSenderInfo(
      {
        businessName: ` ${INFO.businessName} `,
        contactEmail: `\u3000${INFO.contactEmail}`,
        postalAddress: `${INFO.postalAddress}\n`,
        expectedVersion: 0,
        reason: '特定電子メール法の表示の準備',
      },
      asSenderInfoAdmin(superAdmin),
    );

    expect(response.errors).toBeUndefined();
    const state = response.data?.updateNotificationSenderInfo;
    expect(state).toEqual({
      info: INFO,
      version: 1,
      updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
      updatedByNickname: nicknameOf(superAdmin),
    });
    const row = await readSenderInfoRow();
    expect(row).toEqual({
      ...SENDER_INFO_SEED_ROW,
      ...INFO,
      version: 1,
      updatedByAdminId: adminIdOf(superAdmin),
      updatedAt: expect.any(Date) as Date,
    });
    expect(row?.updatedAt.toISOString()).toBe(state?.updatedAt);
    await expect(readAuditLogSummaries()).resolves.toEqual([
      {
        id: expect.any(String) as string,
        operatorAdminId: adminIdOf(superAdmin),
        action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
        detail: { fields: 'businessName,contactEmail,postalAddress' },
      },
    ]);
  });

  test('保存した版から続けて保存すると版を進め、理由を省いても保存できる', async () => {
    const first = await updateNotificationSenderInfo(
      { ...INFO, expectedVersion: 0 },
      asSenderInfoAdmin(superAdmin),
    );
    expect(first.errors).toBeUndefined();

    const response = await updateNotificationSenderInfo(
      { ...INFO, postalAddress: '大阪府大阪市4-5-6', expectedVersion: 1 },
      asSenderInfoAdmin(secondSuperAdmin),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateNotificationSenderInfo).toEqual({
      info: { ...INFO, postalAddress: '大阪府大阪市4-5-6' },
      version: 2,
      updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
      updatedByNickname: nicknameOf(secondSuperAdmin),
    });
    await expect(readAuditLogSummaries()).resolves.toEqual([
      expect.objectContaining({ operatorAdminId: adminIdOf(superAdmin) }),
      expect.objectContaining({
        operatorAdminId: adminIdOf(secondSuperAdmin),
        detail: { fields: 'postalAddress' },
      }),
    ]);
  });
});
