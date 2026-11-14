import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  PRODUCT_CATEGORY_CREATE_ACTION,
  PRODUCT_CATEGORY_DELETE_ACTION,
  PRODUCT_CATEGORY_UPDATE_ACTION,
  PRODUCT_LAUNCH_AUDIT_ACTIONS,
} from './product-launch.ts';

describe('プロダクトカテゴリの操作の種別', () => {
  test('追加は対象がカテゴリ1件で理由が任意、詳細を持たない', () => {
    expect(PRODUCT_CATEGORY_CREATE_ACTION).toEqual({
      name: 'product-category.create',
      label: 'プロダクトカテゴリの追加',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('変更は対象がカテゴリ1件で理由が任意、詳細を持たない', () => {
    expect(PRODUCT_CATEGORY_UPDATE_ACTION).toEqual({
      name: 'product-category.update',
      label: 'プロダクトカテゴリの変更',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('削除は対象がカテゴリ1件で理由が任意、詳細を持たない', () => {
    expect(PRODUCT_CATEGORY_DELETE_ACTION).toEqual({
      name: 'product-category.delete',
      label: 'プロダクトカテゴリの削除',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });
});

describe('PRODUCT_LAUNCH_AUDIT_ACTIONS', () => {
  test('本specの3種別を追加・変更・削除の順に持つ', () => {
    expect(PRODUCT_LAUNCH_AUDIT_ACTIONS).toEqual([
      PRODUCT_CATEGORY_CREATE_ACTION,
      PRODUCT_CATEGORY_UPDATE_ACTION,
      PRODUCT_CATEGORY_DELETE_ACTION,
    ]);
  });

  test.each(
    PRODUCT_LAUNCH_AUDIT_ACTIONS.map((action) => [action.name, action]),
  )(
    '種別%sはカテゴリの名前・ハンドルの値を入れる詳細の鍵を持たない',
    (_name, action) => {
      expect(action.detailKeys).toEqual([]);
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(PRODUCT_LAUNCH_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(PRODUCT_LAUNCH_AUDIT_ACTIONS)).toBe(true);
    for (const action of PRODUCT_LAUNCH_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
