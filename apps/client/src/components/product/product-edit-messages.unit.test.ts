import { describe, expect, test } from 'bun:test';

import { deleteConfirmTitleOf } from './product-edit-messages.ts';

describe('deleteConfirmTitleOf', () => {
  test('プロダクトの名称を二重かぎ括弧で囲んで削除の確認の見出しにする', () => {
    expect(deleteConfirmTitleOf('Pitch Notes')).toBe(
      'プロダクト『Pitch Notes』を削除しますか?',
    );
  });
});
