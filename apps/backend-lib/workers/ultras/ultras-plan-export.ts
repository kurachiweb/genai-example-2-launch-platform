import { inject, injectable } from 'inversify';

import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type {
  SubscriptionStore,
  UltrasPlanExport,
  UltrasPlanExportItem,
} from '../../core/ultras/ports.ts';
import { planViewOf } from './ultras-entitlements.ts';

@injectable()
export class StoredUltrasPlanExport implements UltrasPlanExport {
  constructor(
    @inject(ULTRAS_TYPES.SubscriptionStore)
    private readonly subscriptions: SubscriptionStore,
  ) {}

  // 特典の終了時刻はplanの項目ではないため含めない
  async find(userId: string, now: Date): Promise<UltrasPlanExportItem | null> {
    const latest = await this.subscriptions.findLatestActivated(userId);
    const view = latest === undefined ? null : planViewOf(latest, now);
    if (view === null) {
      return null;
    }
    return {
      name: 'ultras',
      status: view.status,
      startedAt: view.startedAt,
      currentPeriodEndsAt: view.currentPeriodEndsAt,
      canceledAt: view.canceledAt,
    };
  }
}
