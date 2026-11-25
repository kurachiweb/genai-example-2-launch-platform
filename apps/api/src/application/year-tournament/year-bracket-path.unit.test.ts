import { describe, expect, test } from 'bun:test';

import { yearBracketPathOf } from './year-bracket-path.ts';

describe('yearBracketPathOf', () => {
  test('対象年からブラケットのページへのパスを作る', () => {
    expect(yearBracketPathOf(2027)).toBe('/tournaments/year/2027');
  });
});
