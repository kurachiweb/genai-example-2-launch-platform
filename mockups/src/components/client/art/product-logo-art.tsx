import type { ArtVariant } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { paletteOf } from './palettes';

type Props = {
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
}: Props) {
  const [a, b, c, d] = paletteOf(palette);
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
