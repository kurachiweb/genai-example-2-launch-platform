import type { PublicProfileTab } from './public-profile-section-types.ts';

export const orderPublicProfileSections = <
  T extends { readonly order: number },
>(
  sections: readonly T[],
): readonly T[] => sections.toSorted((a, b) => a.order - b.order);

export const resolveProfileTab = (
  tabs: readonly PublicProfileTab[],
  requested: string | undefined,
): PublicProfileTab | undefined => {
  const ordered = orderPublicProfileSections(tabs);
  return ordered.find(({ id }) => id === requested) ?? ordered[0];
};

export const profileTabQueryValue = (
  tabs: readonly PublicProfileTab[],
  id: string,
): string | undefined => {
  const [first] = orderPublicProfileSections(tabs);
  const target = tabs.find((tab) => tab.id === id);
  return target === undefined || target.id === first?.id ? undefined : id;
};
