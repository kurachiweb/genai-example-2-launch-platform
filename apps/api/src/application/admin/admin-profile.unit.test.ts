import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  adminRecordOf,
  CURRENT_AVATAR_ID,
  currentAdmin,
  MANAGEMENT_META,
  NEW_AVATAR_ID,
  OPERATOR_ID,
  rejectionOf,
  operatorRecordOf,
  setupAccountManagement,
  TARGET_ID,
} from './testing/admin-account-management-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('StoreAdminProfile.update', () => {
  test('本人は前後の空白を除いたニックネームと肩書きと新しい画像で更新でき、新しい画像を操作者を保有者として紐付けてから以前の画像を削除する', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        adminRecordOf({
          id: OPERATOR_ID,
          role: 'viewer',
          avatarFileId: CURRENT_AVATAR_ID,
        }),
      ],
    });

    const updated = await profile.update(
      currentAdmin('viewer'),
      {
        adminId: OPERATOR_ID,
        nickname: '  新しい名前  ',
        title: ' サポート担当 ',
        avatarFileId: NEW_AVATAR_ID,
      },
      MANAGEMENT_META,
    );

    expect(recorded.claims).toEqual([
      {
        fileIds: [NEW_AVATAR_ID],
        purpose: 'admin-avatar',
        owner: { kind: 'admin', id: OPERATOR_ID },
      },
    ]);
    expect(recorded.profileUpdates).toEqual([
      {
        adminId: OPERATOR_ID,
        input: {
          nickname: '新しい名前',
          title: 'サポート担当',
          avatarFileId: NEW_AVATAR_ID,
        },
      },
    ]);
    expect(recorded.erasures).toEqual([[CURRENT_AVATAR_ID]]);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'media.claim',
      'admins.updateProfile',
      'media.eraseNow',
    ]);
    expect(updated).toMatchObject({
      id: OPERATOR_ID,
      nickname: '新しい名前',
      title: 'サポート担当',
      avatarFileId: NEW_AVATAR_ID,
      status: 'active',
    });
  });

  test('最上位管理者は他の管理者のプロフィールを更新でき、画像の保有者はアップロードした操作者にする', async () => {
    const { profile, recorded } = setupAccountManagement();

    await profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(recorded.claims[0]?.owner).toEqual({
      kind: 'admin',
      id: OPERATOR_ID,
    });
    expect(recorded.profileUpdates).toEqual([
      {
        adminId: TARGET_ID,
        input: { nickname: '対象', title: null, avatarFileId: NEW_AVATAR_ID },
      },
    ]);
    expect(recorded.erasures).toEqual([]);
  });

  test.each(['moderator', 'viewer'] as const)(
    '%sによる他の管理者のプロフィールの更新は権限の不足で拒否し、何も読み書きしない',
    async (role) => {
      const { profile, recorded } = setupAccountManagement({
        admins: [operatorRecordOf(role), adminRecordOf()],
      });

      const result = profile.update(
        currentAdmin(role),
        { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
        MANAGEMENT_META,
      );

      expect(await rejectionOf(result)).toMatchObject({
        kind: 'forbidden',
        code: 'forbidden',
      });
      expect(recorded.calls).toEqual([]);
    },
  );

  test('ニックネームと肩書きの規則の違反は、欄ごとの理由を持つ入力の検証の失敗にし、何も読み書きしない', async () => {
    const { profile, recorded } = setupAccountManagement();

    const result = profile.update(
      currentAdmin('super_admin'),
      {
        adminId: TARGET_ID,
        nickname: '   ',
        title: 'あ'.repeat(51),
        avatarFileId: NEW_AVATAR_ID,
      },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
      details: [
        {
          field: 'nickname',
          code: 'empty',
          message: 'ニックネームを入力してください。',
        },
        {
          field: 'title',
          code: 'too-long',
          message: '肩書きは50文字以内で入力してください。',
        },
      ],
    });
    expect(recorded.calls).toEqual([]);
  });

  test('ニックネームは25書記素まで、肩書きは50書記素まで受け付ける', async () => {
    const { profile, recorded } = setupAccountManagement();

    await profile.update(
      currentAdmin('super_admin'),
      {
        adminId: TARGET_ID,
        nickname: '👨‍👩‍👧'.repeat(25),
        title: 'い'.repeat(50),
      },
      MANAGEMENT_META,
    );

    expect(recorded.profileUpdates).toHaveLength(1);
  });

  test('ニックネームが長すぎれば、ニックネームの欄だけの理由で拒否する', async () => {
    const { profile } = setupAccountManagement();

    const result = profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: 'あ'.repeat(26) },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      details: [
        {
          field: 'nickname',
          code: 'too-long',
          message: 'ニックネームは25文字以内で入力してください。',
        },
      ],
    });
  });

  test('空白だけの肩書きは未設定として保存する', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ title: '以前の肩書き' }),
      ],
    });

    await profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', title: '   ' },
      MANAGEMENT_META,
    );

    expect(recorded.profileUpdates[0]?.input.title).toBeNull();
  });

  test('対象が存在しなければ対象なしで拒否し、画像を紐付けない', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [operatorRecordOf('super_admin')],
    });

    const result = profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
    expect(recorded.calls).toEqual(['admins.findById']);
  });

  test.each([
    ['招待中', null],
    ['招待期限切れ', new Date('2026-11-02T00:00:00.000Z')],
  ] as const)(
    '%sの管理者のプロフィールは最上位管理者でも更新できず、対象なしで拒否し画像を紐付けない',
    async (_label, invitationExpiresAt) => {
      const { profile, recorded } = setupAccountManagement({
        admins: [
          operatorRecordOf('super_admin'),
          adminRecordOf({
            status: 'invited',
            passwordHash: null,
            nickname: null,
            activatedAt: null,
            invitationExpiresAt:
              invitationExpiresAt ?? new Date('2026-11-04T00:00:00.000Z'),
          }),
        ],
      });

      const result = profile.update(
        currentAdmin('super_admin'),
        { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
        MANAGEMENT_META,
      );

      expect(await rejectionOf(result)).toMatchObject({
        kind: 'not_found',
        code: 'not_found',
      });
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );

  test('読み取った後に対象が削除され更新できなければ、対象なしで拒否し、紐付けた新しい画像を削除して以前の画像は残す', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      beforeProfileUpdate: (admins) => {
        admins.delete(TARGET_ID);
      },
    });

    const result = profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
    expect(recorded.calls).toEqual([
      'admins.findById',
      'media.claim',
      'admins.updateProfile',
      'media.eraseNow',
    ]);
    expect(recorded.erasures).toEqual([[NEW_AVATAR_ID]]);
  });

  test('読み取った後に対象が削除され更新できなければ、画像を変えない更新では何も削除しない', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      beforeProfileUpdate: (admins) => {
        admins.delete(TARGET_ID);
      },
    });

    const result = profile.update(
      currentAdmin('super_admin'),
      {
        adminId: TARGET_ID,
        nickname: '対象',
        avatarFileId: CURRENT_AVATAR_ID,
      },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
    expect(recorded.erasures).toEqual([]);
  });

  test('画像を紐付けられなければ、アップロードの確認の失敗で拒否し、更新も以前の画像の削除もしない', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      claimResult: {
        ok: false,
        failures: [{ fileId: NEW_AVATAR_ID, reason: 'owner_mismatch' }],
      },
    });

    const result = profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'unprocessable',
      code: 'invalid_upload',
      message: '画像を確認できませんでした。もう一度アップロードしてください。',
    });
    expect(recorded.calls).toEqual(['admins.findById', 'media.claim']);
  });

  test('紐付けの一時的な障害はそのまま伝え、更新しない', async () => {
    const unavailable = new AppError({
      kind: 'unavailable',
      code: 'storage_unavailable',
      message: '現在ご利用いただけません。',
    });
    const { profile, recorded } = setupAccountManagement({
      claimError: unavailable,
    });

    const result = profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toBe(unavailable);
    expect(recorded.profileUpdates).toEqual([]);
  });

  test('画像を取り除くと、紐付けをせずに更新してから以前の画像を削除する', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
    });

    const updated = await profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: null },
      MANAGEMENT_META,
    );

    expect(recorded.calls).toEqual([
      'admins.findById',
      'admins.updateProfile',
      'media.eraseNow',
    ]);
    expect(recorded.erasures).toEqual([[CURRENT_AVATAR_ID]]);
    expect(updated.avatarFileId).toBeNull();
  });

  test('同じ画像のままなら紐付けも削除もしない', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
    });

    await profile.update(
      currentAdmin('super_admin'),
      {
        adminId: TARGET_ID,
        nickname: '対象',
        avatarFileId: CURRENT_AVATAR_ID,
      },
      MANAGEMENT_META,
    );

    expect(recorded.calls).toEqual(['admins.findById', 'admins.updateProfile']);
  });

  test('以前の画像の削除に失敗しても更新は成功させ、管理者のIDだけを属性にした警告のログに残す', async () => {
    const { profile, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      eraseError: new AppError({
        kind: 'unavailable',
        code: 'storage_unavailable',
        message: '現在ご利用いただけません。',
      }),
    });

    const updated = await profile.update(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, nickname: '対象', avatarFileId: NEW_AVATAR_ID },
      MANAGEMENT_META,
    );

    expect(updated.avatarFileId).toBe(NEW_AVATAR_ID);
    expect(recorded.profileUpdates).toHaveLength(1);
    const warnings = records.filter((record) => record.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'admin', 'profile']);
    expect(Object.keys(warnings[0]?.properties ?? {}).toSorted()).toEqual([
      'adminId',
      'error',
    ]);
    expect(warnings[0]?.properties['adminId']).toBe(TARGET_ID);
  });
});
