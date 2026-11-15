import { describe, expectTypeOf, test } from 'bun:test';

import type { UltrasPlanStatus } from '../../../common-lib/ultras/plan-status.ts';
import type { SubscriptionSnapshot } from './entitlement-rules.ts';
import type {
  SubscriptionRow,
  UltrasNoticeKind,
  UltrasNoticeRow,
  UltrasNotifier,
  UltrasPlanExport,
  UltrasPlanView,
} from './ports.ts';

describe('UltrasNoticeKind', () => {
  test('メールの依頼の種類は支払いの失敗と解約の受付の2種である', () => {
    expectTypeOf<UltrasNoticeKind>().toEqualTypeOf<
      'payment_failed' | 'cancellation_accepted'
    >();
  });
});

describe('UltrasNoticeRow', () => {
  test('メールの依頼の状態は依頼待ち・依頼済み・対象外の3種である', () => {
    expectTypeOf<UltrasNoticeRow['status']>().toEqualTypeOf<
      'pending' | 'requested' | 'skipped'
    >();
  });
});

describe('SubscriptionRow', () => {
  test('加入の行は特典の判定に使う写しの全項目を持つ', () => {
    expectTypeOf<SubscriptionRow>().toExtend<SubscriptionSnapshot>();
  });
});

describe('UltrasPlanView', () => {
  test('加入状態は共用部品の4状態と同じである', () => {
    expectTypeOf<UltrasPlanView['status']>().toEqualTypeOf<UltrasPlanStatus>();
  });
});

describe('UltrasPlanExport', () => {
  test('エクスポートのplanの名前はultrasに固定される', () => {
    expectTypeOf<
      NonNullable<Awaited<ReturnType<UltrasPlanExport['find']>>>['name']
    >().toEqualTypeOf<'ultras'>();
  });
});

describe('UltrasNotifier', () => {
  test('メールの依頼の結果は依頼の記録・対象外・依頼待ちでないの3種である', () => {
    expectTypeOf<Awaited<ReturnType<UltrasNotifier['send']>>>().toEqualTypeOf<
      'requested' | 'skipped' | 'not_pending'
    >();
  });
});
