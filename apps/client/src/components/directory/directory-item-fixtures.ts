import type {
  DirectoryAwardData,
  DirectoryItemData,
  DirectoryWinData,
} from './directory-item-types.ts';

export const VICTORY_WIN: DirectoryWinData = {
  kind: 'VICTORY',
  launchDate: '2026-09-15',
  upvoteCount: 1234,
};

export const BYE_WIN: DirectoryWinData = {
  kind: 'BYE',
  launchDate: '2026-09-16',
  upvoteCount: null,
};

export const EARLY_WIN: DirectoryWinData = {
  kind: 'EARLY',
  launchDate: '2025-12-01',
  upvoteCount: 1234,
};

export const WEEK_AWARD: DirectoryAwardData = {
  kind: 'WEEK',
  count: 3,
  labels: [
    '2026年第37週(9/7〜9/13)',
    '2026年第38週(9/14〜9/20)',
    '2026年第40週(9/28〜10/4)',
  ],
};

export const YEAR_AWARD: DirectoryAwardData = {
  kind: 'YEAR',
  count: 1,
  labels: ['2026年'],
};

export const directoryItemOf = (
  overrides: Partial<DirectoryItemData> = {},
): DirectoryItemData => ({
  handle: 'pitch-notes',
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を書いて練習できるノートアプリ。',
  websiteUrl: 'https://pitch-notes.example/',
  isViewerOwn: false,
  category: {
    id: '01JCATEGORY0000000000000001',
    name: '開発ツール',
    handle: 'developer-tools',
  },
  logo: null,
  owner: { handle: 'scout-ken', nickname: 'スカウトの健', avatar: null },
  win: VICTORY_WIN,
  awards: [],
  metrics: [],
  ...overrides,
});
