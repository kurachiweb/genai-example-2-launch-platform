import { describe, expect, test } from 'bun:test';

import { EMAIL_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'EmailKindRegistry',
  'EmailSender',
  'SuppressionList',
  'SuppressionRecorder',
  'SuppressionMaintenance',
  'UserAddressDirectory',
  'SenderInfoProvider',
  'SendRecordStore',
  'AlertThrottle',
] as const;

describe('EMAIL_TYPES', () => {
  test('両アプリと下流specが共有する9種のポートの識別子だけを持つ', () => {
    expect(Object.keys(EMAIL_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のemail.<名前>である',
    (name) => {
      expect<symbol>(EMAIL_TYPES[name]).toBe(Symbol.for(`email.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(EMAIL_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EMAIL_TYPES)).toBe(true);
  });
});
