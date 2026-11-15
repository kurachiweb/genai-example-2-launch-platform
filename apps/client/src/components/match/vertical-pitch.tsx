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
  PitchSide,
} from './pitch-model.ts';

const V = { x0: 60, x1: 360, y0: 84, y1: 456 } as const;
const VIEW_WIDTH = 420;
const CENTER_X = (V.x0 + V.x1) / 2;
const CENTER_Y = (V.y0 + V.y1) / 2;
const PITCH_WIDTH = V.x1 - V.x0;
const PITCH_HEIGHT = V.y1 - V.y0;
const STRIPES = Array.from({ length: 10 }, (_, i) => i);
const STAND_STEPS = [16, 30, 44] as const;
const FLOODLIGHTS = [
  [30, 60],
  [390, 60],
  [30, 480],
  [390, 480],
] as const;

// 左のサイドスタンドの座席列(x座標)。ピッチに近い列から順に埋め、右のサイドスタンドは左右反転で配置する
const SIDE_STAND_ROWS = [40, 30, 20, 10] as const;
// 片側のチームが使えるサイドスタンドの長さ(y座標)。ハーフウェイラインの手前で相手側と分け合う
const SIDE_STAND_LENGTH = PITCH_HEIGHT / 2 - 12;

export function VerticalPitch({
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

  const crowdOf = (side: PitchSide, votes: number, color: string) => (
    <VerticalCrowd
      side={side}
      count={crowdCountOf(votes, isDeserted)}
      color={color}
      isExcited={excited === side}
      isStill={isCrowdStill(side, finishedWinner)}
    />
  );

  return (
    <svg
      viewBox="0 0 420 540"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn('block h-full w-full', className)}
    >
      <defs>
        <radialGradient id={floodGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--flood)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="420" height="540" fill="var(--stand-base)" />
      {STAND_STEPS.map((x) => (
        <g key={x} stroke="var(--stand-step)" strokeWidth="2">
          <line x1={x} y1={V.y0} x2={x} y2={V.y1} />
          <line x1={VIEW_WIDTH - x} y1={V.y0} x2={VIEW_WIDTH - x} y2={V.y1} />
        </g>
      ))}
      <rect
        x={V.x0 - 14}
        y={V.y0 - 14}
        width={PITCH_WIDTH + 28}
        height={PITCH_HEIGHT + 28}
        fill="var(--stand-rim)"
      />

      {STRIPES.map((i) => (
        <rect
          key={i}
          x={V.x0}
          y={V.y0 + (PITCH_HEIGHT / 10) * i}
          width={PITCH_WIDTH}
          height={PITCH_HEIGHT / 10}
          fill={i % 2 === 0 ? 'var(--pitch-a)' : 'var(--pitch-b)'}
        />
      ))}
      <g fill="none" stroke="var(--pitch-line)" strokeWidth="2.5">
        <rect x={V.x0} y={V.y0} width={PITCH_WIDTH} height={PITCH_HEIGHT} />
        <line x1={V.x0} y1={CENTER_Y} x2={V.x1} y2={CENTER_Y} />
        <circle cx={CENTER_X} cy={CENTER_Y} r="44" />
        <rect
          x={CENTER_X - PITCH_WIDTH * 0.3}
          y={V.y0}
          width={PITCH_WIDTH * 0.6}
          height={PITCH_HEIGHT * 0.157}
        />
        <rect
          x={CENTER_X - PITCH_WIDTH * 0.3}
          y={V.y1 - PITCH_HEIGHT * 0.157}
          width={PITCH_WIDTH * 0.6}
          height={PITCH_HEIGHT * 0.157}
        />
        <rect
          x={CENTER_X - PITCH_WIDTH * 0.14}
          y={V.y0}
          width={PITCH_WIDTH * 0.28}
          height={PITCH_HEIGHT * 0.052}
        />
        <rect
          x={CENTER_X - PITCH_WIDTH * 0.14}
          y={V.y1 - PITCH_HEIGHT * 0.052}
          width={PITCH_WIDTH * 0.28}
          height={PITCH_HEIGHT * 0.052}
        />
      </g>
      <circle cx={CENTER_X} cy={CENTER_Y} r="3" fill="var(--pitch-line)" />

      {FLOODLIGHTS.map(([x, y], i) => (
        <circle
          key={pointsOf([[x, y]])}
          data-pitch-floodlight=""
          style={{ '--flood-delay': secondsOf(i * 0.9) } as CSSProperties}
          cx={x}
          cy={y}
          r="100"
          fill={`url(#${floodGlowId})`}
        />
      ))}

      {crowdOf('left', leftVotes, leftColors[0])}
      {crowdOf('right', rightVotes, rightColors[0])}

      <VerticalGoal side="left" />
      <VerticalGoal side="right" />
    </svg>
  );
}

function VerticalCrowd({ side, count, color, isExcited, isStill }: CrowdProps) {
  const rows = crowdRowsOf(count);
  const { cells, cols } = crowdCells(count, rows);
  const xStep = PITCH_WIDTH / Math.max(cols, 8);
  const xStart = CENTER_X - (cols * xStep) / 2 + xStep / 2;
  const yStart = side === 'left' ? 62 : 478;
  const yDir = side === 'left' ? -1 : 1;
  const goalStandRadius = Math.max(3.6, 6.9 - rows * 0.525);

  const sideStands = sideStandCells(count, SIDE_STAND_ROWS.length);
  const sideYStart = side === 'left' ? V.y0 + 6 : V.y1 - 6;
  const sideYStep =
    SIDE_STAND_LENGTH / Math.ceil(SIDE_STAND_DOTS / SIDE_STAND_ROWS.length);

  const dot = (index: number, x: number, y: number, r: number) => (
    <circle
      key={index}
      data-pitch-crowd-dot={isStill ? undefined : ''}
      style={{ '--jump-delay': dotDelay(index) } as CSSProperties}
      cx={x}
      cy={y}
      r={r}
      fill={color}
      opacity={0.9}
    />
  );

  return (
    <g data-pitch-crowd={side} data-excited={isExcited ? 'true' : 'false'}>
      {cells.map(({ row, col, index }) =>
        dot(
          index,
          xStart + col * xStep,
          yStart + yDir * row * 10,
          goalStandRadius,
        ),
      )}
      {sideStands.map((standCells, stand) =>
        standCells.map(({ row, col, index }) => {
          const seatX = SIDE_STAND_ROWS[row] ?? 0;
          const x = stand === 0 ? seatX : VIEW_WIDTH - seatX;
          return dot(index, x, sideYStart - yDir * col * sideYStep, 3.2);
        }),
      )}
    </g>
  );
}

function VerticalGoal({ side }: { readonly side: PitchSide }) {
  const y = side === 'left' ? V.y0 - 16 : V.y1;
  const left = CENTER_X - 40;
  const right = CENTER_X + 40;
  const bottom = y + 16;
  const mouth = pointsOf(
    side === 'left'
      ? [
          [left, bottom],
          [left, y],
          [right, y],
          [right, bottom],
        ]
      : [
          [left, y],
          [left, bottom],
          [right, bottom],
          [right, y],
        ],
  );
  return (
    <g>
      <rect
        x={left}
        y={y}
        width="80"
        height="16"
        fill="var(--net)"
        opacity="0.5"
      />
      <g stroke="var(--net)" strokeWidth="1" opacity="0.8">
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={left} y1={y + 16 * t} x2={right} y2={y + 16 * t} />
        ))}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1={left + 80 * t}
            y1={y}
            x2={left + 80 * t}
            y2={y + 16}
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
