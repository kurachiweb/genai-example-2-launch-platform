import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  UltrasActivation,
  UltrasActivationHandler,
} from '../../../lib/core/ultras/activation-contract.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { GRANTABLE_STATUSES } from '../../../lib/core/year-tournament/year-entry-rules.ts';

function isGrantable({ status }: YearEntryRecord): boolean {
  return GRANTABLE_STATUSES.some((grantable) => grantable === status);
}

// 枠は対象年を持たないため、Week優勝の日から枠ごとに対象年を求め、その年の決済期限と比べる。凍結済みの年が対象年の枠は暦が遅れを返すため与えない。
// 知らせは決済期限の後に届くこともあるため、期限との比較には処理の時刻ではなく加入が有効になった時刻を使う。
// 付与は凍結前の年の受付中の枠だけを書き換えるため、再試行・送り直しで同じ知らせを何度処理してもよい。失敗は捕まえずに投げ、知らせ全体の再試行に任せる
@injectable()
export class YearUltrasEntryExemptionHandler implements UltrasActivationHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly store: YearEntryStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(activation: UltrasActivation): Promise<void> {
    const now = this.clock.now();
    const entries = (
      await this.store.listOpenByOwner(activation.userId)
    ).filter(isGrantable);
    const entryIds: string[] = [];
    for (const entry of entries) {
      if (await this.coversActivation(entry, activation.activatedAt, now)) {
        entryIds.push(entry.entryId);
      }
    }
    if (entryIds.length > 0) {
      await this.store.grantByUltras(entryIds, now);
    }
  }

  private async coversActivation(
    entry: YearEntryRecord,
    activatedAt: Date,
    now: Date,
  ): Promise<boolean> {
    const resolution = await this.calendar.resolveAward(entry.awardedDate, now);
    if (resolution.kind !== 'open') {
      return false;
    }
    return (
      entry.awardedAt.getTime() <= activatedAt.getTime() &&
      activatedAt.getTime() <= resolution.year.schedule.deadlineAt.getTime()
    );
  }
}
