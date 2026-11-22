import { inject, injectable } from 'inversify';

import type {
  ExportProduct,
  ExportSnapshot,
} from '../../../lib/core/data-export/export-snapshot.ts';
import { EVENT_DATA_EXPORT_TYPES } from './event-data-export-types.ts';
import type { ExportFileResolver } from './export-file-resolver.ts';
import type { AccountSourceReader } from './sources/account-source-reader.ts';
import type { CorrespondenceSourceReader } from './sources/correspondence-source-reader.ts';
import type { ProductActivitySourceReader } from './sources/product-activity-source-reader.ts';

function productFileIds(product: ExportProduct): readonly string[] {
  return [product.logoFileId, ...product.screenshotFileIds];
}

// 3つの読み取りの部品の結果とファイルの照会を、ZIPの生成が使う1つのスナップショットにまとめる
@injectable()
export class ExportSnapshotCollector {
  constructor(
    @inject(EVENT_DATA_EXPORT_TYPES.AccountSourceReader)
    private readonly accounts: AccountSourceReader,
    @inject(EVENT_DATA_EXPORT_TYPES.ProductActivitySourceReader)
    private readonly activity: ProductActivitySourceReader,
    @inject(EVENT_DATA_EXPORT_TYPES.CorrespondenceSourceReader)
    private readonly correspondence: CorrespondenceSourceReader,
    @inject(EVENT_DATA_EXPORT_TYPES.ExportFileResolver)
    private readonly fileResolver: ExportFileResolver,
  ) {}

  // 退会済みの利用者は他の部品を呼ばずにundefinedを返す
  async collect(
    userId: string,
    requestedAt: Date,
    now: Date,
  ): Promise<ExportSnapshot | undefined> {
    const accountSource = await this.accounts.read(userId, now);
    if (accountSource === undefined) {
      return undefined;
    }
    const activity = await this.activity.read(userId, now);
    const correspondence = await this.correspondence.read(
      userId,
      accountSource.pseudonymousId,
      now,
    );
    const { avatarFileId } = accountSource.profile;
    const fileIds = [
      ...(avatarFileId === null ? [] : [avatarFileId]),
      ...activity.products.flatMap(productFileIds),
      ...correspondence.inquiries.flatMap((inquiry) =>
        inquiry.messages.flatMap((message) =>
          message.attachments.map((attachment) => attachment.fileId),
        ),
      ),
    ];
    const files = await this.fileResolver.resolve([...new Set(fileIds)]);

    return {
      requestedAt,
      account: accountSource.account,
      profile: accountSource.profile,
      follows: accountSource.follows,
      products: activity.products,
      launches: activity.launches,
      comments: activity.comments,
      upvotes: activity.upvotes,
      ratings: activity.ratings,
      reports: correspondence.reports,
      inquiries: correspondence.inquiries,
      sponsorships: correspondence.sponsorships,
      payments: correspondence.payments,
      files,
    };
  }
}
