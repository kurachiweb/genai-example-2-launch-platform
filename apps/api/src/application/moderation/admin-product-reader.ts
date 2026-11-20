import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  RatingStore,
  RatingSummary,
} from '../../../lib/core/engagement/ports.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchPhase,
  MatchStage,
} from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  AdminProductDirectory,
  AdminProductLaunchState,
  AdminProductRecord,
  AdminProductSearchFilter,
  AdminProductVisibility,
  LaunchRecord,
  ProductCategoryDirectory,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export interface AdminProductListFilter {
  // 部分一致
  readonly name?: string;
  // 部分一致
  readonly handle?: string;
  // 旧ハンドルはその利用者として扱う
  readonly ownerHandle?: string;
  readonly categoryId?: string;
  readonly launchState?: AdminProductLaunchState;
  readonly visibility?: AdminProductVisibility;
}

export interface AdminProductOwner {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

export interface AdminProductLatestLaunch {
  readonly launchId: string;
  readonly launchDate: BusinessDate;
  readonly state: AdminProductLaunchState;
}

export interface AdminProductItem {
  readonly productId: string;
  readonly handle: string;
  readonly name: string;
  // ファイルの記録が照会で返らなければnull
  readonly logo: MediaFileView | null;
  // 退会済み・物理削除済みの投稿者はnull
  readonly owner: AdminProductOwner | null;
  readonly category: { readonly id: string; readonly name: string };
  readonly latestLaunch: AdminProductLatestLaunch | null;
  readonly visibility: AdminProductVisibility;
}

export interface AdminProductPage {
  readonly products: readonly AdminProductItem[];
  readonly nextCursor: string | null;
}

export interface AdminProductMatchResult {
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly upvoteCount: number;
  // 未確定はnull
  readonly result: EntryResult | null;
  // 照会の時点で導いた進み具合
  readonly phase: MatchPhase;
  // 未確定はnull
  readonly decision: MatchDecision | null;
  // 不戦勝・相手の物理削除・論理削除はnull
  readonly opponentName: string | null;
}

export interface AdminProductLaunch {
  readonly launchId: string;
  // 取消は0
  readonly number: number;
  readonly launchDate: BusinessDate;
  readonly state: AdminProductLaunchState;
  // 実施日の新しい順
  readonly matches: readonly AdminProductMatchResult[];
}

export interface AdminProductHideNote {
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface AdminProductDetail {
  readonly product: AdminProductItem;
  readonly tagline: string;
  readonly descriptionMarkdown: string;
  readonly websiteUrl: string;
  // 表示順。ファイルの記録が照会で返らないものは除く
  readonly screenshots: readonly MediaFileView[];
  // 非公開化中のときだけ、最新の非公開化の記録から入れる
  readonly hiddenAt: Date | null;
  readonly latestHide: AdminProductHideNote | null;
  readonly ratingSummary: RatingSummary;
  // ローンチ日の新しい順で、取消を含む
  readonly launches: readonly AdminProductLaunch[];
}

export interface AdminCategoryOption {
  readonly id: string;
  readonly name: string;
}

// 権限の確認は呼び出し側のリゾルバが行う
export interface AdminProductReader {
  // 論理削除済みを除き、登録日時の新しい順。firstは呼び出し側が1〜50で渡す。不正なafterは上流のAppError(bad_request, invalid_cursor)をそのまま投げる
  list(input: {
    readonly filter: AdminProductListFilter;
    readonly first: number;
    readonly after?: string;
    readonly now: Date;
  }): Promise<AdminProductPage>;
  // 存在しない・論理削除済みはnull
  detail(input: {
    readonly productId: string;
    readonly now: Date;
  }): Promise<AdminProductDetail | null>;
  categories(): Promise<readonly AdminCategoryOption[]>;
}

const EMPTY_PAGE: AdminProductPage = Object.freeze({
  products: [],
  nextCursor: null,
});

const NO_RATINGS: RatingSummary = Object.freeze({ average: null, count: 0 });

const ownerOf = (
  user: UserSummaryRecord | undefined,
): AdminProductOwner | null =>
  user === undefined
    ? null
    : {
        userId: user.userId,
        handle: user.handle,
        nickname: user.nickname,
        suspended: user.suspended,
      };

// 一覧の照会と同じく、組み合わせの後(paired)もローンチ日の前なので予約中にまとめる
const launchStateOf = (launch: LaunchRecord): AdminProductLaunchState => {
  if (launch.status === 'canceled') {
    return 'canceled';
  }
  if (launch.outcome !== null) {
    return launch.outcome;
  }
  return launch.status === 'in_progress' ? 'in_progress' : 'scheduled';
};

const visibilityOf = (
  summary: ProductSummaryRecord,
  owner: AdminProductOwner | null,
): AdminProductVisibility => {
  if (summary.hidden) {
    return 'hidden';
  }
  return owner?.suspended === true ? 'owner_suspended' : 'visible';
};

const opponentProductIdsOf = (
  matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]>,
): readonly string[] => {
  const ids = [...matchesByLaunch].flatMap(([launchId, matches]) =>
    matches.flatMap(({ entries }) =>
      entries
        .filter((entry) => entry.launchId !== launchId)
        .flatMap(({ productId }) => (productId === null ? [] : [productId])),
    ),
  );
  return [...new Set(ids)];
};

const matchResultsOf = (
  launchId: string,
  matches: readonly MatchRecord[],
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): readonly AdminProductMatchResult[] =>
  matches.flatMap((match) => {
    const own = match.entries.find((entry) => entry.launchId === launchId);
    if (own === undefined) {
      return [];
    }
    const opponentProductId =
      match.entries.find((entry) => entry !== own)?.productId ?? null;
    return [
      {
        matchId: match.matchId,
        kind: match.kind,
        round: match.round,
        stage: match.stage,
        matchDate: match.matchDate,
        upvoteCount: own.upvoteCount,
        result: own.result,
        phase: match.phase,
        decision: match.decision,
        opponentName:
          opponentProductId === null
            ? null
            : (opponents.get(opponentProductId)?.name ?? null),
      },
    ];
  });

interface LaunchHistory {
  readonly launches: readonly LaunchRecord[];
  readonly matches: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>;
}

@injectable()
export class DefaultAdminProductReader implements AdminProductReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.AdminProductDirectory)
    private readonly directory: AdminProductDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory)
    private readonly categoryDirectory: ProductCategoryDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStore)
    private readonly ratings: RatingStore,
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly records: ModerationRecordStore,
  ) {}

  async list({
    filter,
    first,
    after,
    now,
  }: Parameters<AdminProductReader['list']>[0]): Promise<AdminProductPage> {
    const searchFilter = await this.#searchFilterOf(filter);
    if (searchFilter === null) {
      return EMPTY_PAGE;
    }
    const { products, nextCursor } = await this.directory.search(
      searchFilter,
      after === undefined ? { limit: first } : { after, limit: first },
      now,
    );
    if (products.length === 0) {
      return { products: [], nextCursor };
    }
    // プロダクトの数に比例した問い合わせをしないため、ページの投稿者とロゴをそれぞれ1回の照会で読む
    const [owners, logos] = await Promise.all([
      this.profiles.findSummaries(
        [...new Set(products.map(({ ownerUserId }) => ownerUserId))],
        'not-withdrawn',
      ),
      this.media.findMany([
        ...new Set(products.map(({ logoFileId }) => logoFileId)),
      ]),
    ]);
    return {
      products: products.map((record) => this.#itemOf(record, owners, logos)),
      nextCursor,
    };
  }

  async detail({
    productId,
    now,
  }: Parameters<
    AdminProductReader['detail']
  >[0]): Promise<AdminProductDetail | null> {
    const summary = (
      await this.products.findSummaries([productId], 'not-deleted')
    ).get(productId);
    if (summary === undefined) {
      return null;
    }
    const [detail, history, owners, ratings, latestHides] = await Promise.all([
      this.products.findDetail(productId),
      this.#launchHistoryOf(productId, now),
      this.profiles.findSummaries([summary.ownerUserId], 'not-withdrawn'),
      this.ratings.summaries([productId]),
      summary.hidden
        ? this.records.latestFor({
            targetIds: [productId],
            actions: ['product.hide'],
          })
        : Promise.resolve(new Map<string, LatestModeration>()),
    ]);
    if (detail === undefined) {
      return null;
    }
    const files = await this.media.findMany([
      ...new Set([summary.logoFileId, ...detail.screenshotFileIds]),
    ]);
    const owner = ownerOf(owners.get(summary.ownerUserId));
    const latestHide = latestHides.get(productId);
    const [latest] = history.launches;
    return {
      product: {
        productId,
        handle: summary.handle,
        name: summary.name,
        logo: files.get(summary.logoFileId) ?? null,
        owner,
        category: { id: summary.category.id, name: summary.category.name },
        latestLaunch:
          latest === undefined
            ? null
            : {
                launchId: latest.launchId,
                launchDate: latest.launchDate,
                state: launchStateOf(latest),
              },
        visibility: visibilityOf(summary, owner),
      },
      tagline: summary.tagline,
      descriptionMarkdown: detail.descriptionMarkdown,
      websiteUrl: summary.websiteUrl,
      screenshots: detail.screenshotFileIds.flatMap((fileId) => {
        const file = files.get(fileId);
        return file === undefined ? [] : [file];
      }),
      hiddenAt: latestHide?.occurredAt ?? null,
      latestHide:
        latestHide === undefined
          ? null
          : { reason: latestHide.reason, occurredAt: latestHide.occurredAt },
      ratingSummary: ratings.get(productId) ?? NO_RATINGS,
      launches: history.launches.map((launch) => ({
        launchId: launch.launchId,
        number: launch.number,
        launchDate: launch.launchDate,
        state: launchStateOf(launch),
        matches: matchResultsOf(
          launch.launchId,
          history.matches.get(launch.launchId) ?? [],
          history.opponents,
        ),
      })),
    };
  }

  async categories(): Promise<readonly AdminCategoryOption[]> {
    const categories = await this.categoryDirectory.list();
    return categories.map(({ id, name }) => ({ id, name }));
  }

  // 投稿者のハンドルに該当する利用者がいなければnull
  async #searchFilterOf({
    ownerHandle,
    ...rest
  }: AdminProductListFilter): Promise<AdminProductSearchFilter | null> {
    if (ownerHandle === undefined) {
      return rest;
    }
    const resolution = await this.profiles.resolveHandle(ownerHandle);
    if (resolution.kind === 'none') {
      return null;
    }
    return { ...rest, ownerUserId: resolution.user.userId };
  }

  #itemOf(
    record: AdminProductRecord,
    owners: ReadonlyMap<string, UserSummaryRecord>,
    logos: ReadonlyMap<string, MediaFileView>,
  ): AdminProductItem {
    return {
      productId: record.productId,
      handle: record.handle,
      name: record.name,
      logo: logos.get(record.logoFileId) ?? null,
      owner: ownerOf(owners.get(record.ownerUserId)),
      category: record.category,
      latestLaunch: record.latestLaunch,
      visibility: record.visibility,
    };
  }

  async #launchHistoryOf(productId: string, now: Date): Promise<LaunchHistory> {
    const launches =
      (await this.products.listLaunches([productId], now)).get(productId) ?? [];
    if (launches.length === 0) {
      return { launches, matches: new Map(), opponents: new Map() };
    }
    const matches = await this.matches.listByLaunches(
      launches.map(({ launchId }) => launchId),
      now,
    );
    const opponentIds = opponentProductIdsOf(matches);
    const opponents =
      opponentIds.length === 0
        ? new Map<string, ProductSummaryRecord>()
        : await this.products.findSummaries(opponentIds, 'not-deleted');
    return { launches, matches, opponents };
  }
}
