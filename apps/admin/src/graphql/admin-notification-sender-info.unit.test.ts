import { describe, expect, test } from 'bun:test';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminNotificationSenderInfoQueryOptions,
  toSenderInfoLastChange,
} from './admin-notification-sender-info.ts';
import { AdminNotificationSenderInfoDocument } from './generated/graphql.ts';

const UPDATED_AT = '2026-11-14T01:02:03.000Z';

const INFO = Object.freeze({
  businessName: '運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-2-3',
});

describe('adminNotificationSenderInfoQueryOptions', () => {
  test('操作の識別子と空の変数だけのキーを持つ', () => {
    expect([
      ...adminNotificationSenderInfoQueryOptions().queryKey,
    ]).toStrictEqual([documentIdOf(AdminNotificationSenderInfoDocument), {}]);
  });
});

describe('toSenderInfoLastChange', () => {
  test('保存された送信者情報は、保存した日時と保存した管理者のニックネームをそのまま返す', () => {
    expect(
      toSenderInfoLastChange({
        info: INFO,
        version: 2,
        updatedAt: UPDATED_AT,
        updatedByNickname: '統括の担当',
      }),
    ).toStrictEqual({ updatedAt: UPDATED_AT, updatedByNickname: '統括の担当' });
  });

  test('一度も保存していない版0の送信者情報は、日時と管理者を空にする', () => {
    expect(
      toSenderInfoLastChange({
        info: null,
        version: 0,
        updatedAt: '2026-11-14T00:00:00.000Z',
        updatedByNickname: '統括の担当',
      }),
    ).toStrictEqual({ updatedAt: null, updatedByNickname: null });
  });

  test('ニックネームを得られない管理者が保存した送信者情報は、日時を残して管理者だけを空にする', () => {
    expect(
      toSenderInfoLastChange({
        info: INFO,
        version: 3,
        updatedAt: UPDATED_AT,
        updatedByNickname: null,
      }),
    ).toStrictEqual({ updatedAt: UPDATED_AT, updatedByNickname: null });
  });
});
