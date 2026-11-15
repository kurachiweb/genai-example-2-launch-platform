import { HorizontalPitch } from './horizontal-pitch.tsx';
import type { PitchProps } from './pitch-model.ts';
import { VerticalPitch } from './vertical-pitch.tsx';

export function StadiumPitch({ orientation, ...props }: PitchProps) {
  return orientation === 'horizontal' ? (
    <HorizontalPitch {...props} />
  ) : (
    <VerticalPitch {...props} />
  );
}
