import { describe, expect, test } from 'bun:test';

import { ULTRAS_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'SubscriptionStore',
  'ActivationStore',
  'NoticeStore',
  'UltrasPromotionFlagReader',
  'UltrasEntitlements',
  'UltrasPlanExport',
  'ActivationDispatcher',
  'UltrasNotifier',
  'SubscriptionStatements',
  'ActivationStatements',
  'NoticeStatements',
  'UltrasOfferPolicy',
  'UltrasFulfillment',
  'PlanStateSink',
] as const;

describe('ULTRAS_TYPES', () => {
  test('application層と後続specが受け取る8種と、workersだけが受け取る6種の識別子だけを持つ', () => {
    expect(Object.keys(ULTRAS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のultras.<名前>である',
    (name) => {
      expect<symbol>(ULTRAS_TYPES[name]).toBe(Symbol.for(`ultras.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(ULTRAS_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ULTRAS_TYPES)).toBe(true);
  });
});
