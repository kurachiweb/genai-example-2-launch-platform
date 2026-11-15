import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
  HELP_ARTICLE_REORDER_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
  HELP_CATEGORY_CREATE_ACTION,
  HELP_CATEGORY_DELETE_ACTION,
  HELP_CATEGORY_RENAME_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
  HELP_CENTER_AUDIT_ACTIONS,
} from './help-center.ts';

describe('ヘルプ記事の操作の種別', () => {
  test.each([
    [
      '作成',
      HELP_ARTICLE_CREATE_ACTION,
      {
        name: 'help-article.create',
        label: 'ヘルプ記事の作成',
        targetKind: 'help-article',
        reason: 'optional',
        detailKeys: ['status'],
        maxTargets: 1,
      },
    ],
    [
      '編集',
      HELP_ARTICLE_UPDATE_ACTION,
      {
        name: 'help-article.update',
        label: 'ヘルプ記事の編集',
        targetKind: 'help-article',
        reason: 'optional',
        detailKeys: ['fromStatus', 'toStatus'],
        maxTargets: 1,
      },
    ],
    [
      '削除',
      HELP_ARTICLE_DELETE_ACTION,
      {
        name: 'help-article.delete',
        label: 'ヘルプ記事の削除',
        targetKind: 'help-article',
        reason: 'optional',
        detailKeys: [],
        maxTargets: 1,
      },
    ],
    [
      '並べ替え',
      HELP_ARTICLE_REORDER_ACTION,
      {
        name: 'help-article.reorder',
        label: 'ヘルプ記事の並べ替え',
        targetKind: 'category',
        reason: 'optional',
        detailKeys: ['count'],
        maxTargets: 1,
      },
    ],
  ] as const)('%sの定義を持つ', (_, action, expected) => {
    expect(action).toEqual(expected);
  });
});

describe('ヘルプ記事カテゴリの操作の種別', () => {
  test.each([
    [
      '追加',
      HELP_CATEGORY_CREATE_ACTION,
      {
        name: 'help-category.create',
        label: 'ヘルプ記事カテゴリの追加',
        targetKind: 'category',
        reason: 'optional',
        detailKeys: [],
        maxTargets: 1,
      },
    ],
    [
      '名前の変更',
      HELP_CATEGORY_RENAME_ACTION,
      {
        name: 'help-category.rename',
        label: 'ヘルプ記事カテゴリの名前の変更',
        targetKind: 'category',
        reason: 'optional',
        detailKeys: [],
        maxTargets: 1,
      },
    ],
    [
      '削除',
      HELP_CATEGORY_DELETE_ACTION,
      {
        name: 'help-category.delete',
        label: 'ヘルプ記事カテゴリの削除',
        targetKind: 'category',
        reason: 'optional',
        detailKeys: ['reassignedCount'],
        maxTargets: 1,
      },
    ],
    [
      '並べ替え',
      HELP_CATEGORY_REORDER_ACTION,
      {
        name: 'help-category.reorder',
        label: 'ヘルプ記事カテゴリの並べ替え',
        targetKind: null,
        reason: 'optional',
        detailKeys: ['count'],
        maxTargets: 1,
      },
    ],
  ] as const)('%sの定義を持つ', (_, action, expected) => {
    expect(action).toEqual(expected);
  });
});

describe('HELP_CENTER_AUDIT_ACTIONS', () => {
  test('本specの8種別を記事・カテゴリの順に持つ', () => {
    expect(HELP_CENTER_AUDIT_ACTIONS).toEqual([
      HELP_ARTICLE_CREATE_ACTION,
      HELP_ARTICLE_UPDATE_ACTION,
      HELP_ARTICLE_DELETE_ACTION,
      HELP_ARTICLE_REORDER_ACTION,
      HELP_CATEGORY_CREATE_ACTION,
      HELP_CATEGORY_RENAME_ACTION,
      HELP_CATEGORY_DELETE_ACTION,
      HELP_CATEGORY_REORDER_ACTION,
    ]);
  });

  test.each(HELP_CENTER_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは理由が任意で、タイトル・本文・カテゴリ名を入れる詳細の鍵を持たない',
    (_name, action) => {
      expect(action.reason).toBe('optional');
      expect(action.detailKeys).not.toContainAnyValues([
        'title',
        'subtitle',
        'body',
        'name',
        'handle',
      ]);
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(HELP_CENTER_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(HELP_CENTER_AUDIT_ACTIONS)).toBe(true);
    for (const action of HELP_CENTER_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
