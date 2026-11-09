import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import {
  type AwardEntry,
  type AwardGroup,
  fallbackLaunchSummary,
  groupAwards,
  type LaunchSummaryView,
} from '../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  callDecisionSources,
  type LaunchSummaryContribution,
  type LaunchSummarySource,
  type ProductAwardContribution,
  type RegisteredDecisionSource,
} from './decision-sources.ts';
import {
  decodeMyProductsCursor,
  encodeMyProductsCursor,
} from './my-products-cursor.ts';
import type {
  LaunchHistoryProductRecord,
  LaunchHistoryScope,
  LaunchHistoryStore,
} from './ports.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export const LAUNCH_HISTORY_PAGE_MAX = 20;

export interface LaunchHistoryLaunchView extends LaunchRecord {
  readonly summary: LaunchSummaryView;
}

export interface LaunchHistoryItemView {
  readonly product: ProductSummaryRecord;
  // 取消を除く、新しい順
  readonly launches: readonly LaunchHistoryLaunchView[];
  // Yearを先頭
  readonly awards: readonly AwardGroup[];
}

export interface LaunchHistoryPage {
  readonly viewerIsOwner: boolean;
  // 本人にだけ真になり得る
  readonly ownerSuspended: boolean;
  readonly totalCount: number;
  readonly nodes: readonly LaunchHistoryItemView[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface LaunchHistoryInput {
  readonly userHandle: string;
  // 1〜20で、範囲外はRangeErrorのため呼び出し元の境界で検証する
  readonly first: number;
  readonly after: string | undefined;
}

export interface LaunchHistoryReader {
  // 他人には掲載済みの、本人には論理削除と非公開化を除く自分のプロダクトを最新のローンチ日の新しい順に返す。利用者を表示できなければnull。カーソルの誤りはinvalid_cursor
  list(
    session: SessionView,
    input: LaunchHistoryInput,
  ): Promise<LaunchHistoryPage | null>;
}

interface PageSummaries {
  readonly launches: ReadonlyMap<string, LaunchSummaryView>;
  readonly awards: ReadonlyMap<string, readonly AwardEntry[]>;
}

const NO_SUMMARIES: PageSummaries = Object.freeze({
  launches: new Map(),
  awards: new Map(),
});

// 供給元は登録の順に並んでいるため、同じ順位なら先の供給元の要約が残る
function pickSummaries(
  contributions: readonly LaunchSummaryContribution[],
): ReadonlyMap<string, LaunchSummaryContribution> {
  const picked = new Map<string, LaunchSummaryContribution>();
  for (const contribution of contributions) {
    const current = picked.get(contribution.launchId);
    if (current === undefined || contribution.rank > current.rank) {
      picked.set(contribution.launchId, contribution);
    }
  }
  return picked;
}

function toPageSummaries(
  results: readonly {
    readonly launches: readonly LaunchSummaryContribution[];
    readonly awards: readonly ProductAwardContribution[];
  }[],
): PageSummaries {
  const picked = pickSummaries(results.flatMap(({ launches }) => launches));
  return {
    launches: new Map(
      [...picked].map(([launchId, { label, inMatch }]) => [
        launchId,
        { label, inMatch },
      ]),
    ),
    awards: Map.groupBy(
      results.flatMap(({ awards }) => awards),
      ({ productId }) => productId,
    ),
  };
}

function toProductSummary(
  record: LaunchHistoryProductRecord,
): ProductSummaryRecord {
  return {
    productId: record.productId,
    ownerUserId: record.ownerUserId,
    handle: record.handle,
    name: record.name,
    tagline: record.tagline,
    category: record.category,
    websiteUrl: record.websiteUrl,
    logoFileId: record.logoFileId,
    hidden: record.hidden,
    visible: record.visible,
    listed: record.listed,
    createdAt: record.createdAt,
  };
}

const isHandleFormat = (handle: string): boolean =>
  checkHandleFormat(handle, USER_HANDLE_RULE) === 'ok';

@injectable()
export class StoreLaunchHistoryReader implements LaunchHistoryReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly users: UserProfileDirectory,
    @inject(PRODUCT_TYPES.LaunchHistoryStore)
    private readonly store: LaunchHistoryStore,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly directory: ProductDirectory,
    @inject(PRODUCT_TYPES.LaunchSummarySources)
    private readonly summarySources: readonly RegisteredDecisionSource<LaunchSummarySource>[],
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async list(
    session: SessionView,
    input: LaunchHistoryInput,
  ): Promise<LaunchHistoryPage | null> {
    const { first } = input;
    if (
      !Number.isInteger(first) ||
      first < 1 ||
      first > LAUNCH_HISTORY_PAGE_MAX
    ) {
      throw new RangeError(
        `ローンチ履歴の件数は1〜${String(LAUNCH_HISTORY_PAGE_MAX)}件で指定してください: ${String(first)}`,
      );
    }
    const before =
      input.after === undefined
        ? undefined
        : decodeMyProductsCursor(input.after);
    if (!isHandleFormat(input.userHandle)) {
      return null;
    }
    const [viewer, resolution] = await Promise.all([
      this.guard.currentUser(session),
      this.users.resolveHandle(input.userHandle),
    ]);
    if (resolution.kind === 'none') {
      return null;
    }
    const target = resolution.user;
    const viewerIsOwner = viewer?.user.id === target.userId;
    if (target.suspended && !viewerIsOwner) {
      return null;
    }
    const scope: LaunchHistoryScope = viewerIsOwner ? 'owner' : 'public';
    const [totalCount, rows] = await Promise.all([
      this.store.count({ userId: target.userId, scope }),
      // 続きの有無を知るため1件多く読む
      this.store.list({
        userId: target.userId,
        scope,
        limit: first + 1,
        before,
      }),
    ]);
    const products = rows.slice(0, first);
    const last = products.at(-1);
    return {
      viewerIsOwner,
      ownerSuspended: target.suspended,
      totalCount,
      nodes: await this.#toItems(products),
      hasNextPage: rows.length > first,
      endCursor:
        last === undefined
          ? null
          : encodeMyProductsCursor({
              latestLaunchDate: last.latestLaunchDate,
              id: last.productId,
            }),
    };
  }

  async #toItems(
    products: readonly LaunchHistoryProductRecord[],
  ): Promise<readonly LaunchHistoryItemView[]> {
    if (products.length === 0) {
      return [];
    }
    const now = this.clock.now();
    const launchesByProduct = await this.directory.listLaunches(
      products.map(({ productId }) => productId),
      now,
    );
    const launchesOf = (productId: string): readonly LaunchRecord[] =>
      (launchesByProduct.get(productId) ?? []).filter(
        ({ status }) => status !== 'canceled',
      );
    const summaries = await this.#summarize(
      products.flatMap(({ productId }) => launchesOf(productId)),
      now,
    );
    return products.map((product) => ({
      product: toProductSummary(product),
      launches: launchesOf(product.productId).map((launch) => ({
        ...launch,
        summary:
          summaries.launches.get(launch.launchId) ??
          fallbackLaunchSummary(launch),
      })),
      awards: groupAwards(summaries.awards.get(product.productId) ?? []),
    }));
  }

  // 供給元の失敗は警告のログを残してその供給元を除き、要約の無いローンチは呼び出し側で予選の結果から作る
  async #summarize(
    launches: readonly LaunchRecord[],
    at: Date,
  ): Promise<PageSummaries> {
    if (launches.length === 0 || this.summarySources.length === 0) {
      return NO_SUMMARIES;
    }
    const { results } = await callDecisionSources(
      this.summarySources,
      (source) =>
        source.summarize({
          launches: launches.map(({ launchId, productId, outcome }) => ({
            launchId,
            productId,
            outcome,
          })),
          at,
        }),
    );
    return toPageSummaries(results);
  }
}
