export const orderSections = <T extends { readonly order: number }>(
  sections: readonly T[],
): readonly T[] => sections.toSorted((a, b) => a.order - b.order);

// 置き場所を受け取り、その置き場所の区画をorderの小さい順に返す関数を作る
export const sectionsByPlacement = <
  P extends string,
  T extends { readonly placement: P; readonly order: number },
>(
  sections: readonly T[],
): ((placement: P) => readonly T[]) => {
  const ordered = orderSections(sections);
  return (placement) =>
    ordered.filter((section) => section.placement === placement);
};
