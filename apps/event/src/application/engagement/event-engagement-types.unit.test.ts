import { describe, expect, test } from 'bun:test';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import { EVENT_ENGAGEMENT_TYPES } from './event-engagement-types.ts';

describe('EVENT_ENGAGEMENT_TYPES', () => {
  test('利用者とプロダクトの物理削除の時期の処理の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_ENGAGEMENT_TYPES).toSorted()).toStrictEqual([
      'AccountErasureHandler',
      'ProductErasureHandler',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のengagement.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries<symbol>(
      EVENT_ENGAGEMENT_TYPES,
    )) {
      expect<symbol>(identifier).toBe(Symbol.for(`engagement.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(ENGAGEMENT_PLATFORM_TYPES));

    expect(
      Object.values<symbol>(EVENT_ENGAGEMENT_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_ENGAGEMENT_TYPES)).toBe(true);
  });
});
