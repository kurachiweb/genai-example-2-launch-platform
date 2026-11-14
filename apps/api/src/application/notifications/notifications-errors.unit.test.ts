import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import {
  NOTIFICATIONS_ERRORS,
  notificationsError,
} from './notifications-errors.ts';

describe('notificationsError', () => {
  test.each([['account_unavailable', 'forbidden', 403]] as const)(
    '%sは%s(%i)のAppErrorになる',
    (code, kind, status) => {
      const error = notificationsError(code);

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.message).toBe(NOTIFICATIONS_ERRORS[code].message);
      expect(error.details).toBeUndefined();
    },
  );

  test('account_unavailableの文言はidentity-authと同じである', () => {
    expect(NOTIFICATIONS_ERRORS.account_unavailable).toBe(
      IDENTITY_ERRORS.account_unavailable,
    );
  });
});
