import { orderSections, sectionsByPlacement } from '../layout/section-order.ts';
import type {
  ProductLaunchSection,
  ProductOwnerAction,
  ProductPagePlacement,
  ProductPageSection,
} from './product-page-section-types.ts';

export const PRODUCT_PAGE_PLACEMENTS = Object.freeze([
  'banner',
  'main',
  'aside',
  'bottom',
] as const satisfies readonly ProductPagePlacement[]);

export type ProductPageSectionGroups = Readonly<
  Record<ProductPagePlacement, readonly ProductPageSection[]>
>;

export const groupProductPageSections = (
  sections: readonly ProductPageSection[],
): ProductPageSectionGroups => {
  const of = sectionsByPlacement(sections);
  return {
    banner: of('banner'),
    main: of('main'),
    aside: of('aside'),
    bottom: of('bottom'),
  };
};

export const orderProductLaunchSections = (
  sections: readonly ProductLaunchSection[],
): readonly ProductLaunchSection[] => orderSections(sections);

export const orderProductOwnerActions = (
  actions: readonly ProductOwnerAction[],
): readonly ProductOwnerAction[] => orderSections(actions);
