import { cn } from '#/lib/utils';

import { paletteOf } from './palettes';

type Props = {
  palette: number;
  size?: number;
  className?: string;
  title: string;
};

export function AvatarArt({ palette, size = 32, className, title }: Props) {
  const [a, b, c, d] = paletteOf(palette);
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
