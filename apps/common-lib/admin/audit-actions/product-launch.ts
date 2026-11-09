import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const PRODUCT_CATEGORY_CREATE_ACTION = defineAuditAction({
  name: 'product-category.create',
  label: 'プロダクトカテゴリの追加',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

// 名前とハンドルの両方を変えるため、名前だけを変える問い合わせカテゴリのrenameと分けてupdateとする
export const PRODUCT_CATEGORY_UPDATE_ACTION = defineAuditAction({
  name: 'product-category.update',
  label: 'プロダクトカテゴリの変更',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const PRODUCT_CATEGORY_DELETE_ACTION = defineAuditAction({
  name: 'product-category.delete',
  label: 'プロダクトカテゴリの削除',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const PRODUCT_LAUNCH_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([
    PRODUCT_CATEGORY_CREATE_ACTION,
    PRODUCT_CATEGORY_UPDATE_ACTION,
    PRODUCT_CATEGORY_DELETE_ACTION,
  ]);
