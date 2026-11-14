import { describe, expect, test } from 'bun:test';

import { assertDecisionSourceRegistrations } from '../application/product/decision-sources.ts';
import {
  LAUNCH_SUMMARY_SOURCES,
  PRODUCT_LOCK_SOURCES,
  RELAUNCH_CONDITION_SOURCES,
} from './product-decision-sources.ts';

const REGISTRIES = [
  ['次回の予約の禁止', RELAUNCH_CONDITION_SOURCES],
  ['固定', PRODUCT_LOCK_SOURCES],
  ['ローンチの要約と受賞', LAUNCH_SUMMARY_SOURCES],
] as const;

describe('判定の供給元の登録口', () => {
  test('初版の3つの登録口は空である', () => {
    expect(RELAUNCH_CONDITION_SOURCES).toStrictEqual([]);
    expect(PRODUCT_LOCK_SOURCES).toStrictEqual([]);
    expect(LAUNCH_SUMMARY_SOURCES).toStrictEqual([]);
  });

  test.each(REGISTRIES)(
    '%sの登録は<spec名>.<名詞句>の名前とorderが重複せず、orderは整数である',
    (_name, registrations) => {
      expect(() => {
        assertDecisionSourceRegistrations(registrations);
      }).not.toThrow();
    },
  );
});
