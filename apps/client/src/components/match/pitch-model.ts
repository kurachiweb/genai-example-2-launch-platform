import type { TeamColorPair } from './team-colors.ts';

export type PitchSide = 'left' | 'right';

export type PitchOrientation = 'horizontal' | 'vertical';

export type PitchWinner = PitchSide | 'none';

export type PitchProps = {
  readonly orientation: PitchOrientation;
  readonly leftVotes: number;
  readonly rightVotes: number;
  readonly leftColors: TeamColorPair;
  readonly rightColors: TeamColorPair;
  readonly excited?: PitchSide | null;
  readonly finishedWinner?: PitchWinner | null;
  readonly isDeserted?: boolean;
  readonly className?: string;
};

export type OrientedPitchProps = Omit<PitchProps, 'orientation'>;

export type CrowdProps = {
  readonly side: PitchSide;
  readonly count: number;
  readonly color: string;
  readonly isExcited: boolean;
  readonly isStill: boolean;
};

export type CrowdCell = {
  readonly row: number;
  readonly col: number;
  readonly index: number;
};

export const MAX_CROWD_DOTS = 400;
// ゴール裏は6列であるため、その最大数は6の倍数にする
export const GOAL_STAND_DOTS = Math.round(MAX_CROWD_DOTS / 6 / 2.4) * 6;
// ゴール裏から溢れた分は2つのサイドスタンドへ交互に振り分けるため、1スタンドあたりの上限はその半分
export const SIDE_STAND_DOTS = (MAX_CROWD_DOTS - GOAL_STAND_DOTS) / 2;

const MANY_CROWD = 60;
const SOME_CROWD = 20;

export function crowdCountOf(votes: number, isDeserted: boolean): number {
  return isDeserted ? 0 : votes + 1;
}

export function crowdRowsOf(count: number): number {
  if (count > MANY_CROWD) {
    return 6;
  }
  return count > SOME_CROWD ? 4 : 3;
}

export function isCrowdStill(
  side: PitchSide,
  finishedWinner: PitchWinner | null | undefined,
): boolean {
  return finishedWinner != null && finishedWinner !== side;
}

export function crowdCells(
  count: number,
  rows: number,
): { readonly cells: readonly CrowdCell[]; readonly cols: number } {
  const seated = Math.min(Math.max(count, 0), GOAL_STAND_DOTS);
  const cols = Math.max(1, Math.ceil(seated / rows));
  const cells = Array.from({ length: seated }, (_, index) => ({
    row: index % rows,
    col: Math.floor(index / rows),
    index,
  }));
  return { cells, cols };
}

// ゴール裏に収まらない観客を2つのサイドスタンドへ交互に振り分ける。colはゴール裏に近い端から数えた席の列
export function sideStandCells(
  count: number,
  rows: number,
): readonly [readonly CrowdCell[], readonly CrowdCell[]] {
  const overflow = Math.max(
    0,
    Math.min(count, MAX_CROWD_DOTS) - GOAL_STAND_DOTS,
  );
  const cells = Array.from({ length: overflow }, (_, order) => {
    const seat = Math.floor(order / 2);
    return {
      row: seat % rows,
      col: Math.floor(seat / rows),
      index: GOAL_STAND_DOTS + order,
    };
  });
  return [
    cells.filter((_, order) => order % 2 === 0),
    cells.filter((_, order) => order % 2 === 1),
  ];
}

// 隣接する観客のジャンプ開始が連鎖して見えないよう、sin波の小数部を擬似乱数として遅延に使う
export function dotDelay(index: number): string {
  const noise = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  const fraction = noise - Math.floor(noise);
  return `${fraction.toFixed(2)}s`;
}

export type PitchPoint = readonly [x: number, y: number];

export function pointsOf(points: readonly PitchPoint[]): string {
  return points.map((point) => point.join(',')).join(' ');
}

export function secondsOf(value: number): string {
  return `${String(value)}s`;
}
