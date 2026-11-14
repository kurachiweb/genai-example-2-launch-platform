import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  SupporterCursor,
  SupporterDirectory,
  SupporterRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { resolveProductPage } from './product-page-resolution.ts';

// カーソルの文字列の値は文字列と数値だけを持てるため、Upvoteの日時をエポックミリ秒で持つ
export interface SupporterListPosition {
  readonly upvotedAt: number;
  readonly upvoteId: string;
}

export interface SupporterListInput {
  readonly productHandle: string;
  readonly matchId: string;
  readonly entryId: string;
  readonly viewer: CurrentUser | undefined;
  // 1〜20で、範囲外はRangeErrorのため呼び出し元の境界で検証する
  readonly first: number;
  readonly after: SupporterListPosition | undefined;
  readonly now: Date;
}

export interface SupporterListPage {
  // Upvoteの日時の早い順で、退会・停止の利用者を除く
  readonly userIds: readonly string[];
  readonly endCursor: SupporterListPosition | null;
  readonly hasNextPage: boolean;
}

export interface SupporterListReader {
  // プロダクトを表示できない、側がそのプロダクトのものでない、マッチの結果が確定していなければnull
  list(input: SupporterListInput): Promise<SupporterListPage | null>;
}

const cursorOf = (position: SupporterListPosition): SupporterCursor => ({
  upvotedAt: new Date(position.upvotedAt),
  upvoteId: position.upvoteId,
});

const positionOf = (supporter: SupporterRecord): SupporterListPosition => ({
  upvotedAt: supporter.upvotedAt.getTime(),
  upvoteId: supporter.upvoteId,
});

@injectable()
export class DirectorySupporterListReader implements SupporterListReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(MATCH_PLATFORM_TYPES.SupporterDirectory)
    private readonly supporters: SupporterDirectory,
  ) {}

  async list(input: SupporterListInput): Promise<SupporterListPage | null> {
    if (!(await this.#isListable(input))) {
      return null;
    }
    const { entryId, first } = input;
    const rows = await this.supporters.listSupporters({
      entryId,
      after: input.after === undefined ? undefined : cursorOf(input.after),
      limit: first,
    });
    const last = rows.at(-1);
    return {
      userIds: rows.map(({ userId }) => userId),
      endCursor: last === undefined ? null : positionOf(last),
      hasNextPage:
        last !== undefined &&
        rows.length === first &&
        (await this.#hasMore(entryId, last)),
    };
  }

  async #isListable(input: SupporterListInput): Promise<boolean> {
    const resolution = await resolveProductPage(
      this.products,
      input.productHandle,
      input.viewer,
    );
    if (resolution.kind !== 'render') {
      return false;
    }
    const match = (
      await this.matches.findMatches([input.matchId], input.now)
    ).get(input.matchId);
    const entry = match?.entries.find(
      ({ entryId }) => entryId === input.entryId,
    );
    return (
      match?.phase === 'finished' &&
      entry?.productId === resolution.product.productId
    );
  }

  // サポーターの照会は1回に20件までしか読めず1件多く読めないため、続きの有無を1件だけ読んで確かめる
  async #hasMore(entryId: string, last: SupporterRecord): Promise<boolean> {
    const next = await this.supporters.listSupporters({
      entryId,
      after: cursorOf(positionOf(last)),
      limit: 1,
    });
    return next.length > 0;
  }
}
