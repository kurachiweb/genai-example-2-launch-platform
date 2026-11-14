import { type RefObject, useEffect, useState } from 'react';

export interface ScrollRegion {
  readonly overflowing: boolean;
  readonly label: string | undefined;
}

const NOT_OVERFLOWING: ScrollRegion = { overflowing: false, label: undefined };

function scrollRegionOf(container: HTMLElement): ScrollRegion {
  if (container.scrollWidth <= container.clientWidth) {
    return NOT_OVERFLOWING;
  }
  const caption = container.querySelector(':scope > table > caption');
  return { overflowing: true, label: caption?.textContent ?? undefined };
}

// 中に操作の要素を持たない横スクロールの領域はキーボードで移動できないため、幅を超えている間だけTabで止まる名前付きの領域にする
export function useScrollRegion(
  containerRef: RefObject<HTMLElement | null>,
): ScrollRegion {
  const [region, setRegion] = useState<ScrollRegion>(NOT_OVERFLOWING);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    const update = () => {
      const next = scrollRegionOf(container);
      setRegion((current) =>
        current.overflowing === next.overflowing && current.label === next.label
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    for (const child of container.children) {
      observer.observe(child);
    }
    update();
    return () => {
      observer.disconnect();
    };
  }, [containerRef]);
  return region;
}
