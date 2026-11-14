import {
  TEAM_COLOR_COUNT,
  UNLINKED_TEAM_COLOR_INDEX,
} from '../../../common-lib/match/team-colors.ts';

export type TeamColorPair = readonly [primary: string, secondary: string];

// 番号はcommon-libの配色の番号に合わせ、0を紐付けを解除した側の中立の配色、1〜TEAM_COLOR_COUNTをプロダクトの配色にする
export const TEAM_COLORS: readonly TeamColorPair[] = Object.freeze([
  ['var(--crowd)', 'var(--stand-rim)'],
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
] as const);

const UNLINKED_TEAM_COLORS = TEAM_COLORS[
  UNLINKED_TEAM_COLOR_INDEX
] as TeamColorPair;

export function teamColorsOf(colorIndex: number): TeamColorPair {
  const isAssigned =
    Number.isInteger(colorIndex) &&
    colorIndex >= UNLINKED_TEAM_COLOR_INDEX &&
    colorIndex <= TEAM_COLOR_COUNT;
  return isAssigned
    ? (TEAM_COLORS[colorIndex] as TeamColorPair)
    : UNLINKED_TEAM_COLORS;
}
