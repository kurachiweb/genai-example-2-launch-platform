import { useId } from 'react';

import { cn } from '#/lib/utils';

function pentagonPoints(cx: number, cy: number, r: number, rotate: number) {
  return Array.from({ length: 5 }, (_, k) => {
    const angle = ((rotate + k * 72) * Math.PI) / 180;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

const BALL_RADIUS = 9.4;
// 中央の五角形を囲む5つの五角形は、中央五角形の各辺の向こう側(頂点の間の角度)に置く
const RING_ANGLES = Array.from({ length: 5 }, (_, k) => -90 + 36 + k * 72);

type Props = { className?: string };

export function SoccerBallArt({ className }: Props) {
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
