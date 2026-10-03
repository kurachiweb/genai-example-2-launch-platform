import { useId } from 'react';

import { cn } from '#/lib/utils';

type Props = {
  kind: 'week' | 'year';
  size: number;
  className?: string;
};

// Product of the WeekとProduct of the Yearで形を変え、Yearは月桂樹と星で格上に見せる
export function TrophyArt({ kind, size, className }: Props) {
  const gradientId = useId();
  const shineId = useId();
  return (
    <svg
      viewBox="0 0 64 80"
      width={(size * 64) / 80}
      height={size}
      aria-hidden="true"
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
      {kind === 'year' && (
        <g fill="var(--primary)" opacity="0.85">
          {[0, 1, 2, 3, 4].map((i) => (
            <ellipse
              key={`l-${i}`}
              cx={8 + i * 1.5}
              cy={46 - i * 8}
              rx="2.6"
              ry="5"
              transform={`rotate(${-30 + i * 6} ${8 + i * 1.5} ${46 - i * 8})`}
            />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <ellipse
              key={`r-${i}`}
              cx={56 - i * 1.5}
              cy={46 - i * 8}
              rx="2.6"
              ry="5"
              transform={`rotate(${30 - i * 6} ${56 - i * 1.5} ${46 - i * 8})`}
            />
          ))}
        </g>
      )}
      <path
        d={
          kind === 'year'
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
      {kind === 'year' && (
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
