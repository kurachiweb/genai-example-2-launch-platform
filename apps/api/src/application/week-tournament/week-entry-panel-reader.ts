import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../../common-lib/product/product-input-rules.ts';
import { roundLabel } from '../../../common-lib/tournament/round-name.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
} from '../../../lib/core/payments/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import {
  type BracketShape,
  roundStage,
} from '../../../lib/core/tournament/bracket-shape.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type { UltrasEntitlements } from '../../../lib/core/ultras/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { ultrasExemptionPeriodOf } from '../../../lib/core/week-tournament/week-entry-rules.ts';
import { WEEK_ENTRY_PRICE_LOOKUP_KEY } from '../../../lib/core/week-tournament/week-schedule.ts';
import type { CheckoutMoney } from '../payments/checkout-view.ts';

export interface WeekEntryProgress {
  // 進行中のブラケットで敗退しておらず優勝でもない
  readonly alive: boolean;
  readonly eliminatedRound: number | null;
  readonly eliminatedRoundName: string | null;
  // 週の行に受賞が記録された優勝
  readonly champion: boolean;
}

// 受付中で受付期限の前でも決済を始められない理由。文言は購入の可否の口の拒否の文言と同じコードで引く
export type WeekEntryCheckoutBlock = 'week_entry_product_unavailable';

export interface WeekEntryPanel {
  readonly entry: WeekEntryRecord;
  readonly tournament: WeekTournamentRecord;
  readonly exempt: boolean;
  // 決済を始められる枠だけに読む。決済を始められない枠と、取得できない縮退ではnull
  readonly fee: CheckoutMoney | null;
  // 決済を始められる枠で、投稿者がUltrasの特典を受けていない。機能フラグは画面が見る
  readonly ultrasGuide: boolean;
  // 決済を始められる枠のうち、プロダクトを表示できない間だけ値がある。参加費とUltrasの案内はそのまま返す
  readonly checkoutBlock: WeekEntryCheckoutBlock | null;
  // 組み合わせに入った枠だけ
  readonly progress: WeekEntryProgress | null;
}

export interface WeekEntryPanelReader {
  // 形式違反・本人でない・現在のハンドルでない・直近のローンチに枠が無いはnull
  readForOwner(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<WeekEntryPanel | null>;
}

const logger = getAppLogger(['api', 'application', 'week-tournament']);

const ALIVE: WeekEntryProgress = Object.freeze({
  alive: true,
  eliminatedRound: null,
  eliminatedRoundName: null,
  champion: false,
});

const CHAMPION: WeekEntryProgress = Object.freeze({
  ...ALIVE,
  alive: false,
  champion: true,
});

const SETTLED: WeekEntryProgress = Object.freeze({ ...ALIVE, alive: false });

const isPaymentsUnavailable = (error: unknown): boolean =>
  error instanceof AppError && error.code === 'payments_unavailable';

function eliminatedIn(shape: BracketShape, round: number): WeekEntryProgress {
  const inRange =
    Number.isInteger(round) && round >= 1 && round <= shape.roundCount;
  return {
    alive: false,
    eliminatedRound: round,
    eliminatedRoundName: inRange
      ? roundLabel({ round, stage: roundStage(shape, round) })
      : null,
    champion: false,
  };
}

function isChampion(
  entry: WeekEntryRecord,
  tournament: WeekTournamentRecord,
): boolean {
  return (
    tournament.outcome === 'awarded' &&
    tournament.championEntryId === entry.entryId
  );
}

@injectable()
export class DirectoryWeekEntryPanelReader implements WeekEntryPanelReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(ULTRAS_TYPES.UltrasEntitlements)
    private readonly entitlements: UltrasEntitlements,
    @inject(PAYMENTS_TYPES.PriceCatalog)
    private readonly prices: PriceCatalog,
  ) {}

  async readForOwner(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<WeekEntryPanel | null> {
    const found = await this.latestEntryOf(viewer, productHandle, now);
    if (found === undefined) {
      return null;
    }
    const { launchId, entry, productVisible } = found;
    const tournament = await this.store.findTournament(entry.tournamentId);
    if (tournament === undefined) {
      throw new Error(
        `参加の枠の週のトーナメントがありません: ${entry.tournamentId}`,
      );
    }
    const exempt = await this.isExempt(viewer, entry, tournament, now);
    // 受付期限は決済期限より前のため、受付期限の前に免除でなければ現在も特典を受けていない
    const payable =
      entry.status === 'awaiting_payment' &&
      !exempt &&
      now.getTime() < tournament.window.acceptUntil.getTime();
    const [fee, progress] = await Promise.all([
      payable ? this.entryFee() : Promise.resolve(null),
      this.progressOf({ launchId, entry, tournament, now }),
    ]);
    return {
      entry,
      tournament,
      exempt,
      fee,
      ultrasGuide: payable,
      checkoutBlock:
        payable && !productVisible ? 'week_entry_product_unavailable' : null,
      progress,
    };
  }

  private async latestEntryOf(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<
    | {
        readonly launchId: string;
        readonly entry: WeekEntryRecord;
        readonly productVisible: boolean;
      }
    | undefined
  > {
    if (checkHandleFormat(productHandle, PRODUCT_HANDLE_RULE) !== 'ok') {
      return undefined;
    }
    const resolution = await this.products.resolveHandle(productHandle);
    if (
      resolution.kind !== 'current' ||
      resolution.product.ownerUserId !== viewer.user.id
    ) {
      return undefined;
    }
    const { productId, visible } = resolution.product;
    const launches =
      (await this.products.listLaunches([productId], now)).get(productId) ?? [];
    const latest = launches.find(({ status }) => status !== 'canceled');
    if (latest === undefined) {
      return undefined;
    }
    const { launchId } = latest;
    const entry = (await this.store.findEntriesByLaunch([launchId])).get(
      launchId,
    );
    return entry === undefined
      ? undefined
      : { launchId, entry, productVisible: visible };
  }

  private async isExempt(
    viewer: CurrentUser,
    entry: WeekEntryRecord,
    tournament: WeekTournamentRecord,
    now: Date,
  ): Promise<boolean> {
    if (entry.entitlementSource === 'ultras') {
      return true;
    }
    if (entry.status !== 'awaiting_payment') {
      return false;
    }
    const period = ultrasExemptionPeriodOf(
      entry.wonAt,
      tournament.window.deadlineAt,
      now,
    );
    return (
      period !== null &&
      this.entitlements.wasEntitledDuring(
        viewer.user.id,
        period.from,
        period.to,
      )
    );
  }

  // 参加費を表示できなくても状態と期限は出すため、Stripeに到達できず保持した値も無い失敗だけは参加費を空にして返す
  private async entryFee(): Promise<CheckoutMoney | null> {
    let result: PriceCatalogResult;
    try {
      result = await this.prices.getPrices([WEEK_ENTRY_PRICE_LOOKUP_KEY]);
    } catch (error: unknown) {
      if (isPaymentsUnavailable(error)) {
        return null;
      }
      throw error;
    }
    const price = result.prices.find(
      ({ lookupKey }) => lookupKey === WEEK_ENTRY_PRICE_LOOKUP_KEY,
    );
    if (price === undefined) {
      logger.warn(
        'Weekトーナメントの参加費の価格が照会の結果に無いため、参加費を表示できないものとして返しました',
        { priceLookup: WEEK_ENTRY_PRICE_LOOKUP_KEY, stale: result.stale },
      );
      return null;
    }
    return { amount: price.unitAmount, currency: price.currency };
  }

  // ローンチの要約の供給元と同じ規則で、ブラケットへの記録の前に確定した直近のWeekのマッチの負けも敗退とみなす
  private async progressOf({
    launchId,
    entry,
    tournament,
    now,
  }: {
    readonly launchId: string;
    readonly entry: WeekEntryRecord;
    readonly tournament: WeekTournamentRecord;
    readonly now: Date;
  }): Promise<WeekEntryProgress | null> {
    if (entry.status !== 'drawn') {
      return null;
    }
    if (isChampion(entry, tournament)) {
      return CHAMPION;
    }
    const standing = (
      await this.brackets.findParticipantStandings('week', [entry.entryId])
    ).get(entry.entryId);
    // 凍結の後、組み合わせを書き終えるまではブラケットの参加者が無い
    if (standing === undefined) {
      return tournament.status === 'drawing' ? ALIVE : SETTLED;
    }
    if (standing.eliminatedRound !== null) {
      return eliminatedIn(standing.shape, standing.eliminatedRound);
    }
    if (standing.status !== 'active' || standing.champion) {
      return SETTLED;
    }
    const latest = (
      (await this.matches.listByLaunches([launchId], now)).get(launchId) ?? []
    ).find(({ kind }) => kind === 'week');
    if (latest?.phase !== 'finished' || latest.round === null) {
      return ALIVE;
    }
    const side = latest.entries.find((match) => match.launchId === launchId);
    return side?.result === 'lost'
      ? eliminatedIn(standing.shape, latest.round)
      : ALIVE;
  }
}
