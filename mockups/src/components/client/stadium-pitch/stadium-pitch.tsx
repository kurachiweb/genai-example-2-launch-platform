import { HorizontalPitch } from './horizontal-pitch';
import { VerticalPitch } from './vertical-pitch';
import type { PitchProps } from './model';

export type { PitchProps, Side } from './model';

export function StadiumPitch({ orientation, ...props }: PitchProps) {
  return orientation === 'horizontal' ? (
    <HorizontalPitch {...props} />
  ) : (
    <VerticalPitch {...props} />
  );
}

// ページ内の全ピッチSVGが参照するグラデーション定義。display:noneのSVG内のdefsは他から参照できないため1箇所にまとめる
export function StadiumDefs() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        <radialGradient id="flood-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--flood)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="sky-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sky-glow)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
    </svg>
  );
}
