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
});
