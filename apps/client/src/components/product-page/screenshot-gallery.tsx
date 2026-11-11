import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { ProductPageView } from '../../graphql/product-page.ts';
import { SectionHeading } from '../layout/section-heading.tsx';
import {
  enlargeScreenshotLabel,
  SCREENSHOT_LIST_LABEL,
  screenshotAlt,
  screenshotCountLabel,
  SCREENSHOTS_HEADING,
  SCROLL_NEXT_SCREENSHOTS_LABEL,
  SCROLL_PREVIOUS_SCREENSHOTS_LABEL,
} from './screenshot-gallery-messages.ts';
import { ScreenshotLightbox } from './screenshot-lightbox.tsx';

export type ProductScreenshot = ProductPageView['screenshots'][number];

export interface ScreenshotGalleryProps {
  readonly productName: string;
  readonly screenshots: readonly ProductScreenshot[];
}

interface ScrollEdges {
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

const HEADING_ID = 'screenshots-heading';

// 一覧の幅のうち1回のスクロールで送る割合。直前に見えていた右端の画像が左端に残り、続きの位置を見失わない
const SCROLL_RATIO = 0.8;

// 小数の画素の丸めで端に届かない状態を端と見なす
const EDGE_TOLERANCE_PX = 1;

const edgesOf = (element: HTMLElement): ScrollEdges => ({
  atStart: element.scrollLeft <= EDGE_TOLERANCE_PX,
  atEnd:
    element.scrollLeft + element.clientWidth >=
    element.scrollWidth - EDGE_TOLERANCE_PX,
});

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// サーバー側の描画では一覧の幅を知らないため、両端にいるものとしてスクロールのボタンを押せない状態で描く
function useScrollEdges(
  scrollerRef: RefObject<HTMLUListElement | null>,
  count: number,
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({
    atStart: true,
    atEnd: true,
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const update = () => {
      const next = edgesOf(scroller);
      setEdges((current) =>
        current.atStart === next.atStart && current.atEnd === next.atEnd
          ? current
          : next,
      );
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scrollerRef, count]);
  return edges;
}

function EdgeFade({
  side,
  hidden,
}: {
  readonly side: 'start' | 'end';
  readonly hidden: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-0 bottom-3 hidden w-10 transition-opacity sm:block',
        side === 'start'
          ? 'left-0 bg-linear-to-r from-background to-transparent'
          : 'right-0 bg-linear-to-l from-background to-transparent',
        hidden && 'opacity-0',
      )}
    />
  );
}

// 端に着いた時にフォーカスのあるボタンをdisabledにするとフォーカスが<body>へ落ちるため、フォーカスが離れるまではaria-disabledにする
function ScrollButton({
  direction,
  atEdge,
  onScroll,
}: {
  readonly direction: 'previous' | 'next';
  readonly atEdge: boolean;
  readonly onScroll: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const isPrevious = direction === 'previous';
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label={
        isPrevious
          ? SCROLL_PREVIOUS_SCREENSHOTS_LABEL
          : SCROLL_NEXT_SCREENSHOTS_LABEL
      }
      disabled={atEdge && !focused}
      aria-disabled={atEdge && focused ? true : undefined}
      className={cn(
        'absolute top-[calc(50%-0.25rem)] hidden -translate-y-1/2 rounded-full shadow-md disabled:opacity-0 sm:inline-flex',
        isPrevious ? '-left-3' : '-right-3',
      )}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onClick={() => {
        if (!atEdge) {
          onScroll();
        }
      }}
    >
      {isPrevious ? (
        <ChevronLeftIcon aria-hidden="true" />
      ) : (
        <ChevronRightIcon aria-hidden="true" />
      )}
    </Button>
  );
}

export function ScreenshotGallery({
  productName,
  screenshots,
}: ScreenshotGalleryProps) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const edges = useScrollEdges(scrollerRef, screenshots.length);

  if (screenshots.length === 0) {
    return null;
  }

  const scrollByPage = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    scroller.scrollBy({
      left: direction * scroller.clientWidth * SCROLL_RATIO,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  return (
    <section aria-labelledby={HEADING_ID}>
      <SectionHeading
        id={HEADING_ID}
        icon={<ImagesIcon aria-hidden="true" className="size-5 text-primary" />}
        title={SCREENSHOTS_HEADING}
        meta={screenshotCountLabel(screenshots.length)}
      />
      <div className="relative mt-3">
        {/* 一覧は横スクロールのため上下も切り取るので、サムネイルのフォーカスの輪郭(外側4px)が収まる余白を内側に取る */}
        <ul
          ref={scrollerRef}
          aria-label={SCREENSHOT_LIST_LABEL}
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-1 sm:scroll-px-1 sm:px-1"
        >
          {screenshots.map((screenshot, index) => (
            <li
              key={screenshot.fileId}
              className="group relative shrink-0 snap-start"
            >
              <div className="overflow-hidden rounded-xl border border-border bg-muted shadow-sm transition-shadow group-hover:shadow-md">
                <MediaPicture
                  image={screenshot.image}
                  display={{ kind: 'screenshot', variant: 'thumb' }}
                  alt={screenshotAlt(productName, index + 1)}
                  placeholder={{
                    label: screenshotAlt(productName, index + 1),
                    seed: screenshot.fileId,
                  }}
                  loading="lazy"
                  className="h-52 w-auto max-w-none align-top sm:h-72"
                />
              </div>
              {/* 画像を表示できない時の代わりの文字をボタンの中に置くと、見える文字とボタンの名前が食い違うため、画像を包まず重ねる */}
              <button
                type="button"
                aria-label={enlargeScreenshotLabel(index + 1)}
                className="absolute inset-0 rounded-xl"
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setOpenIndex(index);
                }}
              />
            </li>
          ))}
        </ul>
        {screenshots.length > 1 && (
          <>
            <EdgeFade side="start" hidden={edges.atStart} />
            <EdgeFade side="end" hidden={edges.atEnd} />
            <ScrollButton
              direction="previous"
              atEdge={edges.atStart}
              onScroll={() => {
                scrollByPage(-1);
              }}
            />
            <ScrollButton
              direction="next"
              atEdge={edges.atEnd}
              onScroll={() => {
                scrollByPage(1);
              }}
            />
          </>
        )}
      </div>
      <ScreenshotLightbox
        productName={productName}
        screenshots={screenshots}
        index={openIndex}
        onIndexChange={setOpenIndex}
        returnFocusRef={openerRef}
      />
    </section>
  );
}
