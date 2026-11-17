import { inject, injectable } from 'inversify';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';
import type {
  DecisionSubject,
  RelaunchBlock,
  RelaunchConditionSource,
} from '../product/decision-sources.ts';
import {
  isContending,
  readWeekLaunchStandings,
  type WeekLaunchStanding,
  wonLaunchesOf,
} from './week-launch-standings.ts';

// 解除の日付は呼び出し元が解除の日時から表示する
export const WEEK_RELAUNCH_BLOCK_MESSAGES = Object.freeze({
  entryPending:
    'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。',
  resultPending:
    'このプロダクトはWeekトーナメント参加中のため再ローンチできません。',
} as const);

// 期限切れ・喪失・除外・敗退・優勝は禁止を返さず、敗北後の禁止期間も掛けない(仮1)。優勝の後の禁止はYearトーナメントの条件に任せる
function blockOf(
  standing: WeekLaunchStanding,
  at: Date,
): RelaunchBlock | undefined {
  const { launch, entry, deadlineAt } = standing;
  if (entry === undefined || entry.status === 'awaiting_payment') {
    return at.getTime() < deadlineAt.getTime()
      ? {
          productId: launch.productId,
          code: 'tournament-week.entry-pending',
          message: WEEK_RELAUNCH_BLOCK_MESSAGES.entryPending,
          releaseAt: deadlineAt,
        }
      : undefined;
  }
  return entry.status === 'entitled' || isContending(standing)
    ? {
        productId: launch.productId,
        code: 'tournament-week.result-pending',
        message: WEEK_RELAUNCH_BLOCK_MESSAGES.resultPending,
        releaseAt: null,
      }
    : undefined;
}

@injectable()
export class WeekRelaunchConditionSource implements RelaunchConditionSource {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
  ) {}

  async findBlocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly RelaunchBlock[]> {
    const standings = await readWeekLaunchStandings(
      this.store,
      this.brackets,
      wonLaunchesOf(input.subjects),
    );
    return standings.flatMap((standing) => {
      const block = blockOf(standing, input.at);
      return block === undefined ? [] : [block];
    });
  }
}
