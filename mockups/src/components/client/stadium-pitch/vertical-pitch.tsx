import { cn } from '#/lib/utils';
import { crowdCells, dotDelay, SIDE_STAND_DOTS, sideStandCells } from './model';
import type { CrowdProps, GoalProps, OrientedPitchProps } from './model';

/* ---------- 縦向きの真上からの図(モバイル) ---------- */

const V = { x0: 60, x1: 360, y0: 84, y1: 456 };

export function VerticalPitch(props: OrientedPitchProps) {
  const {
    leftVotes,
    rightVotes,
    leftColors,
    rightColors,
    excited,
    finishedWinner,
    deserted,
    className,
  } = props;
  const cx = (V.x0 + V.x1) / 2;
  const w = V.x1 - V.x0;
  const h = V.y1 - V.y0;

  return (
    <svg
      viewBox="0 0 420 540"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn('block h-full w-full', className)}
    >
      <rect width="420" height="540" fill="var(--stand-base)" />
      {/* サイドスタンドの座席列 */}
      {[16, 30, 44].map((x) => (
        <g key={x} stroke="var(--stand-step)" strokeWidth="2">
          <line x1={x} y1={V.y0} x2={x} y2={V.y1} />
          <line x1={420 - x} y1={V.y0} x2={420 - x} y2={V.y1} />
        </g>
      ))}
      <rect
        x={V.x0 - 14}
        y={V.y0 - 14}
        width={w + 28}
        height={h + 28}
        fill="var(--stand-rim)"
      />

      {Array.from({ length: 10 }, (_, i) => (
        <rect
          key={i}
          x={V.x0}
          y={V.y0 + (h / 10) * i}
          width={w}
          height={h / 10}
          fill={i % 2 === 0 ? 'var(--pitch-a)' : 'var(--pitch-b)'}
        />
      ))}
      <g fill="none" stroke="var(--pitch-line)" strokeWidth="2.5">
        <rect x={V.x0} y={V.y0} width={w} height={h} />
        <line
          x1={V.x0}
          y1={(V.y0 + V.y1) / 2}
          x2={V.x1}
          y2={(V.y0 + V.y1) / 2}
        />
        <circle cx={cx} cy={(V.y0 + V.y1) / 2} r="44" />
        <rect x={cx - w * 0.3} y={V.y0} width={w * 0.6} height={h * 0.157} />
        <rect
          x={cx - w * 0.3}
          y={V.y1 - h * 0.157}
          width={w * 0.6}
          height={h * 0.157}
        />
        <rect x={cx - w * 0.14} y={V.y0} width={w * 0.28} height={h * 0.052} />
        <rect
          x={cx - w * 0.14}
          y={V.y1 - h * 0.052}
          width={w * 0.28}
          height={h * 0.052}
        />
      </g>
      <circle cx={cx} cy={(V.y0 + V.y1) / 2} r="3" fill="var(--pitch-line)" />

      {/* ナイター照明 */}
      {[
        [30, 60],
        [390, 60],
        [30, 480],
        [390, 480],
      ].map(([x, y], i) => (
        <circle
          key={i}
          className="floodlight"
          style={{ '--flood-delay': `${i * 0.9}s` } as React.CSSProperties}
          cx={x}
          cy={y}
          r="100"
          fill="url(#flood-glow)"
        />
      ))}

      <VerticalCrowd
        side="left"
        count={deserted ? 0 : leftVotes + 1}
        color={leftColors[0]}
        excited={excited === 'left'}
        still={finishedWinner != null && finishedWinner !== 'left'}
      />
      <VerticalCrowd
        side="right"
        count={deserted ? 0 : rightVotes + 1}
        color={rightColors[0]}
        excited={excited === 'right'}
        still={finishedWinner != null && finishedWinner !== 'right'}
      />

      <VerticalGoal side="left" />
      <VerticalGoal side="right" />
    </svg>
  );
}

// 左サイドスタンドの座席列(x座標)。ピッチに近い列から順に埋め、右サイドは左右反転で配置する
const V_SIDE_STAND_ROWS = [40, 30, 20, 10] as const;
// 片側チームが使えるサイドスタンドの長さ(y座標)。ハーフウェイライン手前で相手側と分け合う
const V_SIDE_STAND_LENGTH = (V.y1 - V.y0) / 2 - 12;

function VerticalCrowd({ side, count, color, excited, still }: CrowdProps) {
  const rows = count > 60 ? 6 : count > 20 ? 4 : 3;
  const { cells, cols } = crowdCells(count, rows);
  const xStep = 300 / Math.max(cols, 8);
  const xStart = 210 - (cols * xStep) / 2 + xStep / 2;
  const yStart = side === 'left' ? 62 : 478;
  const yDir = side === 'left' ? -1 : 1;

  const sideStands = sideStandCells(count, V_SIDE_STAND_ROWS.length);
  const sideYStart = side === 'left' ? V.y0 + 6 : V.y1 - 6;
  const sideYStep =
    V_SIDE_STAND_LENGTH / Math.ceil(SIDE_STAND_DOTS / V_SIDE_STAND_ROWS.length);

  const dot = (index: number, x: number, y: number, r: number) => (
    <circle
      key={index}
      className={cn(!still && 'crowd-dot')}
      style={{ '--jump-delay': dotDelay(index) } as React.CSSProperties}
      cx={x}
      cy={y}
      r={r}
      fill={color}
      opacity={0.9}
    />
  );

  return (
    <g
      className="crowd-side"
      data-excited={excited ? 'true' : 'false'}
      data-still={still ? 'true' : 'false'}
    >
      {cells.map(({ row, col, index }) =>
        dot(
          index,
          xStart + col * xStep,
          yStart + yDir * row * 10,
          Math.max(3.6, 6.9 - rows * 0.525),
        ),
      )}
      {sideStands.map((standCells, stand) =>
        standCells.map(({ row, col, index }) => {
          const x =
            stand === 0 ? V_SIDE_STAND_ROWS[row] : 420 - V_SIDE_STAND_ROWS[row];
          return dot(index, x, sideYStart - yDir * col * sideYStep, 3.2);
        }),
      )}
    </g>
  );
}

function VerticalGoal({ side }: GoalProps) {
  const cx = (V.x0 + V.x1) / 2;
  const y = side === 'left' ? V.y0 - 16 : V.y1;
  return (
    <g>
      <rect
        x={cx - 40}
        y={y}
        width="80"
        height="16"
        fill="var(--net)"
        opacity="0.5"
      />
      <g stroke="var(--net)" strokeWidth="1" opacity="0.8">
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={cx - 40}
            y1={y + 16 * t}
            x2={cx + 40}
            y2={y + 16 * t}
          />
        ))}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1={cx - 40 + 80 * t}
            y1={y}
            x2={cx - 40 + 80 * t}
            y2={y + 16}
          />
        ))}
      </g>
      <polyline
        points={
          side === 'left'
            ? `${cx - 40},${y + 16} ${cx - 40},${y} ${cx + 40},${y} ${cx + 40},${y + 16}`
            : `${cx - 40},${y} ${cx - 40},${y + 16} ${cx + 40},${y + 16} ${cx + 40},${y}`
        }
        fill="none"
        stroke="var(--pitch-line)"
        strokeWidth="3"
      />
    </g>
  );
}
