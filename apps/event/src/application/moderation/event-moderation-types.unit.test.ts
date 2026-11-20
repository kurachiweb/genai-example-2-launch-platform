import { describe, expect, test } from 'bun:test';

import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import { EVENT_MODERATION_TYPES } from './event-moderation-types.ts';

describe('EVENT_MODERATION_TYPES', () => {
  test('利用者とプロダクトの物理削除の時期の処理の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_MODERATION_TYPES).toSorted()).toStrictEqual([
      'AccountRecordErasureHandler',
      'ProductRecordErasureHandler',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のmoderation.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries<symbol>(
      EVENT_MODERATION_TYPES,
    )) {
      expect<symbol>(identifier).toBe(Symbol.for(`moderation.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(MODERATION_PLATFORM_TYPES));

    expect(
      Object.values<symbol>(EVENT_MODERATION_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_MODERATION_TYPES)).toBe(true);
  });
});
