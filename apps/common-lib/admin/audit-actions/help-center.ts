import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const HELP_ARTICLE_CREATE_ACTION = defineAuditAction({
  name: 'help-article.create',
  label: 'ヘルプ記事の作成',
  targetKind: 'help-article',
  reason: 'optional',
  detailKeys: ['status'],
  maxTargets: 1,
});

export const HELP_ARTICLE_UPDATE_ACTION = defineAuditAction({
  name: 'help-article.update',
  label: 'ヘルプ記事の編集',
  targetKind: 'help-article',
  reason: 'optional',
  detailKeys: ['fromStatus', 'toStatus'],
  maxTargets: 1,
});

export const HELP_ARTICLE_DELETE_ACTION = defineAuditAction({
  name: 'help-article.delete',
  label: 'ヘルプ記事の削除',
  targetKind: 'help-article',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

// 記事の並び順はカテゴリ内の系列のため、並べ替えたカテゴリを対象にする
export const HELP_ARTICLE_REORDER_ACTION = defineAuditAction({
  name: 'help-article.reorder',
  label: 'ヘルプ記事の並べ替え',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: ['count'],
  maxTargets: 1,
});

export const HELP_CATEGORY_CREATE_ACTION = defineAuditAction({
  name: 'help-category.create',
  label: 'ヘルプ記事カテゴリの追加',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const HELP_CATEGORY_RENAME_ACTION = defineAuditAction({
  name: 'help-category.rename',
  label: 'ヘルプ記事カテゴリの名前の変更',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const HELP_CATEGORY_DELETE_ACTION = defineAuditAction({
  name: 'help-category.delete',
  label: 'ヘルプ記事カテゴリの削除',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: ['reassignedCount'],
  maxTargets: 1,
});

export const HELP_CATEGORY_REORDER_ACTION = defineAuditAction({
  name: 'help-category.reorder',
  label: 'ヘルプ記事カテゴリの並べ替え',
  targetKind: null,
  reason: 'optional',
  detailKeys: ['count'],
  maxTargets: 1,
});

export const HELP_CENTER_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([
    HELP_ARTICLE_CREATE_ACTION,
    HELP_ARTICLE_UPDATE_ACTION,
    HELP_ARTICLE_DELETE_ACTION,
    HELP_ARTICLE_REORDER_ACTION,
    HELP_CATEGORY_CREATE_ACTION,
    HELP_CATEGORY_RENAME_ACTION,
    HELP_CATEGORY_DELETE_ACTION,
    HELP_CATEGORY_REORDER_ACTION,
  ]);
