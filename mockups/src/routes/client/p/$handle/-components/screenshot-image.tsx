import { ImageOffIcon } from 'lucide-react';

import { ScreenshotArt } from '#/components/client/art/screenshot-art';
import { cn } from '#/lib/utils';

import type { Screenshot } from '../-model/page-model';

type Props = {
  shot: Screenshot;
  title: string;
  broken: boolean;
  className?: string;
};

// 読み込み失敗・隔離中は薄灰色の背景に「画像を表示できません」を重ねる
export function ScreenshotImage({ shot, title, broken, className }: Props) {
  if (broken) {
    return (
      <span
        role="img"
        aria-label={`${title}(画像を表示できません)`}
        className={cn(
          'flex size-full flex-col items-center justify-center gap-1.5 bg-[oklch(0.92_0.005_160)] p-2 text-center text-xs font-medium text-[oklch(0.42_0.01_160)] dark:bg-[oklch(0.3_0.01_160)] dark:text-[oklch(0.8_0.01_160)]',
          className,
        )}
      >
        <ImageOffIcon className="size-5" aria-hidden="true" />
        画像を表示できません
      </span>
    );
  }
  return (
    <ScreenshotArt
      palette={shot.palette}
      variant={shot.variant}
      width={shot.width}
      height={shot.height}
      title={title}
      className={cn('size-full', className)}
    />
  );
}
