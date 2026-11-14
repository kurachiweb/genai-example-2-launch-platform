import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchKind,
  MatchStage,
} from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import { MATCH_TYPES } from './match-types.ts';
import { type MatchProductView, productViewOf } from './match-view-reader.ts';
import type { UpvoteHistoryRecord, UpvoteHistoryStore } from './ports.ts';
import {
  decodeUpvoteHistoryCursor,
  encodeUpvoteHistoryCursor,
} from './upvote-history-cursor.ts';

export const UPVOTE_HISTORY_PAGE_MAX = 20;

export interface UpvoteHistoryEntry {
  readonly upvoteId: string;
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  // Upvoteを受け付けている間だけ真
  readonly live: boolean;
  readonly product: MatchProductView;
  readonly ownerUserId: string;
}

export interface UpvoteHistoryDateTotal {
  readonly date: BusinessDate;
  // 読み込み済みの項目の数ではなく、その日の除外を除いた総数
  readonly count: number;
}

export interface UpvoteHistoryPage {
  readonly totalCount: number;
  // ページ内の項目の実施日を新しい順に
  readonly dateTotals: readonly UpvoteHistoryDateTotal[];
  readonly entries: readonly UpvoteHistoryEntry[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface UpvoteHistoryInput {
  readonly userHandle: string;
  readonly viewer: CurrentUser | undefined;
  // 1〜20で、範囲外はRangeErrorのため呼び出し元の境界で検証する
  readonly first: number;
  readonly after: string | undefined;
  readonly now: Date;
}

export interface UpvoteHistoryReader {
  // 利用者の有効なUpvoteを実施日・Upvoteの日時の新しい順に返す。利用者を表示できなければnull。カーソルの誤りはinvalid_cursor
  read(input: UpvoteHistoryInput): Promise<UpvoteHistoryPage | null>;
}

const isHandleFormat = (handle: string): boolean =>
  checkHandleFormat(handle, USER_HANDLE_RULE) === 'ok';

function entryOf(
  row: UpvoteHistoryRecord,
  record: MatchRecord | undefined,
  summary: ProductSummaryRecord | undefined,
): UpvoteHistoryEntry[] {
  if (record === undefined || summary?.visible !== true) {
    return [];
  }
  return [
    {
      upvoteId: row.upvoteId,
      matchId: row.matchId,
      kind: record.kind,
      round: record.round,
      stage: record.stage,
      matchDate: row.matchDate,
      live: record.phase === 'live',
      product: productViewOf(summary),
      ownerUserId: summary.ownerUserId,
    },
  ];
}

@injectable()
export class StoreUpvoteHistoryReader implements UpvoteHistoryReader {
  constructor(
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly users: UserProfileDirectory,
    @inject(MATCH_TYPES.UpvoteHistoryStore)
    private readonly store: UpvoteHistoryStore,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async read(input: UpvoteHistoryInput): Promise<UpvoteHistoryPage | null> {
    const { first } = input;
    if (
      !Number.isInteger(first) ||
      first < 1 ||
      first > UPVOTE_HISTORY_PAGE_MAX
    ) {
      throw new RangeError(
        `Upvote履歴の件数は1〜${String(UPVOTE_HISTORY_PAGE_MAX)}件で指定してください: ${String(first)}`,
      );
    }
    const before =
      input.after === undefined
        ? undefined
        : decodeUpvoteHistoryCursor(input.after);
    const userId = await this.#resolveUserId(input);
    if (userId === null) {
      return null;
    }
    const [totalCount, rows] = await Promise.all([
      this.store.count(userId),
      // 続きの有無を知るため1件多く読む
      this.store.list({ userId, limit: first + 1, before }),
    ]);
    const page = rows.slice(0, first);
    const last = page.at(-1);
    const { entries, dateTotals } = await this.#assemble(
      userId,
      page,
      input.now,
    );
    return {
      totalCount,
      dateTotals,
      entries,
      hasNextPage: rows.length > first,
      endCursor:
        last === undefined
          ? null
          : encodeUpvoteHistoryCursor({
              matchDate: last.matchDate,
              matchId: last.matchId,
            }),
    };
  }

  // 形式違反・不在・退会済みの利用者と、本人以外から見た停止中の利用者はnull。旧ハンドルはその利用者として扱う
  async #resolveUserId(input: UpvoteHistoryInput): Promise<string | null> {
    if (!isHandleFormat(input.userHandle)) {
      return null;
    }
    const resolution = await this.users.resolveHandle(input.userHandle);
    if (resolution.kind === 'none') {
      return null;
    }
    const { userId, suspended } = resolution.user;
    if (suspended && input.viewer?.user.id !== userId) {
      return null;
    }
    return userId;
  }

  // ストアの読み取りの後に表示できなくなったプロダクトや見つからないマッチの項目は除く
  async #assemble(
    userId: string,
    page: readonly UpvoteHistoryRecord[],
    now: Date,
  ): Promise<{
    readonly entries: readonly UpvoteHistoryEntry[];
    readonly dateTotals: readonly UpvoteHistoryDateTotal[];
  }> {
    if (page.length === 0) {
      return { entries: [], dateTotals: [] };
    }
    const dates = [...new Set(page.map((row) => row.matchDate))];
    const [records, summaries, totals] = await Promise.all([
      this.matches.findMatches(
        page.map((row) => row.matchId),
        now,
      ),
      this.products.findSummaries(
        page.map((row) => row.productId),
        'visible',
      ),
      this.store.countByDates(userId, dates),
    ]);
    const entries = page.flatMap((row) =>
      entryOf(row, records.get(row.matchId), summaries.get(row.productId)),
    );
    const shownDates = new Set(entries.map((entry) => entry.matchDate));
    return {
      entries,
      dateTotals: dates
        .filter((date) => shownDates.has(date))
        .map((date) => ({ date, count: totals.get(date) ?? 0 })),
    };
  }
}
