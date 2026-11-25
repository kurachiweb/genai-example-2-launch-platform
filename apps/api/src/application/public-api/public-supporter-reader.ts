import { inject, injectable } from 'inversify';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { DIRECTORY_TYPES } from '../directory/directory-types.ts';
import { resolveProductPage } from '../directory/product-page-resolution.ts';
import type {
  SupporterListPosition,
  SupporterListReader,
  SupporterListRow,
} from '../directory/supporter-list-reader.ts';

export const PUBLIC_SUPPORTER_PAGE_SIZE = 20;

export interface PublicSupporterListInput {
  readonly productHandle: string;
  readonly matchId: string;
  readonly after: SupporterListPosition | undefined;
  readonly now: Date;
}

export interface PublicSupporterPage {
  readonly kind: 'page';
  // Upvoteの日時の早い順で、退会・停止の利用者を除く
  readonly supporters: readonly SupporterListRow[];
  readonly hasNextPage: boolean;
  readonly endCursor: SupporterListPosition | null;
}

export type PublicSupporterListResult =
  | PublicSupporterPage
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'product-not-found' }
  | { readonly kind: 'match-not-found' };

export interface PublicSupporterReader {
  list(input: PublicSupporterListInput): Promise<PublicSupporterListResult>;
}

const PRODUCT_NOT_FOUND: PublicSupporterListResult = Object.freeze({
  kind: 'product-not-found',
});

const MATCH_NOT_FOUND: PublicSupporterListResult = Object.freeze({
  kind: 'match-not-found',
});

// 公開APIはマッチの側を指定させないため、そのプロダクトの側を求めてから画面と同じサポーターの一覧に任せる。キーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で読む
@injectable()
export class DirectoryPublicSupporterReader implements PublicSupporterReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(DIRECTORY_TYPES.SupporterListReader)
    private readonly supporters: SupporterListReader,
  ) {}

  async list(
    input: PublicSupporterListInput,
  ): Promise<PublicSupporterListResult> {
    const resolution = await resolveProductPage(
      this.products,
      input.productHandle,
      undefined,
    );
    if (resolution.kind === 'redirect') {
      return { kind: 'redirect', handle: resolution.handle };
    }
    if (resolution.kind === 'not-found') {
      return PRODUCT_NOT_FOUND;
    }
    const { product } = resolution;
    const match = (
      await this.matches.findMatches([input.matchId], input.now)
    ).get(input.matchId);
    const entry =
      match?.phase === 'finished'
        ? match.entries.find(({ productId }) => productId === product.productId)
        : undefined;
    if (entry === undefined) {
      return MATCH_NOT_FOUND;
    }
    // 判定と読み取りの間の非公開化などでnullになり得る
    const page = await this.supporters.list({
      productHandle: product.handle,
      matchId: input.matchId,
      entryId: entry.entryId,
      viewer: undefined,
      first: PUBLIC_SUPPORTER_PAGE_SIZE,
      after: input.after,
      now: input.now,
    });
    if (page === null) {
      return MATCH_NOT_FOUND;
    }
    return {
      kind: 'page',
      supporters: page.supporters,
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
    };
  }
}
