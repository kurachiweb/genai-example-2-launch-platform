import { inject, injectable } from 'inversify';

import {
  chunk,
  IDS_PER_STATEMENT,
} from '../../../lib/core/d1/statement-chunks.ts';
import { parseIsoWeek } from '../../../common-lib/tournament/week-period.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type {
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { MATCH_TYPES } from '../match/match-types.ts';
import {
  type MatchProductView,
  type MatchView,
  type MatchViewReader,
  productViewOf,
} from '../match/match-view-reader.ts';
import {
  type BracketRoundsView,
  buildBracketRoundsView,
} from '../tournament/bracket-view-builder.ts';

export interface WeekBracketView {
  readonly tournament: WeekTournamentRecord;
  readonly rounds: BracketRoundsView;
  // 優勝の参加者のプロダクト。優勝が無い・表示できなければnull
  readonly champion: MatchProductView | null;
}

export interface WeekBracketReader {
  // 不正な週・組み合わせを決定していない週はundefined
  read(input: {
    readonly week: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<WeekBracketView | undefined>;
}

@injectable()
export class DirectoryWeekBracketReader implements WeekBracketReader {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(MATCH_TYPES.MatchViewReader)
    private readonly views: MatchViewReader,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async read(input: {
    readonly week: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<WeekBracketView | undefined> {
    const parsed = parseIsoWeek(input.week);
    if (parsed === undefined) {
      return undefined;
    }
    const tournament = await this.store.findTournamentByWeek(
      parseBusinessDate(parsed.weekStart),
    );
    // 組み合わせの決定はブラケットのIDを週の行へ記録して確定する
    if (tournament === undefined || tournament.bracketId === null) {
      return undefined;
    }
    const record = await this.brackets.findByTournament(
      'week',
      tournament.tournamentId,
    );
    if (record === undefined) {
      return undefined;
    }
    const rounds = buildBracketRoundsView({
      record,
      matchViews: await this.matchViewsOf(record, input),
      now: input.now,
    });
    return {
      tournament,
      rounds,
      champion: await this.championOf(record, rounds.championNo),
    };
  }

  private async matchViewsOf(
    record: BracketRecord,
    input: { readonly viewer: CurrentUser | undefined; readonly now: Date },
  ): Promise<ReadonlyMap<string, MatchView>> {
    const pages = await Promise.all(
      chunk(
        record.matches.map(({ matchId }) => matchId),
        IDS_PER_STATEMENT,
      ).map((matchIds) =>
        this.views.findViews({
          matchIds,
          viewer: input.viewer,
          now: input.now,
        }),
      ),
    );
    return new Map(pages.flatMap((page) => [...page]));
  }

  private async championOf(
    record: BracketRecord,
    championNo: number | null,
  ): Promise<MatchProductView | null> {
    const productId =
      championNo === null
        ? null
        : (record.participants.find(
            ({ participantNo }) => participantNo === championNo,
          )?.productId ?? null);
    if (productId === null) {
      return null;
    }
    const summary = (
      await this.products.findSummaries([productId], 'visible')
    ).get(productId);
    return summary?.visible === true ? productViewOf(summary) : null;
  }
}
