import { describe, expect, test } from 'bun:test';

import { checkHelpCategoryEditable } from './help-category-rules.ts';

describe('checkHelpCategoryEditable', () => {
  test('標準カテゴリの名前の変更と削除はprotectedで拒否する', () => {
    expect(checkHelpCategoryEditable({ systemDefault: true })).toBe(
      'protected',
    );
  });

  test('管理者が追加したカテゴリは名前の変更と削除ができる', () => {
    expect(checkHelpCategoryEditable({ systemDefault: false })).toBeUndefined();
  });
});
