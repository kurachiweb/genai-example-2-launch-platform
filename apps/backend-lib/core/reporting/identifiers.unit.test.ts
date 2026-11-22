import { describe, expect, test } from 'bun:test';

import { REPORTING_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'ReportErasureStore',
  'ReportErasureStatements',
] as const;

describe('REPORTING_PLATFORM_TYPES', () => {
  test('両アプリが共有する通報の削除の2種の識別子だけを持つ', () => {
    expect(Object.keys(REPORTING_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のreporting.<名前>である',
    (name) => {
      expect<symbol>(REPORTING_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`reporting.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(REPORTING_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(REPORTING_PLATFORM_TYPES)).toBe(true);
  });
});
