import { orderSections, sectionsByPlacement } from '../layout/section-order.ts';
import type {
  DirectoryListInsert,
  DirectoryPlacement,
  DirectorySection,
} from './directory-section-types.ts';

export const DIRECTORY_PLACEMENTS = Object.freeze([
  'banner',
  'aside',
  'bottom',
] as const satisfies readonly DirectoryPlacement[]);

export type DirectorySectionGroups = Readonly<
  Record<DirectoryPlacement, readonly DirectorySection[]>
>;

export type DirectoryListEntry<T> =
  | { readonly kind: 'item'; readonly item: T }
  | {
      readonly kind: 'insert';
      readonly insert: DirectoryListInsert;
      readonly position: number;
    };

export const groupDirectorySections = (
  sections: readonly DirectorySection[],
): DirectorySectionGroups => {
  const of = sectionsByPlacement(sections);
  return { banner: of('banner'), aside: of('aside'), bottom: of('bottom') };
};

const assertEvery = ({ id, every }: DirectoryListInsert): void => {
  if (!Number.isInteger(every) || every < 1) {
    throw new RangeError(
      `差し込みの間隔は1以上の整数にしてください: ${id} ${String(every)}`,
    );
  }
};

// 項目の何件ごとかの直後に差し込みを置く。件数が割り切れるときは最後の項目の後にも置く
export const layoutDirectoryList = <T>(
  items: readonly T[],
  inserts: readonly DirectoryListInsert[],
): readonly DirectoryListEntry<T>[] => {
  const ordered = orderSections(inserts);
  ordered.forEach(assertEvery);
  return items.flatMap((item, index): DirectoryListEntry<T>[] => {
    const shown = index + 1;
    const due = ordered
      .filter(({ every }) => shown % every === 0)
      .map((insert): DirectoryListEntry<T> => ({
        kind: 'insert',
        insert,
        position: shown / insert.every,
      }));
    return [{ kind: 'item', item }, ...due];
  });
};
