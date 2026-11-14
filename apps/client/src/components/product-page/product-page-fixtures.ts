import type { ProductPageView } from '../../graphql/product-page.ts';

export const productPageViewOf = (
  overrides: Partial<ProductPageView> = {},
): ProductPageView => ({
  __typename: 'ProductPage',
  id: '01JD0PRODUCT00000000000001',
  handle: 'Pitch-Notes',
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を書いて練習できるノートアプリ',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
  },
  websiteUrl: 'https://pitch-notes.example/',
  logo: null,
  description: '## 特徴',
  screenshots: [],
  owner: { handle: 'scout_ken', nickname: 'スカウトの健', avatar: null },
  viewerIsOwner: false,
  listed: true,
  awards: [],
  record: {
    firstLaunchDate: '2026-09-15',
    launchCount: 3,
    wins: 5,
    losses: 2,
  },
  launches: [],
  ...overrides,
});
