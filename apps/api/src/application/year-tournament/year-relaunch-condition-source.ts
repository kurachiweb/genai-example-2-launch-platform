import { inject, injectable } from 'inversify';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekChampionDirectory } from '../../../lib/core/week-tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  DecisionSubject,
  RelaunchBlock,
  RelaunchConditionSource,
} from '../product/decision-sources.ts';
import {
  isContending,
  readYearLaunchStandings,
  wonLaunchesOf,
  type YearLaunchStanding,
} from './year-launch-standings.ts';

// 解除の日付は呼び出し元が解除の日時から表示する
export const YEAR_RELAUNCH_BLOCK_MESSAGES = Object.freeze({
  entryPending:
    'このプロダクトはYearトーナメントに参加できる期間中のため再ローンチできません。',
  resultPending:
    'このプロダクトはYearトーナメント参加中のため再ローンチできません。',
} as const);

// 期限切れ・喪失・除外・敗退・優勝は禁止を返さず、敗北後の禁止期間も掛けない
function blockOf(
  standing: YearLaunchStanding,
  at: Date,
): RelaunchBlock | undefined {
  const { launch, phase } = standing;
  if (phase.kind === 'awaiting') {
    return phase.deadlineAt !== null &&
      at.getTime() < phase.deadlineAt.getTime()
      ? {
          productId: launch.productId,
          code: 'tournament-year.entry-pending',
          message: YEAR_RELAUNCH_BLOCK_MESSAGES.entryPending,
          releaseAt: phase.deadlineAt,
        }
      : undefined;
  }
  return phase.kind === 'entitled' || isContending(standing)
    ? {
        productId: launch.productId,
        code: 'tournament-year.result-pending',
        message: YEAR_RELAUNCH_BLOCK_MESSAGES.resultPending,
        releaseAt: null,
      }
    : undefined;
}

@injectable()
export class YearRelaunchConditionSource implements RelaunchConditionSource {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly entries: YearEntryStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
    @inject(WEEK_TOURNAMENT_TYPES.WeekChampionDirectory)
    private readonly champions: WeekChampionDirectory,
  ) {}

  async findBlocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly RelaunchBlock[]> {
    const standings = await readYearLaunchStandings(
      {
        entries: this.entries,
        brackets: this.brackets,
        calendar: this.calendar,
        champions: this.champions,
      },
      wonLaunchesOf(input.subjects),
      input.at,
    );
    return standings.flatMap((standing) => {
      const block = blockOf(standing, input.at);
      return block === undefined ? [] : [block];
    });
  }
}
