import type { CurrentUser } from '../../../../lib/core/identity/account-guard.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
} from '../../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
  SupporterCursor,
  SupporterDirectory,
  SupporterRecord,
} from '../../../../lib/core/match/ports.ts';
import type { AwardGroup } from '../../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductDetailRecord,
  ProductDirectory,
  ProductHandleResolution,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  LaunchHighlights,
  LaunchHighlightsReader,
} from '../launch-highlights-reader.ts';

export const NOW = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 12,
  minute: 0,
});

export const PRODUCT_ID = '01JD0PROD00000000000000001';
export const OPPONENT_ID = '01JD0PROD00000000000000002';
export const OTHER_OPPONENT_ID = '01JD0PROD00000000000000003';
export const OWNER_ID = '01JD0USER00000000000000001';
export const OPPONENT_OWNER_ID = '01JD0USER00000000000000002';
export const STRANGER_ID = '01JD0USER00000000000000009';

export const PRODUCT_HANDLE = 'my-product';

export const date = (value: string): BusinessDate => parseBusinessDate(value);

export const summaryOf = (
  productId: string,
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId,
  ownerUserId: productId === PRODUCT_ID ? OWNER_ID : OPPONENT_OWNER_ID,
  handle: productId === PRODUCT_ID ? PRODUCT_HANDLE : `handle-${productId}`,
  name: `名称${productId.slice(-1)}`,
  tagline: 'タグライン',
  category: { id: 'category-1', name: '開発ツール', handle: 'devtools' },
  websiteUrl: 'https://product.example/',
  logoFileId: `logo-${productId}`,
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

export const detailOf = (productId: string): ProductDetailRecord => ({
  productId,
  descriptionMarkdown: '説明文',
  screenshotFileIds: [`shot-${productId}`],
});

export const launchOf = (
  launchId: string,
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord => ({
  launchId,
  productId: PRODUCT_ID,
  number: 1,
  launchDate: date('2026-11-05'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-11-05T14:40:00.000Z'),
  ...overrides,
});

export interface SideInput {
  readonly entryId: string;
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly upvoteCount?: number;
  readonly result?: EntryResult | null;
}

export const sideOf = (input: SideInput, slot: 1 | 2): MatchEntryRecord => ({
  entryId: input.entryId,
  slot,
  launchId: input.launchId,
  productId: input.productId,
  ownerUserId: input.productId === null ? null : OWNER_ID,
  upvoteCount: input.upvoteCount ?? 0,
  lastUpvotedAt: null,
  lastUpvoteElapsedMs: null,
  forfeited: false,
  result: input.result ?? null,
});

export interface MatchInput {
  readonly matchId: string;
  readonly kind?: MatchKind;
  readonly matchDate?: string;
  readonly phase?: MatchRecord['phase'];
  readonly decision?: MatchDecision | null;
  readonly startsAt?: Date;
  readonly startedAt?: Date | null;
  readonly sides: readonly SideInput[];
}

export const matchOf = (input: MatchInput): MatchRecord => {
  const matchDate = date(input.matchDate ?? '2026-11-05');
  const startsAt =
    input.startsAt ?? fromBusinessDateTime(matchDate, { hour: 0, minute: 0 });
  const phase = input.phase ?? 'finished';
  return {
    matchId: input.matchId,
    kind: input.kind ?? 'qualifier',
    round: null,
    stage: null,
    matchDate,
    decision:
      input.decision === undefined
        ? phase === 'finished'
          ? 'votes'
          : null
        : input.decision,
    endedEarly: false,
    phase,
    startsAt,
    endsAt: fromBusinessDateTime(matchDate, { hour: 23, minute: 40 }),
    startedAt: input.startedAt === undefined ? startsAt : input.startedAt,
    decidedAt:
      phase === 'finished'
        ? fromBusinessDateTime(matchDate, { hour: 23, minute: 41 })
        : null,
    entries: input.sides.map((side, index) =>
      sideOf(side, index === 0 ? 1 : 2),
    ),
  };
};

export const viewerOf = (userId: string): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: userId,
    pseudonymousId: 'pseudonymous-1',
    status: 'active',
    emailVerifiedAt: null,
    deletedAt: null,
    email: 'viewer@mail.example',
    nickname: '閲覧者',
    handle: 'viewer',
  },
});

export const currentResolution = (
  product: ProductSummaryRecord = summaryOf(PRODUCT_ID),
): ProductHandleResolution => ({ kind: 'current', product });

export interface FakeOptions {
  readonly resolution?: ProductHandleResolution;
  readonly detail?: ProductDetailRecord | undefined;
  readonly launches?: readonly LaunchRecord[];
  readonly summaries?: readonly ProductSummaryRecord[];
  readonly matches?: readonly MatchRecord[];
  readonly supporters?: readonly SupporterRecord[];
  readonly highlights?: Partial<LaunchHighlights>;
}

export interface FakeCalls {
  readonly resolveHandle: string[];
  readonly findDetail: string[];
  readonly listLaunches: {
    readonly ids: readonly string[];
    readonly now: Date;
  }[];
  readonly findSummaries: {
    readonly ids: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
  readonly listByLaunches: {
    readonly ids: readonly string[];
    readonly now: Date;
  }[];
  readonly findMatches: {
    readonly ids: readonly string[];
    readonly now: Date;
  }[];
  readonly listSupporters: {
    readonly entryId: string;
    readonly after: SupporterCursor | undefined;
    readonly limit: number;
  }[];
  readonly highlights: Parameters<LaunchHighlightsReader['read']>[0][];
}

const unexpected = (): never => {
  throw new Error('呼ばれない想定の照会');
};

const compareSupporters = (
  first: SupporterRecord,
  second: SupporterRecord,
): number =>
  first.upvotedAt.getTime() - second.upvotedAt.getTime() ||
  first.upvoteId.localeCompare(second.upvoteId);

const isAfter = (
  supporter: SupporterRecord,
  cursor: SupporterCursor | undefined,
): boolean =>
  cursor === undefined ||
  compareSupporters(supporter, {
    upvoteId: cursor.upvoteId,
    userId: '',
    upvotedAt: cursor.upvotedAt,
  }) > 0;

// 照会の引数を記録し、渡したIDに当たる値だけを返す模擬のポート
export function createFakePorts(options: FakeOptions = {}) {
  const calls: FakeCalls = {
    resolveHandle: [],
    findDetail: [],
    listLaunches: [],
    findSummaries: [],
    listByLaunches: [],
    findMatches: [],
    listSupporters: [],
    highlights: [],
  };
  const products: ProductDirectory = {
    resolveHandle: (handle) => {
      calls.resolveHandle.push(handle);
      return Promise.resolve(options.resolution ?? currentResolution());
    },
    findDetail: (productId) => {
      calls.findDetail.push(productId);
      return Promise.resolve(
        'detail' in options ? options.detail : detailOf(productId),
      );
    },
    listLaunches: (ids, now) => {
      calls.listLaunches.push({ ids, now });
      return Promise.resolve(
        Map.groupBy(
          (options.launches ?? []).filter(({ productId }) =>
            ids.includes(productId),
          ),
          ({ productId }) => productId,
        ),
      );
    },
    findSummaries: (ids, scope) => {
      calls.findSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          (options.summaries ?? [])
            .filter(({ productId }) => ids.includes(productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
  };
  const matches: MatchDirectory = {
    listByLaunches: (ids, now) => {
      calls.listByLaunches.push({ ids, now });
      const byLaunch = new Map<string, MatchRecord[]>();
      for (const match of options.matches ?? []) {
        for (const entry of match.entries) {
          if (entry.launchId !== null && ids.includes(entry.launchId)) {
            byLaunch.set(entry.launchId, [
              ...(byLaunch.get(entry.launchId) ?? []),
              match,
            ]);
          }
        }
      }
      return Promise.resolve(byLaunch);
    },
    findMatches: (ids, now) => {
      calls.findMatches.push({ ids, now });
      return Promise.resolve(
        new Map(
          (options.matches ?? [])
            .filter(({ matchId }) => ids.includes(matchId))
            .map((match) => [match.matchId, match]),
        ),
      );
    },
    listForDate: unexpected,
    findQualifierResults: unexpected,
    summarizeDaily: unexpected,
  };
  const supporters: SupporterDirectory = {
    listSupporters: (input) => {
      calls.listSupporters.push(input);
      return Promise.resolve(
        (options.supporters ?? [])
          .toSorted(compareSupporters)
          .filter((supporter) => isAfter(supporter, input.after))
          .slice(0, input.limit),
      );
    },
  };
  const highlights: LaunchHighlightsReader = {
    read: (input) => {
      calls.highlights.push(input);
      return Promise.resolve({
        summaries:
          options.highlights?.summaries ??
          new Map(
            input.launches.map(({ launchId }) => [
              launchId,
              { label: `要約-${launchId}`, inMatch: false },
            ]),
          ),
        awards:
          options.highlights?.awards ??
          new Map<string, readonly AwardGroup[]>(),
      });
    },
  };
  return { calls, products, matches, supporters, highlights };
}
