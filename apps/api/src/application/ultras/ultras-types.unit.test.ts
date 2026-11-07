import { describe, expect, test } from 'bun:test';

import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import { API_ULTRAS_TYPES } from './ultras-types.ts';

const EXPECTED_NAMES = [
  'UltrasPlanReader',
  'UltrasCheckout',
  'PortalSessionStarter',
  'PortalSessionLimits',
] as const;

describe('API_ULTRAS_TYPES', () => {
  test('料金とプランの照会、加入の開始、Customer Portalのセッションの作成とその回数制限の識別子だけを持つ', () => {
    expect(Object.keys(API_ULTRAS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のultras.<名前>である',
    (name) => {
      expect<symbol>(API_ULTRAS_TYPES[name]).toBe(Symbol.for(`ultras.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(API_ULTRAS_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('同じultras.の接頭辞を使う共通の識別子とメンバーの名前が重ならない', () => {
    const shared = new Set(Object.keys(ULTRAS_TYPES));

    expect(
      Object.keys(API_ULTRAS_TYPES).filter((name) => shared.has(name)),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(API_ULTRAS_TYPES)).toBe(true);
  });
});
