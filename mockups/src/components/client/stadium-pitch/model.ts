export type Side = 'left' | 'right';

export type PitchProps = {
  leftVotes: number;
  rightVotes: number;
  leftColors: [string, string];
  rightColors: [string, string];
  excited?: Side | null;
  finishedWinner?: Side | 'none' | null;
  deserted?: boolean;
  orientation: 'horizontal' | 'vertical';
  className?: string;
};

export type OrientedPitchProps = Omit<PitchProps, 'orientation'>;

export type CrowdProps = {
  side: Side;
  count: number;
  color: string;
  excited: boolean;
  still: boolean;
};

export type GoalProps = { side: Side };

const MAX_DOTS = 400;
// ゴール裏は6列であるため、その最大数は6の倍数にする
const GOAL_STAND_DOTS = Math.round(MAX_DOTS / 6 / 2.4) * 6;
// ゴール裏から溢れた分は2つのサイドスタンドへ交互に振り分けるため、1スタンドあたりの上限はその半分
export const SIDE_STAND_DOTS = (MAX_DOTS - GOAL_STAND_DOTS) / 2;

export type CrowdCell = { row: number; col: number; index: number };

export function crowdCells(count: number, rows: number) {
  const n = Math.min(Math.max(count, 0), GOAL_STAND_DOTS);
  const cols = Math.max(1, Math.ceil(n / rows));
  const cells: CrowdCell[] = Array.from({ length: n }, (_, i) => ({
    row: i % rows,
    col: Math.floor(i / rows),
    index: i,
  }));
  return { cells, cols };
}

// ゴール裏に収まらない観客を2つのサイドスタンドへ交互に振り分ける。colはゴール裏に近い端から数えた席の列
export function sideStandCells(
  count: number,
  rows: number,
): [CrowdCell[], CrowdCell[]] {
  const overflow = Math.max(0, Math.min(count, MAX_DOTS) - GOAL_STAND_DOTS);
  const cellAt = (k: number): CrowdCell => {
    const seat = Math.floor(k / 2);
    return {
      row: seat % rows,
      col: Math.floor(seat / rows),
      index: GOAL_STAND_DOTS + k,
    };
  };
  const all = Array.from({ length: overflow }, (_, k) => cellAt(k));
  return [all.filter((_, k) => k % 2 === 0), all.filter((_, k) => k % 2 === 1)];
}

// 隣接する観客のジャンプ開始が連鎖して見えないよう、sin波の小数部を擬似乱数として遅延に使う
export function dotDelay(index: number) {
  const noise = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  const fraction = noise - Math.floor(noise);
  return `${fraction.toFixed(2)}s`;
}
