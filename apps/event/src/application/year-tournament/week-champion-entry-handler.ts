import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  MatchEvent,
  MatchEventHandler,
} from '../../../lib/core/match/match-events.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type { YearEntryRegistrar } from '../../../lib/core/year-tournament/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 起点を処理の時刻ではなく確定の時刻から求め、再試行で遅れて処理しても読む範囲を変えない。この範囲で漏れた優勝は23:45のジョブの取り込みが補う
const CHAMPION_LOOKBACK_MILLISECONDS = 8 * 86_400_000;

// イベントはマッチの識別子だけを運び、どの確定が優勝を決めたかは分からないため、Weekの全ての確定で直近のWeek優勝をまとめて取り込む。
// 同じイベントのtournament-weekの優勝の記録(1510)の後に動く。枠はWeekトーナメントの一意索引で重複を無視するため何度処理してもよい。失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class WeekChampionEntryHandler implements MatchEventHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryRegistrar)
    private readonly registrar: YearEntryRegistrar,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: MatchEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'decided' || event.kind !== 'week') {
      return DONE;
    }
    await this.registrar.syncChampions({
      awardedFrom: new Date(
        event.occurredAt.getTime() - CHAMPION_LOOKBACK_MILLISECONDS,
      ),
      now: this.clock.now(),
    });
    return DONE;
  }
}
