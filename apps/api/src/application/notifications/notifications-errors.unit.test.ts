import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import {
  NOTIFICATIONS_ERRORS,
  notificationsError,
} from './notifications-errors.ts';

describe('notificationsError', () => {
  test.each([
    ['account_unavailable', 'forbidden', 403],
    ['invalid_link', 'unprocessable', 422],
    ['version_conflict', 'conflict', 409],
  ] as const)('%sは%s(%i)のAppErrorになる', (code, kind, status) => {
    const error = notificationsError(code);

    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
    expect(STATUS_BY_KIND[error.kind]).toBe(status);
    expect(error.message).toBe(NOTIFICATIONS_ERRORS[code].message);
    expect(error.details).toBeUndefined();
  });

  test.each(['account_unavailable', 'invalid_link'] as const)(
    '%sの定義はidentity-authと同じである',
    (code) => {
      expect(NOTIFICATIONS_ERRORS[code]).toBe(IDENTITY_ERRORS[code]);
    },
  );

  test('version_conflictは他の管理者の先の変更を伝え、最新の内容の読み直しを案内する', () => {
    expect(notificationsError('version_conflict').message).toBe(
      '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
    );
  });
});
