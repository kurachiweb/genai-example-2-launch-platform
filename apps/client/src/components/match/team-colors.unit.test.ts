import { describe, expect, test } from 'bun:test';

import {
  TEAM_COLOR_COUNT,
  UNLINKED_TEAM_COLOR_INDEX,
} from '../../../common-lib/match/team-colors.ts';
import { TEAM_COLORS, teamColorsOf } from './team-colors.ts';

const MOCKUP_TEAM_COLORS: (readonly [string, string])[] = [
  ['#1d4ed8', '#f59e0b'],
  ['#0f766e', '#fb7185'],
  ['#7c3aed', '#22d3ee'],
  ['#be123c', '#fbbf24'],
  ['#0369a1', '#a3e635'],
  ['#c2410c', '#0ea5e9'],
  ['#4d7c0f', '#f472b6'],
  ['#0e7490', '#f97316'],
  ['#9333ea', '#facc15'],
  ['#b45309', '#2dd4bf'],
  ['#1e3a8a', '#f43f5e'],
  ['#065f46', '#fb923c'],
];

describe('TEAM_COLORS', () => {
  test('中立の0とプロダクトに割り当てる1〜配色の数の番号ごとに2色を持つ', () => {
    expect(TEAM_COLORS).toHaveLength(TEAM_COLOR_COUNT + 1);
    for (const colors of TEAM_COLORS) {
      expect(colors).toHaveLength(2);
      expect(colors[0]).not.toBe(colors[1]);
    }
  });

  test('1〜配色の数の番号は、デザイン案の配色の一覧の主色と副色を順に持つ', () => {
    expect(TEAM_COLORS.slice(1)).toStrictEqual(MOCKUP_TEAM_COLORS);
  });

  test('紐付けを解除した側の中立の配色はデザイントークンから取る', () => {
    expect(TEAM_COLORS[UNLINKED_TEAM_COLOR_INDEX]).toStrictEqual([
      'var(--crowd)',
      'var(--stand-rim)',
    ]);
  });
});

describe('teamColorsOf', () => {
  test('配色の番号に対応する2色を返す', () => {
    expect(teamColorsOf(1)).toStrictEqual(['#1d4ed8', '#f59e0b']);
    expect(teamColorsOf(TEAM_COLOR_COUNT)).toStrictEqual([
      '#065f46',
      '#fb923c',
    ]);
    expect(teamColorsOf(UNLINKED_TEAM_COLOR_INDEX)).toStrictEqual([
      'var(--crowd)',
      'var(--stand-rim)',
    ]);
  });

  test.each([-1, TEAM_COLOR_COUNT + 1, 1.5, Number.NaN])(
    '範囲外や整数でない番号(%p)は中立の配色にする',
    (colorIndex) => {
      expect(teamColorsOf(colorIndex)).toStrictEqual([
        'var(--crowd)',
        'var(--stand-rim)',
      ]);
    },
  );
});
