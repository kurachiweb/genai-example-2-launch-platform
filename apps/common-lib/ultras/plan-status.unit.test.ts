import { describe, expect, test } from 'bun:test';

import {
  ULTRAS_ENTITLED_STATUSES,
  ULTRAS_PLAN_STATUS_LABELS,
  ULTRAS_PLAN_STATUSES,
  ULTRAS_PRICE_LOOKUP_KEY,
} from './plan-status.ts';

// データエクスポートの`plan.status`の値(docs/GUIDES/service/features/001-user-data-export.md)
const DATA_EXPORT_PLAN_STATUSES = [
  'active',
  'past_due',
  'canceled',
  'ended',
] as const;

describe('ULTRAS_PLAN_STATUSES', () => {
  test('有効・支払いの再試行中・解約済み・終了の4値を持つ', () => {
    expect([...ULTRAS_PLAN_STATUSES]).toEqual([
      'active',
      'past_due',
      'canceled',
      'ended',
    ]);
  });

  test('データエクスポートのplan.statusの値と一致する', () => {
    expect([...ULTRAS_PLAN_STATUSES]).toEqual([...DATA_EXPORT_PLAN_STATUSES]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(ULTRAS_PLAN_STATUSES)).toBe(true);
  });
});

describe('ULTRAS_PLAN_STATUS_LABELS', () => {
  test('各加入状態の表示名がプラン管理画面の呼び方になる', () => {
    expect(ULTRAS_PLAN_STATUS_LABELS).toEqual({
      active: '有効',
      past_due: '支払いの再試行中',
      canceled: '解約済み',
      ended: '終了',
    });
  });

  test('表示名の対応は変更できない', () => {
    expect(Object.isFrozen(ULTRAS_PLAN_STATUS_LABELS)).toBe(true);
  });
});

describe('ULTRAS_ENTITLED_STATUSES', () => {
  test('有効・支払いの再試行中・解約済みの間は特典を受けられる', () => {
    expect([...ULTRAS_ENTITLED_STATUSES]).toEqual([
      'active',
      'past_due',
      'canceled',
    ]);
  });

  test('終了は特典を受けられない', () => {
    expect(ULTRAS_ENTITLED_STATUSES).not.toContain('ended');
  });

  test('すべて加入状態の4値のいずれかである', () => {
    for (const status of ULTRAS_ENTITLED_STATUSES) {
      expect(ULTRAS_PLAN_STATUSES).toContain(status);
    }
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(ULTRAS_ENTITLED_STATUSES)).toBe(true);
  });
});

describe('ULTRAS_PRICE_LOOKUP_KEY', () => {
  test('月額の価格のlookup_keyはultras_monthlyになる', () => {
    expect(ULTRAS_PRICE_LOOKUP_KEY).toBe('ultras_monthly');
  });
});
