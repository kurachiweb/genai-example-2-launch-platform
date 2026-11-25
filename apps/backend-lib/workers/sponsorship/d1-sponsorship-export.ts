import { and, asc, eq, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import {
  deriveSponsorshipStatus,
  type ProductAvailability,
  toExportStatus,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type {
  ProductExport,
  ProductExportRecord,
} from '../../core/product/ports.ts';
import type {
  SponsorshipExport,
  SponsorshipExportRecord,
} from '../../core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';

// 投稿者の停止による表示停止は区別しない。表示停止中は日付で掲載予定・掲載中へ振り分けるため、エクスポートの状態は変わらない
function availabilityOf(
  product: ProductExportRecord,
  productDeletedAt: Date | null,
): ProductAvailability {
  if (productDeletedAt !== null || product.deletedAt !== null) {
    return 'deleted';
  }
  return product.hiddenByAdmin ? 'hidden' : 'visible';
}

@injectable()
export class D1SponsorshipExport implements SponsorshipExport {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PRODUCT_PLATFORM_TYPES.ProductExport)
    private readonly products: ProductExport,
  ) {}

  async listByUser(
    userId: string,
    now: Date,
  ): Promise<readonly SponsorshipExportRecord[]> {
    const rows = await this.db
      .select({
        id: sponsorships.id,
        productId: sponsorships.productId,
        tier: sponsorships.tier,
        startsOn: sponsorships.startsOn,
        endsOn: sponsorships.endsOn,
        days: sponsorships.days,
        state: sponsorships.state,
        paymentRecordId: sponsorships.paymentRecordId,
        productDeletedAt: sponsorships.productDeletedAt,
        createdAt: sponsorships.createdAt,
      })
      .from(sponsorships)
      .where(
        and(eq(sponsorships.userId, userId), isNull(sponsorships.deletedAt)),
      )
      .orderBy(asc(sponsorships.createdAt), asc(sponsorships.id));
    if (rows.length === 0) {
      return [];
    }
    const productsById = new Map(
      (await this.products.listByUser(userId)).map((product) => [
        product.id,
        product,
      ]),
    );
    const today = toBusinessDateTime(now).date;
    return rows.map((row) => {
      const product = productsById.get(row.productId);
      // 申込の対象は申込者自身のプロダクトに限られ、プロダクトの物理削除は申込の行を先に消すため、見つからなければ整合性の破れ
      if (product === undefined) {
        throw new Error(
          `スポンサー広告${row.id}のプロダクト${row.productId}が申込者のプロダクトの一覧にありません`,
        );
      }
      const status = deriveSponsorshipStatus({
        state: row.state,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        product: availabilityOf(product, row.productDeletedAt),
        today,
      });
      return {
        id: row.id,
        product: { name: product.name, handle: product.handle },
        tier: row.tier,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        days: row.days,
        status: toExportStatus(status, row.startsOn, today),
        paymentId: row.paymentRecordId,
        createdAt: row.createdAt,
      };
    });
  }
}
