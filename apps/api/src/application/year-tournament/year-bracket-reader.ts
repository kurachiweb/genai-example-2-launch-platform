import { inject, injectable } from 'inversify';

import {
  chunk,
  IDS_PER_STATEMENT,
} from '../../../lib/core/d1/statement-chunks.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type {
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearTournamentRecord,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
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

export interface YearBracketView {
  readonly tournament: YearTournamentRecord;
  readonly rounds: BracketRoundsView;
  // 優勝の参加者のプロダクト。優勝が無い・表示できなければnull
  readonly champion: MatchProductView | null;
}

export interface YearBracketReader {
  // 4桁の年でない・行の無い年・組み合わせを決定していない年はundefined
  read(input: {
    readonly year: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<YearBracketView | undefined>;
}

const YEAR_KEY_PATTERN = /^\d{4}$/;

@injectable()
export class DirectoryYearBracketReader implements YearBracketReader {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    private readonly store: YearTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(MATCH_TYPES.MatchViewReader)
    private readonly views: MatchViewReader,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async read(input: {
    readonly year: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<YearBracketView | undefined> {
    if (!YEAR_KEY_PATTERN.test(input.year)) {
      return undefined;
    }
    const year = Number(input.year);
    const tournament = (await this.store.findByYears([year])).get(year);
    // 組み合わせの決定はブラケットのIDを年の行へ記録して確定する
    if (tournament === undefined || tournament.bracketId === null) {
      return undefined;
    }
    const record = await this.brackets.findById(tournament.bracketId);
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
