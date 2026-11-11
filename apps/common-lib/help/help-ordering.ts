export interface OrderableHelpCategory {
  readonly id: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

export interface OrderableHelpArticle {
  readonly id: string;
  readonly categoryId: string;
  readonly pinned: boolean;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

export interface PinnedHelpGroups<T> {
  readonly pinned: readonly T[];
  readonly others: readonly T[];
}

export interface HelpCategoryGroup<C, A> {
  readonly category: C;
  readonly articles: readonly A[];
}

export type HelpMoveDirection = 'up' | 'down';

// 並び順の値の重複を許すため、同値は作成の古い順とIDで順を決める
const compareBySortOrder = (
  left: OrderableHelpCategory,
  right: OrderableHelpCategory,
): number => {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
  if (byCreatedAt !== 0) {
    return byCreatedAt;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
};

const compareArticles = (
  left: OrderableHelpArticle,
  right: OrderableHelpArticle,
): number => {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return compareBySortOrder(left, right);
};

export const sortHelpCategories = <T extends OrderableHelpCategory>(
  categories: readonly T[],
): readonly T[] => categories.toSorted(compareBySortOrder);

export const sortHelpArticles = <T extends OrderableHelpArticle>(
  articles: readonly T[],
): readonly T[] => articles.toSorted(compareArticles);

export const splitPinnedGroups = <T extends OrderableHelpArticle>(
  articles: readonly T[],
): PinnedHelpGroups<T> => {
  const sorted = sortHelpArticles(articles);
  return {
    pinned: sorted.filter((article) => article.pinned),
    others: sorted.filter((article) => !article.pinned),
  };
};

export const groupPublishedArticles = <
  C extends OrderableHelpCategory,
  A extends OrderableHelpArticle,
>(
  categories: readonly C[],
  articles: readonly A[],
): readonly HelpCategoryGroup<C, A>[] => {
  const sortedArticles = sortHelpArticles(articles);
  return sortHelpCategories(categories)
    .map((category) => ({
      category,
      articles: sortedArticles.filter(
        (article) => article.categoryId === category.id,
      ),
    }))
    .filter((group) => group.articles.length > 0);
};

export const moveItem = <T>(
  items: readonly T[],
  index: number,
  direction: HelpMoveDirection,
): readonly T[] => {
  const target = direction === 'up' ? index - 1 : index + 1;
  const inRange = (position: number): boolean =>
    position >= 0 && position < items.length;
  if (!inRange(index) || !inRange(target)) {
    return [...items];
  }
  const start = Math.min(index, target);
  return items.toSpliced(
    start,
    2,
    ...items.slice(start, start + 2).toReversed(),
  );
};
