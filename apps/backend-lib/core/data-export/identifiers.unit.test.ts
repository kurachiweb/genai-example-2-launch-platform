import { describe, expect, test } from 'bun:test';

import { DATA_EXPORT_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'DataExportStore',
  'ExportArchiveStorage',
  'DataExportNotifier',
  'DataExportTerminator',
  'DataExportIncidentReporter',
] as const;

describe('DATA_EXPORT_PLATFORM_TYPES', () => {
  test('api・eventが共有する5種の識別子だけを持つ', () => {
    expect(Object.keys(DATA_EXPORT_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のdata-export.<名前>である',
    (name) => {
      expect<symbol>(DATA_EXPORT_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`data-export.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(DATA_EXPORT_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(DATA_EXPORT_PLATFORM_TYPES)).toBe(true);
  });
});
