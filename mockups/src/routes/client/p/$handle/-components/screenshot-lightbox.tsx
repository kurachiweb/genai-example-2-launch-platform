import { useRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#/components/ui/dialog';

import type { Screenshot } from '../-model/page-model';
import { ScreenshotImage } from './screenshot-image';

type Props = {
  shots: Screenshot[];
  index: number | null;
  productName: string;
  broken: boolean;
  onIndexChange: (index: number | null) => void;
};

const SWIPE_THRESHOLD_PX = 50;

export function ScreenshotLightbox({
  shots,
  index,
  productName,
  broken,
  onIndexChange,
}: Props) {
  const swipeStart = useRef<number | null>(null);
  const open = index !== null;
  const current = index ?? 0;
  const shot = shots[current] as Screenshot | undefined;
  const hasMany = shots.length > 1;

  const move = (delta: number) => {
    onIndexChange((current + delta + shots.length) % shots.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!hasMany) return;
    if (event.key === 'ArrowRight') move(1);
    if (event.key === 'ArrowLeft') move(-1);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (swipeStart.current === null || !hasMany) return;
          const delta = event.clientX - swipeStart.current;
          swipeStart.current = null;
          if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) move(delta < 0 ? 1 : -1);
        }}
        className="flex h-[min(92vh,980px)] w-[min(96vw,1400px)] max-w-none touch-pan-y flex-col gap-3 border-0 bg-[oklch(0.16_0.01_160)] p-3 text-white sm:max-w-none sm:p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="min-w-0 truncate text-sm font-semibold">
            {productName}のスクリーンショット
          </DialogTitle>
          <DialogDescription
            aria-live="polite"
            className="scoreboard-digits shrink-0 text-sm text-white/80"
          >
            {current + 1} / {shots.length}
          </DialogDescription>
          <DialogClose asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              aria-label="閉じる"
            >
              <XIcon />
            </Button>
          </DialogClose>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {shot && (
            <div
              className="max-h-full max-w-full overflow-hidden rounded-lg"
              style={{
                aspectRatio: `${shot.width} / ${shot.height}`,
                height: shot.height >= shot.width ? '100%' : undefined,
                width: shot.width > shot.height ? '100%' : undefined,
              }}
            >
              <ScreenshotImage
                shot={shot}
                broken={broken}
                title={`${productName}のスクリーンショット ${current + 1}枚目`}
              />
            </div>
          )}
          {hasMany && (
            <>
              <Button
                size="icon-lg"
                variant="secondary"
                className="absolute top-1/2 left-1 -translate-y-1/2 rounded-full opacity-90 shadow-lg"
                aria-label="前のスクリーンショット"
                onClick={() => move(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-lg"
                variant="secondary"
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full opacity-90 shadow-lg"
                aria-label="次のスクリーンショット"
                onClick={() => move(1)}
              >
                <ChevronRightIcon />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
