import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
} from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import type { ProductScreenshot } from './screenshot-gallery.tsx';
import {
  CLOSE_LIGHTBOX_LABEL,
  lightboxPosition,
  lightboxTitle,
  NEXT_SCREENSHOT_LABEL,
  PREVIOUS_SCREENSHOT_LABEL,
  screenshotAlt,
} from './screenshot-gallery-messages.ts';

export interface ScreenshotLightboxProps {
  readonly productName: string;
  readonly screenshots: readonly ProductScreenshot[];
  // nullなら閉じている
  readonly index: number | null;
  readonly onIndexChange: (index: number | null) => void;
  // 閉じた後にフォーカスを戻す、開いた元のサムネイル
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

// 画像を押す・縦にスクロールする指のぶれを移動と取り違えない横の移動量
const SWIPE_THRESHOLD_PX = 50;

interface SwipeStart {
  readonly pointerId: number;
  readonly clientX: number;
}

const hasModifier = (event: KeyboardEvent): boolean =>
  event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

export function ScreenshotLightbox({
  productName,
  screenshots,
  index,
  onIndexChange,
  returnFocusRef,
}: ScreenshotLightboxProps) {
  const openerRef = useRef<Element | null>(null);
  const swipeStartRef = useRef<SwipeStart | null>(null);
  const count = screenshots.length;
  const current = index === null ? 0 : Math.min(index, count - 1);
  const screenshot = screenshots[current];
  const hasMany = count > 1;

  const move = (delta: 1 | -1) => {
    if (hasMany) {
      onIndexChange((current + delta + count) % count);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (hasModifier(event)) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipeStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
    };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - start.clientX;
    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX) {
      move(deltaX < 0 ? 1 : -1);
    }
  };

  return (
    <Dialog
      open={index !== null && screenshot !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onIndexChange(null);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92dvh,980px)] w-[min(96vw,1400px)] max-w-none flex-col gap-3 p-3 sm:max-w-none sm:p-4"
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        // 開く元のサムネイルをDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いたサムネイルへ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef?.current ?? openerRef.current;
          if (target instanceof HTMLElement && target.isConnected) {
            target.focus();
          }
        }}
      >
        <div className="flex items-center gap-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">
            {lightboxTitle(productName)}
          </DialogTitle>
          <DialogDescription
            aria-live="polite"
            className="shrink-0 text-foreground tabular-nums"
          >
            {lightboxPosition(current + 1, count)}
          </DialogDescription>
          <DialogClose asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={CLOSE_LIGHTBOX_LABEL}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        {/* 指の横の移動をブラウザのスクロールに取られずに受け取るよう、縦のスクロールだけをブラウザに任せる */}
        <div
          data-slot="screenshot-lightbox-stage"
          className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center [&>picture]:contents"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            swipeStartRef.current = null;
          }}
        >
          {screenshot !== undefined && (
            <MediaPicture
              key={screenshot.fileId}
              image={screenshot.image}
              display={{ kind: 'screenshot', variant: 'full' }}
              alt={screenshotAlt(productName, current + 1)}
              placeholder={{
                label: screenshotAlt(productName, current + 1),
                seed: screenshot.fileId,
              }}
              className="h-auto max-h-full max-w-full rounded-lg object-contain select-none"
            />
          )}
          {hasMany && (
            <>
              <Button
                type="button"
                size="icon-lg"
                variant="secondary"
                className="absolute top-1/2 left-1 -translate-y-1/2 rounded-full shadow-lg"
                aria-label={PREVIOUS_SCREENSHOT_LABEL}
                onClick={() => {
                  move(-1);
                }}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-lg"
                variant="secondary"
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full shadow-lg"
                aria-label={NEXT_SCREENSHOT_LABEL}
                onClick={() => {
                  move(1);
                }}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
