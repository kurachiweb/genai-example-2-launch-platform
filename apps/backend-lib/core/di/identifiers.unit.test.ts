import { describe, expect, test } from 'bun:test';

import { PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'Env',
  'InvocationScope',
  'Database',
  'Clock',
  'IdGenerator',
  'KeyedHasher',
  'MessagePublisher',
  'BotVerifier',
  'RateLimitCounterClient',
] as const;

describe('PLATFORM_TYPES', () => {
  test('基盤が束縛する9種の依存の識別子だけを持つ', () => {
    expect(Object.keys(PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のplatform.<名前>である',
    (name) => {
      expect<symbol>(PLATFORM_TYPES[name]).toBe(Symbol.for(`platform.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PLATFORM_TYPES)).toBe(true);
  });
});
