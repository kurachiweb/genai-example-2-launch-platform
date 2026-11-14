import { ImageOffIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '../../utilities/class-names.ts';
import type {
  PictureDisplay,
  PictureSize,
} from '../../utilities/media/picture-sources.ts';
import {
  type PlaceholderInput,
  placeholderAppearanceOf,
} from '../../utilities/media/placeholder-appearance.ts';
import {
  IMAGE_UNAVAILABLE_TEXT,
  unavailableImageLabel,
} from '../../utilities/messages/media-display-messages.ts';

export interface MediaPlaceholderProps {
  readonly kind: PictureDisplay['kind'];
  readonly placeholder: PlaceholderInput;
  readonly alt: string;
  readonly size: PictureSize;
  readonly className?: string;
}

// 幅はCSSの変数で渡し、呼び出し元が<img>と同じクラス名(w-full・size-8など)で上書きできるようにする
const frameStyleOf = ({ width, height }: PictureSize): CSSProperties =>
  ({
    '--media-placeholder-width': `${String(width)}px`,
    aspectRatio: `${String(width)} / ${String(height)}`,
  }) as CSSProperties;

const FRAME_CLASS_NAME =
  'inline-flex w-(--media-placeholder-width) max-w-full shrink-0 items-center justify-center overflow-hidden select-none';

const accessibilityOf = (name: string) =>
  name === ''
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': name } as const);

export function MediaPlaceholder({
  kind,
  placeholder,
  alt,
  size,
  className,
}: MediaPlaceholderProps) {
  if (kind === 'screenshot') {
    return (
      <span
        data-slot="media-placeholder"
        {...accessibilityOf(alt === '' ? '' : unavailableImageLabel(alt))}
        className={cn(
          FRAME_CLASS_NAME,
          'flex-col gap-1.5 bg-muted p-2 text-center text-xs font-medium text-muted-foreground',
          className,
        )}
        style={frameStyleOf(size)}
      >
        <ImageOffIcon aria-hidden="true" className="size-5 shrink-0" />
        {IMAGE_UNAVAILABLE_TEXT}
      </span>
    );
  }
  const appearance = placeholderAppearanceOf(placeholder);
  return (
    <span
      data-slot="media-placeholder"
      {...accessibilityOf(alt)}
      className={cn(FRAME_CLASS_NAME, '@container font-extrabold', className)}
      style={{
        ...frameStyleOf(size),
        backgroundColor: appearance.background,
        color: appearance.foreground,
      }}
    >
      <span aria-hidden="true" className="text-[46cqi] leading-none">
        {appearance.initial}
      </span>
    </span>
  );
}
