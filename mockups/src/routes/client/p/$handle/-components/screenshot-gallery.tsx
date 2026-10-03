import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { useMotion } from '#/lib/preferences';
import { cn } from '#/lib/utils';

import type { Screenshot } from '../-model/page-model';
import { usePageContext } from './page-context';
import { ScreenshotImage } from './screenshot-image';
import { ScreenshotLightbox } from './screenshot-lightbox';
import { SectionTitle } from './section-title';

type Props = {
  shots: Screenshot[];
  productName: string;
};

const SCROLL_RATIO = 0.8;

export function ScreenshotGallery({ shots, productName }: Props) {
  const { imagesBroken } = usePageContext();
  const motion = useMotion();
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      setEdges({
        start: element.scrollLeft <= 1,
        end:
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
      });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [shots.length]);

  if (shots.length === 0) return null;

  const scrollBy = (direction: 1 | -1) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * SCROLL_RATIO,
      behavior: motion === 'on' ? 'smooth' : 'auto',
    });
  };

  return (
    <section aria-labelledby="screenshots-heading">
      <SectionTitle
        id="screenshots-heading"
        icon={ImagesIcon}
        title="スクリーンショット"
        meta={`${shots.length}枚`}
      />
      <div className="relative mt-3">
        <ul
          ref={scroller}
          aria-label="スクリーンショット一覧(横にスクロールできます)"
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
        >
          {shots.map((shot, index) => (
            <li key={shot.id} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={`スクリーンショット${index + 1}枚目を拡大`}
                className="block h-52 overflow-hidden rounded-xl border border-border bg-muted shadow-sm transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none sm:h-72"
                style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
              >
                <ScreenshotImage
                  shot={shot}
                  broken={imagesBroken}
                  title={`${productName}のスクリーンショット ${index + 1}枚目`}
                />
              </button>
            </li>
          ))}
        </ul>
        {shots.length > 1 && (
          <>
            <EdgeFade side="left" hidden={edges.start} />
            <EdgeFade side="right" hidden={edges.end} />
            <Button
              size="icon"
              variant="secondary"
              aria-label="前のスクリーンショットへスクロール"
              disabled={edges.start}
              onClick={() => scrollBy(-1)}
              className="absolute top-[calc(50%-0.375rem)] -left-3 hidden -translate-y-1/2 rounded-full shadow-md disabled:opacity-0 sm:inline-flex"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="次のスクリーンショットへスクロール"
              disabled={edges.end}
              onClick={() => scrollBy(1)}
              className="absolute top-[calc(50%-0.375rem)] -right-3 hidden -translate-y-1/2 rounded-full shadow-md disabled:opacity-0 sm:inline-flex"
            >
              <ChevronRightIcon />
            </Button>
          </>
        )}
      </div>
      <ScreenshotLightbox
        shots={shots}
        index={openIndex}
        productName={productName}
        broken={imagesBroken}
        onIndexChange={setOpenIndex}
      />
    </section>
  );
}

function EdgeFade({
  side,
  hidden,
}: {
  side: 'left' | 'right';
  hidden: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-0 bottom-3 hidden w-10 transition-opacity sm:block',
        side === 'left'
          ? 'left-0 bg-linear-to-r from-background to-transparent'
          : 'right-0 bg-linear-to-l from-background to-transparent',
        hidden && 'opacity-0',
      )}
    />
  );
}
