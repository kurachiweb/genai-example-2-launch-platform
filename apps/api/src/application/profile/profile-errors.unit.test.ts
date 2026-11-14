import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import { PROFILE_ERRORS, profileError } from './profile-errors.ts';

describe('profileError', () => {
  test.each([
    ['handle_unavailable', 'conflict', 409],
    ['profile_update_conflict', 'conflict', 409],
    ['invalid_upload', 'unprocessable', 422],
    ['cannot_follow_self', 'unprocessable', 422],
    ['follow_target_unavailable', 'unprocessable', 422],
    ['account_unavailable', 'forbidden', 403],
  ] as const)('%sは%s(%i)のAppErrorになる', (code, kind, status) => {
    const error = profileError(code);

    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
    expect(STATUS_BY_KIND[error.kind]).toBe(status);
    expect(error.message).toBe(PROFILE_ERRORS[code].message);
  });

  test('フォローの拒否の文言は文言規則と一字一句同じである', () => {
    expect(PROFILE_ERRORS.cannot_follow_self.message).toBe(
      '自分自身はフォローできません。',
    );
    expect(PROFILE_ERRORS.follow_target_unavailable.message).toBe(
      'このユーザーはフォローできません。',
    );
  });

  test('handle_unavailableだけがハンドル欄の詳細を持つ', () => {
    expect(profileError('handle_unavailable').details).toEqual([
      {
        field: 'handle',
        code: 'unavailable',
        message:
          'このハンドルは既に使われています。別の文字列を入力してください。',
      },
    ]);
    expect(profileError('invalid_upload').details).toBeUndefined();
  });

  test('account_unavailableの文言はidentity-authと同じである', () => {
    expect(PROFILE_ERRORS.account_unavailable).toBe(
      IDENTITY_ERRORS.account_unavailable,
    );
  });
});
