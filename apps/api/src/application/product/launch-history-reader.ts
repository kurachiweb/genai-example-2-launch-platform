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
  ProductListPosition,
} from './ports.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export const LAUNCH_HISTORY_PAGE_MAX = 20;

// ローンチの一括の読み取りが1つの文で扱うIDの数(D1のバインドの上限による90件)に合わせる
export const LAUNCH_HISTORY_AWARDS_PAGE_SIZE = 90;

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

export interface LaunchHistoryAwardsInput {
  readonly userHandle: string;
}

export interface LaunchHistoryReader {
  // 他人には掲載済みの、本人には論理削除と非公開化を除く自分のプロダクトを最新のローンチ日の新しい順に返す。利用者を表示できなければnull。カーソルの誤りはinvalid_cursor
  list(
    session: SessionView,
    input: LaunchHistoryInput,
  ): Promise<LaunchHistoryPage | null>;
  // 公開プロフィールの受賞バッジ。listと同じ範囲の全てのプロダクトの受賞を、Yearを先頭に'<名称> <受賞のラベル>'のラベルでまとめる。利用者を表示できなければnull
  awards(
    session: SessionView,
    input: LaunchHistoryAwardsInput,
  ): Promise<readonly AwardGroup[] | null>;
}

interface LaunchHistoryTarget {
  readonly userId: string;
  readonly viewerIsOwner: boolean;
  readonly suspended: boolean;
  readonly scope: LaunchHistoryScope;
}

type SummaryResult = Awaited<ReturnType<LaunchSummarySource['summarize']>>;

type LaunchesOf = (productId: string) => readonly LaunchRecord[];

interface PageSummaries {
  readonly launches: ReadonlyMap<string, LaunchSummaryView>;
  readonly awards: ReadonlyMap<string, readonly AwardEntry[]>;
}

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

function toPageSummaries(results: readonly SummaryResult[]): PageSummaries {
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

// 対象のページに無いプロダクトの受賞は名称が分からないため除く
function toNamedAwards(
  products: readonly LaunchHistoryProductRecord[],
  awards: readonly ProductAwardContribution[],
): readonly AwardEntry[] {
  const names = new Map(
    products.map(({ productId, name }) => [productId, name]),
  );
  return awards.flatMap(({ productId, kind, label }) => {
    const name = names.get(productId);
    return name === undefined ? [] : [{ kind, label: `${name} ${label}` }];
  });
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

const positionOf = (
  record: LaunchHistoryProductRecord,
): ProductListPosition => ({
  latestLaunchDate: record.latestLaunchDate,
  id: record.productId,
});

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
    const target = await this.#resolveTarget(session, input.userHandle);
    if (target === null) {
      return null;
    }
    const { userId, scope } = target;
    const [totalCount, rows] = await Promise.all([
      this.store.count({ userId, scope }),
      // 続きの有無を知るため1件多く読む
      this.store.list({ userId, scope, limit: first + 1, before }),
    ]);
    const products = rows.slice(0, first);
    const last = products.at(-1);
    return {
      viewerIsOwner: target.viewerIsOwner,
      ownerSuspended: target.suspended,
      totalCount,
      nodes: await this.#toItems(products),
      hasNextPage: rows.length > first,
      endCursor:
        last === undefined ? null : encodeMyProductsCursor(positionOf(last)),
    };
  }

  async awards(
    session: SessionView,
    input: LaunchHistoryAwardsInput,
  ): Promise<readonly AwardGroup[] | null> {
    const target = await this.#resolveTarget(session, input.userHandle);
    if (target === null) {
      return null;
    }
    return groupAwards(
      await this.#collectAwards(target, this.clock.now(), undefined),
    );
  }

  // 形式違反・不在の利用者と、本人以外から見た停止中の利用者はnull。旧ハンドルはその利用者として扱う
  async #resolveTarget(
    session: SessionView,
    userHandle: string,
  ): Promise<LaunchHistoryTarget | null> {
    if (!isHandleFormat(userHandle)) {
      return null;
    }
    const [viewer, resolution] = await Promise.all([
      this.guard.currentUser(session),
      this.users.resolveHandle(userHandle),
    ]);
    if (resolution.kind === 'none') {
      return null;
    }
    const { userId, suspended } = resolution.user;
    const viewerIsOwner = viewer?.user.id === userId;
    if (suspended && !viewerIsOwner) {
      return null;
    }
    return {
      userId,
      viewerIsOwner,
      suspended,
      scope: viewerIsOwner ? 'owner' : 'public',
    };
  }

  // 対象のプロダクトを最後のページまで順に読み、ページごとにローンチの読み取りと供給元の呼び出しを1回ずつ行う
  async #collectAwards(
    target: LaunchHistoryTarget,
    now: Date,
    before: ProductListPosition | undefined,
  ): Promise<readonly AwardEntry[]> {
    const products = await this.store.list({
      userId: target.userId,
      scope: target.scope,
      limit: LAUNCH_HISTORY_AWARDS_PAGE_SIZE,
      before,
    });
    const last = products.at(-1);
    if (last === undefined) {
      return [];
    }
    const launchesOf = await this.#readLaunches(products, now);
    const results = await this.#summarize(
      products.flatMap(({ productId }) => launchesOf(productId)),
      now,
    );
    const awards = toNamedAwards(
      products,
      results.flatMap((result) => result.awards),
    );
    if (products.length < LAUNCH_HISTORY_AWARDS_PAGE_SIZE) {
      return awards;
    }
    return [
      ...awards,
      ...(await this.#collectAwards(target, now, positionOf(last))),
    ];
  }

  async #toItems(
    products: readonly LaunchHistoryProductRecord[],
  ): Promise<readonly LaunchHistoryItemView[]> {
    if (products.length === 0) {
      return [];
    }
    const now = this.clock.now();
    const launchesOf = await this.#readLaunches(products, now);
    const summaries = toPageSummaries(
      await this.#summarize(
        products.flatMap(({ productId }) => launchesOf(productId)),
        now,
      ),
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

  // 取消のローンチは履歴にも供給元にも渡さない
  async #readLaunches(
    products: readonly LaunchHistoryProductRecord[],
    now: Date,
  ): Promise<LaunchesOf> {
    const launchesByProduct = await this.directory.listLaunches(
      products.map(({ productId }) => productId),
      now,
    );
    return (productId) =>
      (launchesByProduct.get(productId) ?? []).filter(
        ({ status }) => status !== 'canceled',
      );
  }

  // 供給元の失敗は警告のログを残してその供給元を除き、要約の無いローンチは呼び出し側で予選の結果から作る
  async #summarize(
    launches: readonly LaunchRecord[],
    at: Date,
  ): Promise<readonly SummaryResult[]> {
    if (launches.length === 0 || this.summarySources.length === 0) {
      return [];
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
    return results;
  }
}
