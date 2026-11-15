import type {
  MatchByeFragment,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import type { MatchEntryView } from './match-card-model.ts';

type EntrySide = 'left' | 'right';

type MatchProductView = NonNullable<MatchEntryView['product']>;

export const MATCH_ID = '01JD0MATCH0000000000000001';

export const ENTRY_IDS: Readonly<Record<EntrySide, string>> = Object.freeze({
  left: '01JD0ENTRY0000000000000001',
  right: '01JD0ENTRY0000000000000002',
});

const PRODUCTS: Readonly<Record<EntrySide, MatchProductView>> = Object.freeze({
  left: {
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'ピッチの台本を書いて練習できるノートアプリ',
    websiteUrl: 'https://pitch-notes.example/',
    listed: true,
    category: {
      id: '01JD0CATEGORY0000000000001',
      name: '開発ツール',
      handle: 'dev-tools',
    },
    logo: null,
  },
  right: {
    handle: 'tactics-board',
    name: 'Tactics Board',
    tagline: '試合の戦術を共有できるホワイトボード',
    websiteUrl: 'https://tactics-board.example/',
    listed: false,
    category: {
      id: '01JD0CATEGORY0000000000002',
      name: 'デザイン',
      handle: 'design',
    },
    logo: null,
  },
});

export const productOf = (
  side: EntrySide,
  overrides: Partial<MatchProductView> = {},
): MatchProductView => ({ ...PRODUCTS[side], ...overrides });

export const entryOf = (
  side: EntrySide,
  overrides: Partial<MatchEntryView> = {},
): MatchEntryView => ({
  id: ENTRY_IDS[side],
  colorIndex: side === 'left' ? 1 : 4,
  isViewerOwn: false,
  upvoteCount: side === 'left' ? 12 : 9,
  result: null,
  product: productOf(side),
  ...overrides,
});

export const matchOf = (
  overrides: Partial<MatchFragment> = {},
): MatchFragment => ({
  id: MATCH_ID,
  kind: 'QUALIFIER',
  round: null,
  stage: null,
  phase: 'LIVE',
  decision: null,
  endedEarly: false,
  viewerRestriction: null,
  viewerUpvotedEntryId: null,
  entries: [entryOf('left'), entryOf('right')],
  ...overrides,
});

export const BYE_MATCH_ID = '01JD0MATCH0000000000000002';

type ByeOverrides = {
  readonly match?: Partial<MatchByeFragment['match']>;
  readonly entry?: Partial<MatchByeFragment['entry']>;
  readonly reason?: MatchByeFragment['reason'];
};

export const byeOf = ({
  match = {},
  entry = {},
  reason,
}: ByeOverrides = {}): MatchByeFragment => {
  const byeMatch: MatchByeFragment['match'] = {
    id: BYE_MATCH_ID,
    kind: 'QUALIFIER',
    round: null,
    stage: null,
    endedEarly: false,
    ...match,
  };
  return {
    reason: reason ?? (byeMatch.endedEarly ? 'EARLY' : 'ABSENT'),
    match: byeMatch,
    entry: entryOf('left', { result: 'BYE', ...entry }),
  };
};
