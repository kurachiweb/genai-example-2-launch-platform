import { describe, expect, test } from 'bun:test';

import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import { PRODUCT_TYPES } from './product-types.ts';

const EXPECTED_NAMES = [
  'ProductStateEvaluator',
  'RelaunchConditionSources',
  'ProductLockSources',
  'LaunchSummarySources',
  'ProductSaveHooks',
  'ProductStore',
  'ProductRegistration',
  'ProductEditor',
  'ProductDescriptionEditor',
  'MyProductsReader',
  'ProductHandleAvailabilityChecker',
  'ProductLifecycleCommitter',
  'ProductDeletion',
  'ProductVisibilityControl',
  'ProductWithdrawalSyncHandler',
  'LaunchCancellationSyncHandler',
  'ProductIncidentReporter',
  'ProductPurgeOrchestratorJob',
  'ProductLifecycleRedispatchJob',
  'ProductCategoryStore',
  'ProductCategoryService',
] as const;

describe('PRODUCT_TYPES', () => {
  test('apiのプロダクトの判定・ユースケース・ストアの識別子だけを持つ', () => {
    expect(Object.keys(PRODUCT_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のproduct.<名前>である',
    (name) => {
      expect<symbol>(PRODUCT_TYPES[name]).toBe(Symbol.for(`product.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PRODUCT_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(PRODUCT_PLATFORM_TYPES));

    for (const identifier of Object.values(PRODUCT_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PRODUCT_TYPES)).toBe(true);
  });
});
