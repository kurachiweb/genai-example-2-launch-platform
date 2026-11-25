import type { SponsoredPlacementProps } from './sponsored-placement-types.ts';
import { SilverPlacement } from './silver-placement.tsx';

// トップページのフッター直上の置き場所は幅の器を持たないため、ページの本文と同じ最大幅・左右の余白と、本文の列の器と同じ上の間隔を渡す
const TOP_PAGE_FRAME_CLASS = 'mx-auto w-full max-w-7xl px-4 pt-10';

export function TopPageSilverPlacement({ viewer }: SponsoredPlacementProps) {
  return <SilverPlacement viewer={viewer} className={TOP_PAGE_FRAME_CLASS} />;
}
