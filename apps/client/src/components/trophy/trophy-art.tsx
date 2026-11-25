import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { TrophyKind } from '../../graphql/generated/graphql.ts';

export interface TrophyArtProps {
  readonly kind: TrophyKind;
  // 高さ(px)。幅は絵の縦横比から決める
  readonly size: number;
  readonly className?: string;
}

const VIEW_BOX_WIDTH = 64;
const VIEW_BOX_HEIGHT = 80;
const LEAF_INDEXES = [0, 1, 2, 3, 4] as const;

function Laurel() {
  return (
    <g fill="var(--primary)" opacity="0.85">
      {LEAF_INDEXES.map((i) => (
        <ellipse
          key={`l-${String(i)}`}
          cx={8 + i * 1.5}
          cy={46 - i * 8}
          rx="2.6"
          ry="5"
          transform={`rotate(${String(-30 + i * 6)} ${String(8 + i * 1.5)} ${String(46 - i * 8)})`}
        />
      ))}
      {LEAF_INDEXES.map((i) => (
        <ellipse
          key={`r-${String(i)}`}
          cx={56 - i * 1.5}
          cy={46 - i * 8}
          rx="2.6"
          ry="5"
          transform={`rotate(${String(30 - i * 6)} ${String(56 - i * 1.5)} ${String(46 - i * 8)})`}
        />
      ))}
    </g>
  );
}

// 装飾の絵のため支援技術に読ませない。Product of the Yearは月桂樹と星を添えて格上に見せる
export function TrophyArt({ kind, size, className }: TrophyArtProps) {
  const gradientId = useId();
  const shineId = useId();
  const year = kind === 'YEAR';
  return (
    <svg
      viewBox={`0 0 ${String(VIEW_BOX_WIDTH)} ${String(VIEW_BOX_HEIGHT)}`}
      width={(size * VIEW_BOX_WIDTH) / VIEW_BOX_HEIGHT}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 drop-shadow-sm', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--gold)" />
          <stop offset="55%" stopColor="var(--gold-strong)" />
          <stop offset="100%" stopColor="var(--gold)" />
        </linearGradient>
        <linearGradient id={shineId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {year && <Laurel />}
      <path
        d={
          year
            ? 'M16 10h32v14c0 10-7 18-16 18s-16-8-16-18z'
            : 'M18 12h28v12c0 9-6 16-14 16s-14-7-14-16z'
        }
        fill={`url(#${gradientId})`}
      />
      <path
        d="M18 16c-8 0-10 4-10 7 0 5 5 9 11 10M46 16c8 0 10 4 10 7 0 5-5 9-11 10"
        fill="none"
        stroke="var(--gold-strong)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="22"
        y="13"
        width="6"
        height="22"
        rx="3"
        fill={`url(#${shineId})`}
      />
      <rect x="29" y="40" width="6" height="12" fill="var(--gold-strong)" />
      <path d="M20 52h24l3 8H17z" fill={`url(#${gradientId})`} />
      <rect
        x="14"
        y="60"
        width="36"
        height="12"
        rx="2"
        fill="var(--legend-a)"
      />
      <rect
        x="20"
        y="64"
        width="24"
        height="4"
        rx="1"
        fill="var(--gold)"
        opacity="0.8"
      />
      {year && (
        <path
          d="M32 0l2.4 4.9 5.4.8-3.9 3.8.9 5.4L32 12.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
          fill="var(--gold)"
          stroke="var(--gold-strong)"
          strokeWidth="0.8"
        />
      )}
    </svg>
  );
}
