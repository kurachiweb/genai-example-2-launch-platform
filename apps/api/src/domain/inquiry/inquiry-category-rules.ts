export type CategoryEditDenial = 'protected';

export const checkCategoryEditable = (category: {
  readonly systemDefault: boolean;
}): CategoryEditDenial | undefined =>
  category.systemDefault ? 'protected' : undefined;

interface SortableCategory {
  readonly systemDefault: boolean;
  readonly createdAt: Date;
  readonly id: string;
}

const compareCategories = (
  left: SortableCategory,
  right: SortableCategory,
): number => {
  if (left.systemDefault !== right.systemDefault) {
    return left.systemDefault ? 1 : -1;
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

export const sortCategories = <T extends SortableCategory>(
  categories: readonly T[],
): readonly T[] => categories.toSorted(compareCategories);
