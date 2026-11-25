import type { RatingStore } from '../../../../lib/core/engagement/ports.ts';
import type {
  MatchEntryRecord,
  MatchRecord,
} from '../../../../lib/core/match/ports.ts';
import type { MatchDirectory } from '../../../../lib/core/match/ports.ts';
import type { MediaFileView } from '../../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../../lib/core/media/ports.ts';
import type { ModerationAction } from '../../../../common-lib/moderation/moderation-actions.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../../lib/core/moderation/ports.ts';
import type {
  AdminProductDirectory,
  AdminProductRecord,
  AdminProductSearchFilter,
  LaunchRecord,
  ProductCategoryDirectory,
  ProductCategoryRecord,
  ProductDetailRecord,
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import type {
  UserHandleResolution,
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';
import {
  parseBusinessDate,
  type BusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import {
  type AdminProductReader,
  DefaultAdminProductReader,
} from '../admin-product-reader.ts';

export const NOW = new Date('2026-11-20T03:00:00.000Z');
export const PRODUCT_ID = '01JQ0PRD000000000000000001';
export const OTHER_PRODUCT_ID = '01JQ0PRD000000000000000002';
export const OPPONENT_PRODUCT_ID = '01JQ0PRD000000000000000003';
export const DELETED_OPPONENT_PRODUCT_ID = '01JQ0PRD000000000000000004';
export const OWNER_ID = '01JQ0USR000000000000000001';
export const OTHER_OWNER_ID = '01JQ0USR000000000000000002';
export const CATEGORY_ID = '01JQ0CAT000000000000000001';
export const LOGO_ID = '01JQ0FIL000000000000000001';
export const OTHER_LOGO_ID = '01JQ0FIL000000000000000002';
export const SCREENSHOT_ID = '01JQ0FIL000000000000000003';
export const QUARANTINED_SCREENSHOT_ID = '01JQ0FIL000000000000000004';
export const MISSING_SCREENSHOT_ID = '01JQ0FIL000000000000000005';
export const LAUNCH_ID = '01JQ0LCH000000000000000001';
export const OLD_LAUNCH_ID = '01JQ0LCH000000000000000002';
export const CANCELED_LAUNCH_ID = '01JQ0LCH000000000000000003';
export const OPPONENT_LAUNCH_ID = '01JQ0LCH000000000000000004';
export const QUALIFIER_MATCH_ID = '01JQ0MCH000000000000000001';
export const WEEK_MATCH_ID = '01JQ0MCH000000000000000002';
export const BYE_MATCH_ID = '01JQ0MCH000000000000000003';
export const NEXT_CURSOR =
  'MTc2MzYwNjgwMDAwMDowMUpRMFBSRDAwMDAwMDAwMDAwMDAwMDAwMg';

export const dateOf = (value: string): BusinessDate => parseBusinessDate(value);

export const summaryOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: 'launch-stadium-tool',
  name: '試合を見守る道具',
  tagline: '投票の行方を見守る',
  category: { id: CATEGORY_ID, name: '開発', handle: 'dev' },
  websiteUrl: 'https://product.example/',
  logoFileId: LOGO_ID,
  hidden: false,
  visible: true,
  listed: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const adminRecordOf = (
  overrides: Partial<AdminProductRecord> = {},
): AdminProductRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: 'launch-stadium-tool',
  name: '試合を見守る道具',
  category: { id: CATEGORY_ID, name: '開発' },
  logoFileId: LOGO_ID,
  hiddenAt: null,
  visibility: 'visible',
  latestLaunch: {
    launchId: LAUNCH_ID,
    launchDate: dateOf('2026-11-19'),
    state: 'won',
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const userOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: OWNER_ID,
  handle: 'owner-handle',
  nickname: '投稿者のなまえ',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

export const fileOf = (
  id: string,
  overrides: Partial<MediaFileView> = {},
): MediaFileView => ({
  id,
  objectKey: `images/${id}`,
  purpose: 'product-logo',
  storage: 'images',
  location: 'images',
  owner: { kind: 'user', id: OWNER_ID },
  originalFileName: 'logo.png',
  contentType: 'image/png',
  byteSize: 1024,
  width: 256,
  height: 256,
  stored: true,
  attached: true,
  deletedAt: null,
  eraseRequested: false,
  moderationStatus: 'passed',
  quarantineReasons: [],
  quarantined: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const launchOf = (
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord => ({
  launchId: LAUNCH_ID,
  productId: PRODUCT_ID,
  number: 2,
  launchDate: dateOf('2026-11-19'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-11-19T14:40:00.000Z'),
  ...overrides,
});

export const entryOf = (
  overrides: Partial<MatchEntryRecord> = {},
): MatchEntryRecord => ({
  entryId: '01JQ0ENT000000000000000001',
  slot: 1,
  launchId: LAUNCH_ID,
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  upvoteCount: 12,
  lastUpvotedAt: null,
  lastUpvoteElapsedMs: null,
  forfeited: false,
  result: 'won',
  ...overrides,
});

export const matchOf = (overrides: Partial<MatchRecord> = {}): MatchRecord => ({
  matchId: QUALIFIER_MATCH_ID,
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: dateOf('2026-11-19'),
  decision: 'votes',
  endedEarly: false,
  phase: 'finished',
  startsAt: new Date('2026-11-18T15:00:00.000Z'),
  endsAt: new Date('2026-11-19T14:40:00.000Z'),
  startedAt: new Date('2026-11-18T15:00:00.000Z'),
  decidedAt: new Date('2026-11-19T14:40:00.000Z'),
  entries: [],
  ...overrides,
});

const unexpected = (name: string) => () =>
  Promise.reject(new Error(`${name}は呼ばれない想定です`));

export interface HarnessOptions {
  readonly searchResult?: {
    readonly products: readonly AdminProductRecord[];
    readonly nextCursor: string | null;
  };
  readonly handleResolution?: UserHandleResolution;
  readonly summaries?: readonly ProductSummaryRecord[];
  readonly detail?: ProductDetailRecord;
  readonly launches?: readonly LaunchRecord[];
  readonly matches?: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly users?: readonly UserSummaryRecord[];
  readonly files?: readonly MediaFileView[];
  readonly ratingSummary?: {
    readonly average: number | null;
    readonly count: number;
  };
  readonly latest?: LatestModeration;
  readonly categories?: readonly ProductCategoryRecord[];
  readonly searchError?: Error;
}

export const createHarness = (options: HarnessOptions = {}) => {
  const calls = {
    search: [] as {
      filter: AdminProductSearchFilter;
      page: { readonly after?: string; readonly limit: number };
      now: Date;
    }[],
    resolveHandle: [] as string[],
    findSummaries: [] as {
      ids: readonly string[];
      scope: ProductLookupScope;
    }[],
    findDetail: [] as string[],
    listLaunches: [] as { ids: readonly string[]; now: Date }[],
    listByLaunches: [] as { ids: readonly string[]; now: Date }[],
    userSummaries: [] as { ids: readonly string[]; scope: UserLookupScope }[],
    findMany: [] as (readonly string[])[],
    ratingSummaries: [] as (readonly string[])[],
    latestFor: [] as {
      targetIds: readonly string[];
      actions: readonly ModerationAction[];
    }[],
    categories: 0,
  };
  const summaries = options.summaries ?? [summaryOf()];
  const directory: AdminProductDirectory = {
    search: (filter, page, now) => {
      calls.search.push({ filter, page, now });
      if (options.searchError !== undefined) {
        return Promise.reject(options.searchError);
      }
      return Promise.resolve(
        options.searchResult ?? {
          products: [adminRecordOf()],
          nextCursor: null,
        },
      );
    },
    countRegisteredAt: unexpected('countRegisteredAt'),
  };
  const products: ProductDirectory = {
    findSummaries: (ids, scope) => {
      calls.findSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          summaries
            .filter(({ productId }) => ids.includes(productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    resolveHandle: unexpected('ProductDirectory.resolveHandle'),
    findDetail: (productId) => {
      calls.findDetail.push(productId);
      return Promise.resolve(
        options.detail === undefined && productId === PRODUCT_ID
          ? {
              productId,
              descriptionMarkdown: '## 説明',
              screenshotFileIds: [SCREENSHOT_ID],
            }
          : options.detail,
      );
    },
    listLaunches: (ids, now) => {
      calls.listLaunches.push({ ids, now });
      const launches = options.launches ?? [];
      return Promise.resolve(
        launches.length === 0 ? new Map() : new Map([[PRODUCT_ID, launches]]),
      );
    },
  };
  const matchDirectory: MatchDirectory = {
    findMatches: unexpected('findMatches'),
    listForDate: unexpected('listForDate'),
    listByLaunches: (ids, now) => {
      calls.listByLaunches.push({ ids, now });
      return Promise.resolve(options.matches ?? new Map());
    },
    findQualifierResults: unexpected('findQualifierResults'),
    summarizeDaily: unexpected('summarizeDaily'),
  };
  const users = options.users ?? [userOf()];
  const profiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.userSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          users
            .filter(({ userId }) => ids.includes(userId))
            .map((user) => [user.userId, user]),
        ),
      );
    },
    resolveHandle: (handle) => {
      calls.resolveHandle.push(handle);
      return Promise.resolve(options.handleResolution ?? { kind: 'none' });
    },
  };
  const files = options.files ?? [fileOf(LOGO_ID), fileOf(SCREENSHOT_ID)];
  const media: MediaFiles = {
    claim: unexpected('claim'),
    markDeleted: unexpected('markDeleted'),
    eraseNow: unexpected('eraseNow'),
    eraseOwnedBy: unexpected('eraseOwnedBy'),
    listOwnerIds: unexpected('listOwnerIds'),
    findMany: (ids) => {
      calls.findMany.push(ids);
      return Promise.resolve(
        new Map(
          files
            .filter(({ id }) => ids.includes(id))
            .map((file) => [file.id, file]),
        ),
      );
    },
    openContent: unexpected('openContent'),
  };
  const ratings: RatingStore = {
    remove: unexpected('remove'),
    findScore: unexpected('findScore'),
    summaries: (ids) => {
      calls.ratingSummaries.push(ids);
      return Promise.resolve(
        options.ratingSummary === undefined
          ? new Map()
          : new Map([[PRODUCT_ID, options.ratingSummary]]),
      );
    },
  };
  const records: ModerationRecordStore = {
    find: unexpected('find'),
    latestFor: (input) => {
      calls.latestFor.push(input);
      return Promise.resolve(
        options.latest === undefined
          ? new Map()
          : new Map([[PRODUCT_ID, options.latest]]),
      );
    },
    listPendingNotices: unexpected('listPendingNotices'),
    markNotice: unexpected('markNotice'),
    eraseBySubjectUser: unexpected('eraseBySubjectUser'),
    eraseByProduct: unexpected('eraseByProduct'),
    eraseOccurredBefore: unexpected('eraseOccurredBefore'),
  };
  const categoryDirectory: ProductCategoryDirectory = {
    list: () => {
      calls.categories += 1;
      return Promise.resolve(options.categories ?? []);
    },
    findByHandle: unexpected('findByHandle'),
  };
  const reader: AdminProductReader = new DefaultAdminProductReader(
    directory,
    products,
    categoryDirectory,
    matchDirectory,
    profiles,
    media,
    ratings,
    records,
  );
  return { reader, calls };
};
