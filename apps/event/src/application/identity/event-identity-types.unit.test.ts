import { describe, expect, test } from 'bun:test';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { EVENT_IDENTITY_TYPES } from './event-identity-types.ts';

describe('EVENT_IDENTITY_TYPES', () => {
  test('識別子はグローバルのシンボル登録簿のidentity.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries(EVENT_IDENTITY_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`identity.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>([
      ...Object.values(IDENTITY_PLATFORM_TYPES),
      ...Object.values(EMAIL_TYPES),
    ]);

    expect(
      Object.values(EVENT_IDENTITY_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_IDENTITY_TYPES)).toBe(true);
  });
});
