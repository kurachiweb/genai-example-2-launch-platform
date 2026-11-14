import { describe, expect, expectTypeOf, test } from 'bun:test';

import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../../db/schema/product/product-lifecycle-events.ts';
import {
  QUALIFIER_OUTCOMES,
  type QualifierOutcome,
} from '../../core/product/launch-status.ts';
import {
  PRODUCT_LIFECYCLE_EVENT_STATUSES,
  PRODUCT_LIFECYCLE_EVENT_TYPES,
  type ProductLifecycleEventStatus,
  type ProductLifecycleEventType,
} from '../../core/product/product-lifecycle.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('プロダクトのテーブル定義の値の一覧', () => {
  test('ライフサイクルイベントの種類の列の値がcoreのイベントの種類の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof productLifecycleEvents.type.enumValues)[number]
    >().toEqualTypeOf<ProductLifecycleEventType>();
    expect([...productLifecycleEvents.type.enumValues]).toEqual([
      ...PRODUCT_LIFECYCLE_EVENT_TYPES,
    ]);
  });

  test('ライフサイクルイベントの状態の列の値がcoreのイベントの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof productLifecycleEvents.status.enumValues)[number]
    >().toEqualTypeOf<ProductLifecycleEventStatus>();
    expect([...productLifecycleEvents.status.enumValues]).toEqual([
      ...PRODUCT_LIFECYCLE_EVENT_STATUSES,
    ]);
  });

  test('ローンチの結果の列の値がcoreの予選の結果の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof productLaunches.outcome.enumValues)[number]
    >().toEqualTypeOf<QualifierOutcome>();
    expect([...productLaunches.outcome.enumValues]).toEqual([
      ...QUALIFIER_OUTCOMES,
    ]);
  });
});
