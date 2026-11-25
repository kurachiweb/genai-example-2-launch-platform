import { describe, expect, test } from 'bun:test';

import { weekBracketPathOf } from './week-bracket-path.ts';

describe('weekBracketPathOf', () => {
  test('週の初日からISO週のブラケットのページへのパスを作る', () => {
    expect(weekBracketPathOf('2026-09-07')).toBe('/tournaments/week/2026-W37');
  });

  test('年をまたぐ週はISO週の年のパスにする', () => {
    expect(weekBracketPathOf('2025-12-29')).toBe('/tournaments/week/2026-W01');
  });
});
