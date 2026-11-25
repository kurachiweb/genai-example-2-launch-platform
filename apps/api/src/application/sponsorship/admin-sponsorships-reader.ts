import { inject, injectable } from 'inversify';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import { isTerminable } from '../../../common-lib/sponsorship/sponsorship-status.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type {
  AdminSponsorshipFilter,
  SponsorshipStore,
} from '../../../lib/core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import {
  type SponsorshipView,
  sponsorshipViewOf,
  uniqueProductIdsOf,
} from './sponsorship-view.ts';

// 管理者の認可の入口とロールの不足の拒否のログはpresentation層にあるため、リゾルバがその入口を包んだ関数を渡し、ユースケースは最低限のロールだけを宣言する
export type AdminRoleRequirement = (
  minimum: AdminRole,
) => Promise<CurrentAdmin>;

export interface AdminSponsorshipView extends SponsorshipView {
  // 照会で返らない(物理削除済みの)申込者はnull
  readonly applicantNickname: string | null;
  readonly terminable: boolean;
}

export interface AdminSponsorshipsPage {
  readonly views: readonly AdminSponsorshipView[];
  readonly hasNextPage: boolean;
  // ページの最後の申込の位置。空のページはnull
  readonly endCursor: string | null;
}

export interface AdminSponsorshipsReader {
  // firstは呼び出し側が1〜50で渡す
  list(input: {
    readonly requireRole: AdminRoleRequirement;
    readonly filter: AdminSponsorshipFilter;
    readonly first: number;
    readonly after?: string;
    readonly now: Date;
  }): Promise<AdminSponsorshipsPage>;
}

@injectable()
export class DefaultAdminSponsorshipsReader implements AdminSponsorshipsReader {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
  ) {}

  async list({
    requireRole,
    filter,
    first,
    after,
    now,
  }: Parameters<
    AdminSponsorshipsReader['list']
  >[0]): Promise<AdminSponsorshipsPage> {
    await requireRole('viewer');
    const today = toBusinessDateTime(now).date;
    const page = await this.store.listForAdmin(
      filter,
      today,
      after === undefined ? { first } : { first, after },
    );
    if (page.records.length === 0) {
      return {
        views: [],
        hasNextPage: page.hasNextPage,
        endCursor: page.endCursor,
      };
    }
    const userIds = [...new Set(page.records.map(({ userId }) => userId))];
    // 広告の数に比例した問い合わせをしないため、ページのプロダクトと申込者をそれぞれ1回の照会で読む。申込者は停止中でも一覧に出す
    const [summaries, applicants] = await Promise.all([
      this.products.findSummaries(
        uniqueProductIdsOf(page.records),
        'not-deleted',
      ),
      this.profiles.findSummaries(userIds, 'not-withdrawn'),
    ]);
    return {
      views: page.records.map((record) => ({
        ...sponsorshipViewOf(record, summaries, today),
        applicantNickname: applicants.get(record.userId)?.nickname ?? null,
        // 強制終了の確定と同じ判定にするため、プロダクトの論理削除は照会の結果でなく申込の列で判定する
        terminable: isTerminable({
          state: record.state,
          endsOn: record.endsOn,
          product: record.productDeletedAt === null ? 'visible' : 'deleted',
          today,
        }),
      })),
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
    };
  }
}
