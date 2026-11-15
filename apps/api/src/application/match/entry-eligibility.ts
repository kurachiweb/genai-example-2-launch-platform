import { inject, injectable } from 'inversify';

import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  LaunchRecord,
  ProductDirectory,
} from '../../../lib/core/product/ports.ts';
import type {
  DueKickoff,
  EntryEligibilityChecker,
  KickoffEntry,
} from './ports.ts';

interface CheckedEntry {
  readonly entry: KickoffEntry & { readonly productId: string };
  readonly qualifier: boolean;
}

@injectable()
export class DirectoryEntryEligibilityChecker implements EntryEligibilityChecker {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  // 記録された該当は、停止の解除やプロダクトの復元の後も元に戻さないため、今の状態を読まずに該当とする
  async forfeitedEntries(
    items: readonly Pick<DueKickoff, 'kind' | 'entries'>[],
    now: Date,
  ): Promise<ReadonlySet<string>> {
    const forfeited = new Set<string>();
    const checked: CheckedEntry[] = [];
    for (const item of items) {
      for (const entry of item.entries) {
        if (entry.forfeited || entry.productId === null) {
          forfeited.add(entry.entryId);
        } else {
          checked.push({
            entry: { ...entry, productId: entry.productId },
            qualifier: item.kind === 'qualifier',
          });
        }
      }
    }
    for (const entryId of await this.currentlyForfeited(checked, now)) {
      forfeited.add(entryId);
    }
    return forfeited;
  }

  private async currentlyForfeited(
    checked: readonly CheckedEntry[],
    now: Date,
  ): Promise<readonly string[]> {
    if (checked.length === 0) {
      return [];
    }
    const qualifierProductIds = checked
      .filter(({ qualifier }) => qualifier)
      .map(({ entry }) => entry.productId);
    const [summaries, launches] = await Promise.all([
      this.products.findSummaries(
        checked.map(({ entry }) => entry.productId),
        'not-deleted',
      ),
      qualifierProductIds.length === 0
        ? Promise.resolve(new Map<string, readonly LaunchRecord[]>())
        : this.products.listLaunches(qualifierProductIds, now),
    ]);
    return checked.flatMap(({ entry, qualifier }) => {
      if (summaries.get(entry.productId)?.visible !== true) {
        return [entry.entryId];
      }
      if (!qualifier) {
        return [];
      }
      const launch = launches
        .get(entry.productId)
        ?.find(({ launchId }) => launchId === entry.launchId);
      return launch === undefined || launch.status === 'canceled'
        ? [entry.entryId]
        : [];
    });
  }
}
