import type { CSSProperties } from 'react';
import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import {
  crowdCells,
  crowdCountOf,
  crowdRowsOf,
  dotDelay,
  isCrowdStill,
  pointsOf,
  secondsOf,
  SIDE_STAND_DOTS,
  sideStandCells,
} from './pitch-model.ts';
import type {
  CrowdProps,
  OrientedPitchProps,
  PitchPoint,
  PitchSide,
} from './pitch-model.ts';

// topはピッチ中央ではなく、旗の先端から手前のスタンドの奥端までの全体がviewBoxの上下中央に来るよう決めている。
// sliceで上下が切り取られる際に、旗か手前のスタンドのどちらかだけが先に欠けないようにするため
const H = {
  cx: 600,
  top: 128,
  height: 230,
  wFar: 600,
  wGrow: 220,
} as const;

// サイドスタンドの座席列(v座標)。ピッチに近い列から順に埋める
const SIDE_STAND_ROWS = [
  [-0.14, -0.2, -0.26, -0.32],
  [1.12, 1.18, 1.24, 1.3],
] as const;
// 遠いスタンドの奥端には旗を立てるため、跳ねる最後列の観客とポールが被らないよう1列分より広く取る
const FAR_STAND_BACK = -0.4;
const NEAR_STAND_BACK = 1.36;
// 片側のチームが使えるサイドスタンドの長さ(u座標)。ハーフウェイラインの手前で相手側と分け合う
const SIDE_STAND_LENGTH = 0.58;
// ピッチ中央と同じ奥行きにいる観客の半径。遠近に応じて奥側は小さく、手前側は大きく描く
const CROWD_DOT_RADIUS = 4;
const FLAG_COUNT = 12;
const STRIPES = Array.from({ length: 10 }, (_, i) => i);
const FLOODLIGHTS = [
  [-0.18, -0.24],
  [1.18, -0.24],
  [-0.22, 1.3],
  [1.22, 1.3],
] as const;

function px(u: number, v: number): PitchPoint {
  const width = H.wFar + H.wGrow * v;
  return [H.cx + (u - 0.5) * width, H.top + v * H.height];
}

// ピッチ中央(v=0.5)を基準にした遠近の拡大率。ピッチの幅の広がりと同じ比率にする
function perspectiveScale(v: number): number {
  return (H.wFar + H.wGrow * v) / (H.wFar + H.wGrow * 0.5);
}

function hline(u0: number, u1: number, v: number): string {
  return pointsOf([px(u0, v), px(u1, v)]);
}

function quad(u0: number, v0: number, u1: number, v1: number): string {
  return pointsOf([px(u0, v0), px(u1, v0), px(u1, v1), px(u0, v1)]);
}

export function HorizontalPitch({
  leftVotes,
  rightVotes,
  leftColors,
  rightColors,
  excited = null,
  finishedWinner = null,
  isDeserted = false,
  className,
}: OrientedPitchProps) {
  const id = useId();
  const floodGlowId = `${id}-flood-glow`;
  const skyFadeId = `${id}-sky-fade`;
  const [centerX, centerY] = px(0.5, 0.5);
  const [halfwayTopX, halfwayTopY] = px(0.5, 0);
  const [halfwayBottomX, halfwayBottomY] = px(0.5, 1);

  const crowdOf = (side: PitchSide, votes: number, color: string) => (
    <HorizontalCrowd
      side={side}
      count={crowdCountOf(votes, isDeserted)}
      color={color}
      isExcited={excited === side}
      isStill={isCrowdStill(side, finishedWinner)}
    />
  );

  return (
    <svg
      viewBox="0 0 1200 450"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={cn('block h-full w-full', className)}
    >
      <defs>
        <radialGradient id={floodGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--flood)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id={skyFadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sky-glow)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <rect width="1200" height="450" fill={`url(#${skyFadeId})`} />

      <polygon
        points={quad(-0.12, FAR_STAND_BACK, 1.12, -0.06)}
        fill="var(--stand-base)"
      />
      <polygon
        points={quad(-0.12, 1.06, 1.12, NEAR_STAND_BACK)}
        fill="var(--stand-base)"
      />
      <polygon
        points={quad(-0.2, -0.06, -0.04, 1.06)}
        fill="var(--stand-base)"
      />
      <polygon points={quad(1.04, -0.06, 1.2, 1.06)} fill="var(--stand-base)" />
      {SIDE_STAND_ROWS.flat().map((v) => (
        <polyline
          key={v}
          points={hline(-0.12, 1.12, v)}
          fill="none"
          stroke="var(--stand-step)"
          strokeWidth="2"
        />
      ))}
      <polygon
        points={quad(-0.12, -0.06, 1.12, -0.03)}
        fill="var(--stand-rim)"
      />
      <polygon points={quad(-0.12, 1.03, 1.12, 1.06)} fill="var(--stand-rim)" />

      {STRIPES.map((i) => (
        <polygon
          key={i}
          points={quad(i / 10, 0, (i + 1) / 10, 1)}
          fill={i % 2 === 0 ? 'var(--pitch-a)' : 'var(--pitch-b)'}
        />
      ))}
      <g
        fill="none"
        stroke="var(--pitch-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      >
        <polygon points={quad(0, 0, 1, 1)} />
        <line
          x1={halfwayTopX}
          y1={halfwayTopY}
          x2={halfwayBottomX}
          y2={halfwayBottomY}
        />
        <ellipse cx={centerX} cy={centerY} rx="62" ry="31" />
        <polygon points={quad(0, 0.2, 0.157, 0.8)} />
        <polygon points={quad(0.843, 0.2, 1, 0.8)} />
        <polygon points={quad(0, 0.36, 0.052, 0.64)} />
        <polygon points={quad(0.948, 0.36, 1, 0.64)} />
      </g>
      <circle cx={centerX} cy={centerY} r="3" fill="var(--pitch-line)" />

      {!isDeserted &&
        Array.from({ length: FLAG_COUNT }, (_, i) => {
          const u = 0.02 + i * 0.087;
          const colors = u < 0.5 ? leftColors : rightColors;
          const [x, y] = px(u, FAR_STAND_BACK);
          return (
            <g key={i} transform={`translate(${String(x)} ${String(y)})`}>
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="-26"
                stroke="var(--stand-rim)"
                strokeWidth="2"
              />
              <path
                data-pitch-flag=""
                style={
                  { '--flag-delay': secondsOf((i % 4) * 0.35) } as CSSProperties
                }
                d="M0 -26 h22 l-5 7 l5 7 h-22z"
                fill={colors[i % 2]}
              />
            </g>
          );
        })}

      {FLOODLIGHTS.map(([u, v], i) => {
        const [x, y] = px(u, v);
        return (
          <g key={pointsOf([[u, v]])}>
            <line
              x1={x}
              y1={y + 40}
              x2={x}
              y2={y - 40}
              stroke="var(--stand-rim)"
              strokeWidth="4"
            />
            <rect
              x={x - 12}
              y={y - 52}
              width="24"
              height="14"
              rx="3"
              fill="var(--stand-rim)"
            />
            <circle
              data-pitch-floodlight=""
              style={{ '--flood-delay': secondsOf(i * 0.9) } as CSSProperties}
              cx={x}
              cy={y - 45}
              r="120"
              fill={`url(#${floodGlowId})`}
            />
          </g>
        );
      })}

      {crowdOf('left', leftVotes, leftColors[0])}
      {crowdOf('right', rightVotes, rightColors[0])}

      <HorizontalGoal side="left" />
      <HorizontalGoal side="right" />
    </svg>
  );
}

function HorizontalCrowd({
  side,
  count,
  color,
  isExcited,
  isStill,
}: CrowdProps) {
  const rows = crowdRowsOf(count);
  const { cells, cols } = crowdCells(count, rows);
  const uStart = side === 'left' ? -0.055 : 1.055;
  const uDir = side === 'left' ? -1 : 1;
  const uStep = 0.026;
  const vStep = 1 / Math.max(cols, 8);
  const vStart = 0.5 - (cols * vStep) / 2 + vStep / 2;

  const sideStands = sideStandCells(count, SIDE_STAND_ROWS[0].length);
  const sideUStart = side === 'left' ? -0.1 : 1.1;
  const sideUStep =
    SIDE_STAND_LENGTH / Math.ceil(SIDE_STAND_DOTS / SIDE_STAND_ROWS[0].length);

  const dot = (index: number, u: number, v: number) => {
    const [x, y] = px(u, v);
    return (
      <circle
        key={index}
        data-pitch-crowd-dot={isStill ? undefined : ''}
        style={{ '--jump-delay': dotDelay(index) } as CSSProperties}
        cx={x}
        cy={y}
        r={CROWD_DOT_RADIUS * perspectiveScale(v)}
        fill={color}
        opacity={0.9}
      />
    );
  };

  return (
    <g data-pitch-crowd={side} data-excited={isExcited ? 'true' : 'false'}>
      {cells.map(({ row, col, index }) =>
        dot(index, uStart + uDir * row * uStep, vStart + col * vStep),
      )}
      {sideStands.map((standCells, stand) =>
        standCells.map(({ row, col, index }) =>
          dot(
            index,
            sideUStart - uDir * col * sideUStep,
            SIDE_STAND_ROWS[stand]?.[row] ?? 0,
          ),
        ),
      )}
    </g>
  );
}

function HorizontalGoal({ side }: { readonly side: PitchSide }) {
  const u0 = side === 'left' ? -0.035 : 1;
  const u1 = side === 'left' ? 0 : 1.035;
  const a = px(u0, 0.4);
  const b = px(u1, 0.4);
  const c = px(u1, 0.6);
  const d = px(u0, 0.6);
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const [dx, dy] = d;
  const mouth = pointsOf(side === 'left' ? [b, a, d, c] : [a, a, d, d]);
  return (
    <g>
      <polygon
        points={pointsOf([a, b, c, d])}
        fill="var(--net)"
        opacity="0.5"
      />
      <g stroke="var(--net)" strokeWidth="1" opacity="0.8">
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={ax + (dx - ax) * t}
            y1={ay + (dy - ay) * t}
            x2={bx + (cx - bx) * t}
            y2={by + (cy - by) * t}
          />
        ))}
        {[0.33, 0.66].map((t) => (
          <line
            key={t}
            x1={ax + (bx - ax) * t}
            y1={ay + (by - ay) * t}
            x2={dx + (cx - dx) * t}
            y2={dy + (cy - dy) * t}
          />
        ))}
      </g>
      <polyline
        points={mouth}
        fill="none"
        stroke="var(--pitch-line)"
        strokeWidth="3"
      />
    </g>
  );
}
