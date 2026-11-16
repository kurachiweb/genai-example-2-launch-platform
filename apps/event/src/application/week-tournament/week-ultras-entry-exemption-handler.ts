import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  UltrasActivation,
  UltrasActivationHandler,
} from '../../../lib/core/ultras/activation-contract.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';

// 知らせは決済期限の後に届くこともあるため、期限との比較には処理の時刻ではなく加入が有効になった時刻を渡す。
// 付与は凍結前の週の受付中の枠だけを書き換えるため、再試行・送り直しで同じ知らせを何度処理してもよい。失敗は捕まえずに投げ、知らせ全体の再試行に任せる
@injectable()
export class WeekUltrasEntryExemptionHandler implements UltrasActivationHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(activation: UltrasActivation): Promise<void> {
    await this.store.grantByUltras(
      activation.userId,
      activation.activatedAt,
      this.clock.now(),
    );
  }
}
