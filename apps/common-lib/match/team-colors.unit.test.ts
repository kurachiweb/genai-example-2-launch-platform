import { describe, expect, test } from 'bun:test';

import {
  TEAM_COLOR_COUNT,
  UNLINKED_TEAM_COLOR_INDEX,
  teamColorIndexOf,
} from './team-colors.ts';

const productIdOf = (index: number): string =>
  `01JF0PRODUCT${String(index).padStart(14, '0')}`;

describe('teamColorIndexOf', () => {
  test('同じプロダクトのIDには常に同じ配色の番号を返す', () => {
    expect(teamColorIndexOf(productIdOf(7))).toBe(
      teamColorIndexOf(productIdOf(7)),
    );
  });

  test('プロダクトの配色の番号は1から配色の数までの整数になる', () => {
    const indexes = Array.from({ length: 200 }, (_, index) =>
      teamColorIndexOf(productIdOf(index)),
    );

    for (const index of indexes) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(TEAM_COLOR_COUNT);
    }
  });

  test('プロダクトのIDが違えば配色を散らし、全ての配色の番号を使う', () => {
    const indexes = new Set(
      Array.from({ length: 200 }, (_, index) =>
        teamColorIndexOf(productIdOf(index)),
      ),
    );

    expect(indexes.size).toBe(TEAM_COLOR_COUNT);
  });

  test('紐付けを解除した側(プロダクトのIDが無い)は0を返す', () => {
    expect(UNLINKED_TEAM_COLOR_INDEX).toBe(0);
    expect(teamColorIndexOf(null)).toBe(UNLINKED_TEAM_COLOR_INDEX);
  });
});
