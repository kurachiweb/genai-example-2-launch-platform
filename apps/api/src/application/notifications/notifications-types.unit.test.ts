import { describe, expect, test } from 'bun:test';

import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';

const EXPECTED_NAMES = [
  'AccountWithdrawalSyncHandler',
  'DeliveryStatusReader',
  'NotificationMaintenanceStore',
  'NotificationSettingsService',
  'SenderInfoService',
  'SenderInfoWriter',
  'UnsubscribeService',
] as const;

describe('NOTIFICATIONS_TYPES', () => {
  test('apiの通知の照会とユースケースの識別子だけを持つ', () => {
    expect(Object.keys(NOTIFICATIONS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のnotifications.<名前>である',
    (name) => {
      expect<symbol>(NOTIFICATIONS_TYPES[name]).toBe(
        Symbol.for(`notifications.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(NOTIFICATIONS_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(NOTIFICATIONS_PLATFORM_TYPES));

    for (const identifier of Object.values(NOTIFICATIONS_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(NOTIFICATIONS_TYPES)).toBe(true);
  });
});
