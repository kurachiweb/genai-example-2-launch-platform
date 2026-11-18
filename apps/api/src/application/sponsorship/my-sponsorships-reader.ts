import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../../common-lib/product/product-input-rules.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type { SponsorshipStore } from '../../../lib/core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import {
  nextDayStartsAtOf,
  type SponsorshipView,
  sponsorshipViewOf,
  uniqueProductIdsOf,
} from './sponsorship-view.ts';

export interface MySponsorshipsPage {
  readonly views: readonly SponsorshipView[];
  readonly hasNextPage: boolean;
  // ページの最後の申込の位置。空のページはnull
  readonly endCursor: string | null;
  // 次の基準時刻の0:00。画面はこの時点で取り直す
  readonly nextDayStartsAt: Date;
}

export interface MySponsorshipsReader {
  // 停止中も閲覧できる。firstは呼び出し側が1〜20で渡す
  list(input: {
    readonly session: SessionView;
    readonly first: number;
    readonly after?: string;
    readonly now: Date;
  }): Promise<MySponsorshipsPage>;
  // 本人のプロダクトでなければ0
  countActiveForProduct(input: {
    readonly session: SessionView;
    readonly productHandle: string;
    readonly now: Date;
  }): Promise<number>;
}

const NO_SUMMARIES: ReadonlyMap<string, ProductSummaryRecord> = new Map();

@injectable()
export class DefaultMySponsorshipsReader implements MySponsorshipsReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async list({
    session,
    first,
    after,
    now,
  }: Parameters<MySponsorshipsReader['list']>[0]): Promise<MySponsorshipsPage> {
    const { user } = await this.guard.requireUser(session);
    const page = await this.store.listByOwner(
      user.id,
      after === undefined ? { first } : { first, after },
    );
    const productIds = uniqueProductIdsOf(page.records);
    // 広告の数に比例した問い合わせをしないため、ページのプロダクトを1回の照会で読む
    const summaries =
      productIds.length === 0
        ? NO_SUMMARIES
        : await this.products.findSummaries(productIds, 'not-deleted');
    const today = toBusinessDateTime(now).date;
    return {
      views: page.records.map((record) =>
        sponsorshipViewOf(record, summaries, today),
      ),
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
      nextDayStartsAt: nextDayStartsAtOf(today),
    };
  }

  async countActiveForProduct({
    session,
    productHandle,
    now,
  }: Parameters<
    MySponsorshipsReader['countActiveForProduct']
  >[0]): Promise<number> {
    const { user } = await this.guard.requireUser(session);
    if (checkHandleFormat(productHandle, PRODUCT_HANDLE_RULE) !== 'ok') {
      return 0;
    }
    const resolution = await this.products.resolveHandle(productHandle);
    // 削除の確認を開いた後にハンドルを変えても件数を示すため、旧ハンドルの解決も本人のプロダクトとして数える
    if (
      resolution.kind === 'none' ||
      resolution.product.ownerUserId !== user.id
    ) {
      return 0;
    }
    return this.store.countActiveForProduct(
      resolution.product.productId,
      toBusinessDateTime(now).date,
    );
  }
}
