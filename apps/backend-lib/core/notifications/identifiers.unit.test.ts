import { describe, expect, test } from 'bun:test';

import { NOTIFICATIONS_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'NotificationPreferenceStore',
  'UnsubscribeTokenService',
  'SenderInfoStore',
  'NotificationSlotStore',
  'NotificationNoticeStore',
  'NotificationEventPublisher',
  'NotificationEventExpander',
  'NotificationWorkRequester',
  'NotificationSettingsExport',
  'NotificationIncidentReporter',
  'EveningDispatchGate',
  'EveningSlotOpener',
  'EveningDispatchParticipants',
] as const;

describe('NOTIFICATIONS_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する13種の識別子だけを持つ', () => {
    expect(Object.keys(NOTIFICATIONS_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のnotifications.<名前>である',
    (name) => {
      expect<symbol>(NOTIFICATIONS_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`notifications.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(NOTIFICATIONS_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(NOTIFICATIONS_PLATFORM_TYPES)).toBe(true);
  });
});
