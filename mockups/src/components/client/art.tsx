import { useId } from 'react';

import type { ArtVariant } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

// 各パレットは3色以上。アップロード画像の代替として多彩さを出す
const PALETTES: [string, string, string, string][] = [
  ['#1d4ed8', '#f59e0b', '#fef3c7', '#0f172a'],
  ['#0f766e', '#fb7185', '#fde68a', '#134e4a'],
  ['#7c3aed', '#22d3ee', '#f5f3ff', '#312e81'],
  ['#be123c', '#fbbf24', '#fff1f2', '#4c0519'],
  ['#0369a1', '#a3e635', '#ecfeff', '#082f49'],
  ['#c2410c', '#0ea5e9', '#fff7ed', '#431407'],
  ['#4d7c0f', '#f472b6', '#f7fee7', '#1a2e05'],
  ['#0e7490', '#f97316', '#fefce8', '#164e63'],
  ['#9333ea', '#facc15', '#faf5ff', '#3b0764'],
  ['#b45309', '#2dd4bf', '#fffbeb', '#451a03'],
  ['#1e3a8a', '#f43f5e', '#dbeafe', '#172554'],
  ['#065f46', '#fb923c', '#ecfdf5', '#022c22'],
];

export function paletteColors(palette: number): [string, string] {
  const [a, b] = PALETTES[palette % PALETTES.length];
  return [a, b];
}

type LogoProps = {
  palette: number;
  variant: ArtVariant;
  size?: number;
  className?: string;
  title: string;
};

export function ProductLogoArt({
  palette,
  variant,
  size = 64,
  className,
  title,
}: LogoProps) {
  const [a, b, c, d] = PALETTES[palette % PALETTES.length];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`${title}のロゴ`}
      className={cn('shrink-0 rounded-lg', className)}
    >
      <rect width="64" height="64" rx="14" fill={a} />
      {variant === 'orbit' && (
        <>
          <circle
            cx="32"
            cy="32"
            r="18"
            fill="none"
            stroke={c}
            strokeWidth="3"
          />
          <circle cx="32" cy="32" r="8" fill={b} />
          <circle cx="48" cy="24" r="5" fill={c} />
          <circle cx="18" cy="42" r="3" fill={d} />
        </>
      )}
      {variant === 'stripes' && (
        <>
          <path d="M8 44 L40 12 H52 L20 44Z" fill={c} />
          <path d="M20 52 L52 20 V32 L32 52Z" fill={b} />
          <circle cx="16" cy="18" r="5" fill={d} />
        </>
      )}
      {variant === 'blob' && (
        <>
          <path
            d="M20 14c10-6 26-2 30 10s-4 24-16 28S10 46 12 32c1-8 2-14 8-18z"
            fill={c}
          />
          <path
            d="M26 24c6-4 16-1 18 6s-3 14-10 16-14-2-13-10c0-5 2-9 5-12z"
            fill={b}
          />
          <circle cx="38" cy="30" r="3" fill={d} />
        </>
      )}
      {variant === 'grid' && (
        <>
          <rect x="12" y="12" width="16" height="16" rx="4" fill={c} />
          <rect x="36" y="12" width="16" height="16" rx="4" fill={b} />
          <rect x="12" y="36" width="16" height="16" rx="4" fill={b} />
          <rect x="36" y="36" width="16" height="16" rx="8" fill={d} />
        </>
      )}
      {variant === 'bolt' && (
        <>
          <path d="M36 8 L16 36 H30 L26 56 L48 26 H34Z" fill={c} />
          <path
            d="M36 8 L16 36 H30 L28 46 L40 26 H34Z"
            fill={b}
            opacity="0.85"
          />
          <circle cx="50" cy="14" r="4" fill={d} />
        </>
      )}
      {variant === 'wave' && (
        <>
          <path d="M6 40c8-10 14-10 22 0s14 10 22 0 8-6 8-6v24H6z" fill={b} />
          <path
            d="M6 30c8-10 14-10 22 0s14 10 22 0 8-6 8-6v14c-8 8-14 8-22 0S22 28 14 38l-8 4z"
            fill={c}
          />
          <circle cx="16" cy="16" r="6" fill={d} />
        </>
      )}
      {variant === 'ring' && (
        <>
          <circle
            cx="32"
            cy="32"
            r="20"
            fill="none"
            stroke={c}
            strokeWidth="8"
          />
          <path d="M32 12a20 20 0 0 1 20 20h-8a12 12 0 0 0-12-12z" fill={b} />
          <circle cx="32" cy="32" r="6" fill={d} />
        </>
      )}
      {variant === 'peak' && (
        <>
          <path d="M6 52 L26 18 L38 38 L46 28 L58 52Z" fill={c} />
          <path d="M6 52 L26 18 L34 32 L22 52Z" fill={b} />
          <circle cx="48" cy="16" r="5" fill={d} />
        </>
      )}
    </svg>
  );
}

type AvatarProps = {
  palette: number;
  size?: number;
  className?: string;
  title: string;
};

export function AvatarArt({
  palette,
  size = 32,
  className,
  title,
}: AvatarProps) {
  const [a, b, c, d] = PALETTES[palette % PALETTES.length];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`${title}のプロフィール画像`}
      className={cn('shrink-0 rounded-full', className)}
    >
      <rect width="64" height="64" fill={c} />
      <circle cx="32" cy="70" r="26" fill={b} />
      <circle cx="32" cy="26" r="14" fill={a} />
      <circle cx="27" cy="24" r="2" fill={c} />
      <circle cx="37" cy="24" r="2" fill={c} />
      <path d="M26 31q6 5 12 0" stroke={c} strokeWidth="2" fill="none" />
      <path d="M18 22c2-12 26-12 28 0" fill={d} />
    </svg>
  );
}

function pentagonPoints(cx: number, cy: number, r: number, rotate: number) {
  return Array.from({ length: 5 }, (_, k) => {
    const angle = ((rotate + k * 72) * Math.PI) / 180;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

const BALL_RADIUS = 9.4;
// 中央の五角形を囲む5つの五角形は、中央五角形の各辺の向こう側(頂点の間の角度)に置く
const RING_ANGLES = Array.from({ length: 5 }, (_, k) => -90 + 36 + k * 72);

type SoccerBallProps = { className?: string };

export function SoccerBallArt({ className }: SoccerBallProps) {
  const clipId = useId();
  return (
    <svg
      viewBox="-10 -10 20 20"
      aria-hidden="true"
      className={cn('block size-full', className)}
    >
      <clipPath id={clipId}>
        <circle r={BALL_RADIUS} />
      </clipPath>
      <circle r={BALL_RADIUS} fill="var(--ball)" />
      <g clipPath={`url(#${clipId})`} fill="var(--ball-stroke)">
        <polygon points={pentagonPoints(0, 0, 3.2, -90)} />
        {RING_ANGLES.map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <polygon
              key={deg}
              points={pentagonPoints(
                8.4 * Math.cos(rad),
                8.4 * Math.sin(rad),
                3,
                deg + 180,
              )}
            />
          );
        })}
      </g>
      <g stroke="var(--ball-stroke)" strokeWidth="0.8">
        {Array.from({ length: 5 }, (_, k) => {
          const rad = ((-90 + k * 72) * Math.PI) / 180;
          return (
            <line
              key={k}
              x1={(3.2 * Math.cos(rad)).toFixed(2)}
              y1={(3.2 * Math.sin(rad)).toFixed(2)}
              x2={(6.6 * Math.cos(rad)).toFixed(2)}
              y2={(6.6 * Math.sin(rad)).toFixed(2)}
            />
          );
        })}
        <circle r={BALL_RADIUS} fill="none" />
      </g>
    </svg>
  );
}
