import { inject, injectable } from 'inversify';

import { derivePlanStatus } from '../../core/ultras/entitlement-rules.ts';
import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
  UltrasEntitlements,
  UltrasPlanView,
} from '../../core/ultras/ports.ts';

// 始まりが終わりより後の期間は、区間の問い合わせでは両方にまたがる加入があるとtrueになり誤答が黙って返るため、先に例外にする
function assertPeriod(from: Date, to: Date): void {
  if (from.getTime() > to.getTime()) {
    throw new RangeError(
      `期間の始まりが終わりより後です(${from.toISOString()}〜${to.toISOString()})`,
    );
  }
}

export function planViewOf(
  row: SubscriptionRow,
  now: Date,
): UltrasPlanView | null {
  const status = derivePlanStatus(row, now);
  if (status === null || row.startedAt === null) {
    return null;
  }
  return {
    status,
    startedAt: row.startedAt,
    currentPeriodEndsAt: row.currentPeriodEnd,
    benefitEndsAt: row.benefitEndsAt,
    canceledAt: row.canceledAt,
  };
}

// 判定はストアの特典の継続期間(started_at・benefit_ends_at)への問い合わせだけで行い、Stripe側の状態と機能フラグを読まない
@injectable()
export class StoredUltrasEntitlements implements UltrasEntitlements {
  constructor(
    @inject(ULTRAS_TYPES.SubscriptionStore)
    private readonly subscriptions: SubscriptionStore,
  ) {}

  async isEntitledAt(userId: string, at: Date): Promise<boolean> {
    const entitled = await this.subscriptions.findEntitledOverlapping({
      userId,
      at,
    });
    return entitled !== undefined;
  }

  async wasEntitledDuring(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<boolean> {
    const entitled = await this.entitledUsersDuring([userId], from, to);
    return entitled.has(userId);
  }

  async entitledUsersAt(
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlySet<string>> {
    return this.entitledUsersDuring(userIds, at, at);
  }

  async entitledUsersDuring(
    userIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<ReadonlySet<string>> {
    assertPeriod(from, to);
    const overlapping = await this.subscriptions.findOverlapping({
      userIds,
      from,
      to,
    });
    return new Set(overlapping.map(({ userId }) => userId));
  }

  async currentPlan(userId: string, now: Date): Promise<UltrasPlanView | null> {
    const latest = await this.subscriptions.findLatestActivated(userId);
    return latest === undefined ? null : planViewOf(latest, now);
  }
}
