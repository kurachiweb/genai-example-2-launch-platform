import { describe, expect, test } from 'bun:test';

import { REPORTING_PLATFORM_TYPES } from '../../../lib/core/reporting/identifiers.ts';
import { EVENT_REPORTING_TYPES } from './event-reporting-types.ts';

const EXPECTED_NAMES = [
  'UserReportErasureHandler',
  'ProductReportErasureHandler',
] as const;

describe('EVENT_REPORTING_TYPES', () => {
  test('ユーザーとプロダクトの物理削除の時期の処理の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_REPORTING_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のreporting.event.<名前>である',
    (name) => {
      expect<symbol>(EVENT_REPORTING_TYPES[name]).toBe(
        Symbol.for(`reporting.event.${name}`),
      );
    },
  );

  test('両アプリ共通の識別子と、値もメンバーの名前も重ならない', () => {
    const shared = new Set<symbol>(Object.values(REPORTING_PLATFORM_TYPES));
    const sharedNames = new Set<string>(Object.keys(REPORTING_PLATFORM_TYPES));

    expect(
      Object.values<symbol>(EVENT_REPORTING_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toStrictEqual([]);
    expect(
      Object.keys(EVENT_REPORTING_TYPES).filter((name) =>
        sharedNames.has(name),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_REPORTING_TYPES)).toBe(true);
  });
});
