import { describe, expect, test } from 'bun:test';

import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import { EVENT_ULTRAS_TYPES } from './event-ultras-types.ts';

const EXPECTED_NAMES = [
  'RunActivationHandlersHandler',
  'SubscriptionCancellationHandler',
  'SubscriptionErasureHandler',
  'UltrasAccountDataEraser',
] as const;

describe('EVENT_ULTRAS_TYPES', () => {
  test('加入が有効になった知らせの処理・退会と停止の解約と物理削除の波及処理・削除の書き込みの単位の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_ULTRAS_TYPES)).toEqual([...EXPECTED_NAMES]);
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のultras.<名前>である',
    (name) => {
      expect<symbol>(EVENT_ULTRAS_TYPES[name]).toBe(
        Symbol.for(`ultras.${name}`),
      );
    },
  );

  test('同じultras.の接頭辞を使う共通の識別子とメンバーの名前が重ならない', () => {
    const shared = new Set(Object.keys(ULTRAS_TYPES));

    expect(
      Object.keys(EVENT_ULTRAS_TYPES).filter((name) => shared.has(name)),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_ULTRAS_TYPES)).toBe(true);
  });
});
