import { describe, expect, test } from 'bun:test';

import {
  helpCategoryDeleteDescription,
  helpItemMovedAnnouncement,
  moveDownName,
  moveUpName,
} from './help-messages.ts';

describe('並べ替えの文言', () => {
  test('上下の移動の操作の名前は、見えている操作名の前に対象の名前を置く', () => {
    expect(moveUpName('ログインできない')).toBe('ログインできないを上へ移動');
    expect(moveDownName('料金')).toBe('料金を下へ移動');
  });

  test('移動の読み上げは、対象の名前と移動した後の一覧の中の位置を示す', () => {
    expect(helpItemMovedAnnouncement('ログインできない', 3)).toBe(
      'ログインできないを3番目に移動しました。',
    );
  });
});

describe('カテゴリの削除の確認の文言', () => {
  test('付け替わる記事の件数を3桁区切りで示し、「その他」の末尾に並ぶ旨を添える', () => {
    expect(helpCategoryDeleteDescription(1234)).toBe(
      '付け替わる記事は1,234件です。付け替えた記事は「その他」の末尾に並びます。',
    );
    expect(helpCategoryDeleteDescription(0)).toBe(
      '付け替わる記事は0件です。付け替えた記事は「その他」の末尾に並びます。',
    );
  });
});
