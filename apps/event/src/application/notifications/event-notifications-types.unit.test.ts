import { describe, expect, test } from 'bun:test';

import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import { EVENT_NOTIFICATIONS_TYPES } from './event-notifications-types.ts';

const EXPECTED_NAMES: readonly string[] = [];

describe('EVENT_NOTIFICATIONS_TYPES', () => {
  test('イベントサーバーの通知の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_NOTIFICATIONS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test('識別子はグローバルのシンボル登録簿のnotifications.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries<symbol>(
      EVENT_NOTIFICATIONS_TYPES,
    )) {
      expect<symbol>(identifier).toBe(
        Symbol.for(`notifications.event.${name}`),
      );
    }
  });

  test('識別子はすべて互いに異なり、backend-libの共有の識別子と重ならない', () => {
    const identifiers = Object.values<symbol>(EVENT_NOTIFICATIONS_TYPES);
    const shared = new Set<symbol>(Object.values(NOTIFICATIONS_PLATFORM_TYPES));

    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_NOTIFICATIONS_TYPES)).toBe(true);
  });
});
