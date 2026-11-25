import { describe, expect, test } from 'bun:test';

import { MODERATION_ACTIONS } from '../../../../common-lib/moderation/moderation-actions.ts';
import {
  MODERATION_OPERATIONS,
  moderationActionOf,
} from './moderation-operations.ts';

describe('moderationActionOf', () => {
  test('公開拒否は画像の削除の措置で行う', () => {
    expect(moderationActionOf('image.reject')).toBe('image.delete');
  });

  test.each(MODERATION_ACTIONS)('措置%sはその措置のまま行う', (action) => {
    expect(moderationActionOf(action)).toBe(action);
  });

  test('操作の一覧は13の措置の後に公開拒否を持つ', () => {
    expect(MODERATION_OPERATIONS).toStrictEqual([
      ...MODERATION_ACTIONS,
      'image.reject',
    ]);
  });
});
