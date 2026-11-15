export const orderProductSections = <T extends { readonly order: number }>(
  sections: readonly T[],
): readonly T[] => sections.toSorted((a, b) => a.order - b.order);
