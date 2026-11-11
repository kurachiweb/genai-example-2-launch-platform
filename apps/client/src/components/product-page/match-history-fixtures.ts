import type {
  ProductPageLaunchView,
  ProductPageMatchView,
} from './match-history-model.ts';

export const OPPONENT_LOGO = {
  id: '01JD0FILE00000000000000002',
  objectKey: 'fedcba9876543210'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

export const historyMatchOf = (
  overrides: Partial<ProductPageMatchView> = {},
): ProductPageMatchView => ({
  id: '01JD0MATCH0000000000000001',
  entryId: '01JD0ENTRY0000000000000001',
  kind: 'QUALIFIER',
  round: null,
  stage: null,
  date: '2026-09-15',
  result: 'WON',
  decision: 'VOTES',
  endedEarly: false,
  ownUpvoteCount: 12,
  opponentUpvoteCount: 9,
  opponent: {
    kind: 'LISTED',
    handle: 'deck-forge',
    name: 'Deck Forge',
    logo: null,
  },
  ...overrides,
});

export const historyLaunchOf = (
  overrides: Partial<ProductPageLaunchView> = {},
): ProductPageLaunchView => ({
  id: '01JD0LAUNCH000000000000001',
  number: 1,
  launchDate: '2026-09-15',
  kickoffAt: '2026-09-14T15:00:00.000Z',
  status: 'FINISHED',
  summary: { label: 'ディレクトリ掲載', inMatch: false },
  kickedOff: true,
  latestKickedOff: true,
  matches: [historyMatchOf()],
  ...overrides,
});
