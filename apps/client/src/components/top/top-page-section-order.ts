import { orderSections, sectionsByPlacement } from '../layout/section-order.ts';
import type {
  QualifierListInsert,
  TopPagePlacement,
  TopPageSection,
} from './top-page-section-types.ts';

export const TOP_PAGE_PLACEMENTS = Object.freeze([
  'banner',
  'showcase',
  'main',
  'aside',
  'bottom',
] as const satisfies readonly TopPagePlacement[]);

export type TopPageSectionGroups = Readonly<
  Record<TopPagePlacement, readonly TopPageSection[]>
>;

export type QualifierListItem<C> =
  | { readonly kind: 'card'; readonly card: C }
  | {
      readonly kind: 'insert';
      readonly insert: QualifierListInsert;
      readonly position: number;
    };

export const orderTopPageSections = (
  sections: readonly TopPageSection[],
): readonly TopPageSection[] => orderSections(sections);

export const groupTopPageSections = (
  sections: readonly TopPageSection[],
): TopPageSectionGroups => {
  const of = sectionsByPlacement(sections);
  return {
    banner: of('banner'),
    showcase: of('showcase'),
    main: of('main'),
    aside: of('aside'),
    bottom: of('bottom'),
  };
};

export const qualifierInsertCount = (
  cardCount: number,
  every: number,
): number => {
  if (!Number.isInteger(every) || every < 1) {
    throw new RangeError(
      `差し込みの間隔は1以上の整数にしてください: ${String(every)}`,
    );
  }
  if (!Number.isInteger(cardCount) || cardCount < 0) {
    throw new RangeError(
      `対戦カードの件数は0以上の整数にしてください: ${String(cardCount)}`,
    );
  }
  return Math.floor(cardCount / every);
};

export const layoutQualifierList = <C>(
  cards: readonly C[],
  inserts: readonly QualifierListInsert[],
): readonly QualifierListItem<C>[] => {
  const scheduled = orderSections(inserts).map((insert) => ({
    insert,
    count: qualifierInsertCount(cards.length, insert.every),
  }));
  return cards.flatMap((card, index): QualifierListItem<C>[] => {
    const shown = index + 1;
    const due = scheduled
      .map(({ insert, count }) => ({
        insert,
        count,
        position: shown / insert.every,
      }))
      .filter(
        ({ position, count }) =>
          Number.isInteger(position) && position <= count,
      )
      .map(({ insert, position }): QualifierListItem<C> => ({
        kind: 'insert',
        insert,
        position,
      }));
    return [{ kind: 'card', card }, ...due];
  });
};
