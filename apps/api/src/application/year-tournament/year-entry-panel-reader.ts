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
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type { YearRefundStatus } from '../../../lib/core/year-tournament/year-entry-rules.ts';
import { YEAR_ENTRY_PRICE_LOOKUP_KEY } from '../../../lib/core/year-tournament/year-schedule.ts';
import type { CheckoutMoney } from '../payments/checkout-view.ts';
import {
  resolveTargetIn,
  targetYearCandidates,
} from './year-launch-standings.ts';

export interface YearEntryProgress {
  // 進行中のブラケットで敗退しておらず優勝でもない
  readonly alive: boolean;
  readonly eliminatedRound: number | null;
  readonly eliminatedRoundName: string | null;
  // 年の行に受賞が記録された優勝
  readonly champion: boolean;
}

export interface YearEntryPanel {
  readonly launchId: string;
  readonly entry: YearEntryRecord;
  // 分類した年、分類の前ならWeek優勝の日から求めた対象年
  readonly year: YearCalendarEntry;
  readonly exempt: boolean;
  // 決済を始められる枠だけに読む。決済を始められない枠と、取得できない縮退ではnull
  readonly fee: CheckoutMoney | null;
  readonly refundable: boolean;
  // 組み合わせに入った枠だけ
  readonly progress: YearEntryProgress | null;
}

export interface YearEntryPanelReader {
  // 形式違反・本人でない・現在のハンドルでない・直近のローンチに枠が無いはnull
  readForOwner(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<YearEntryPanel | null>;
}

const logger = getAppLogger(['api', 'application', 'year-tournament']);

const ALIVE: YearEntryProgress = Object.freeze({
  alive: true,
  eliminatedRound: null,
  eliminatedRoundName: null,
  champion: false,
});

const CHAMPION: YearEntryProgress = Object.freeze({
  ...ALIVE,
  alive: false,
  champion: true,
});

const SETTLED: YearEntryProgress = Object.freeze({ ...ALIVE, alive: false });

const REFUNDABLE_STATUSES: ReadonlySet<YearRefundStatus> = new Set([
  'pending',
  'requested',
]);

const isPaymentsUnavailable = (error: unknown): boolean =>
  error instanceof AppError && error.code === 'payments_unavailable';

function eliminatedIn(shape: BracketShape, round: number): YearEntryProgress {
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

function isChampion(entry: YearEntryRecord, year: YearCalendarEntry): boolean {
  return (
    year.record?.outcome === 'awarded' &&
    year.record.championEntryId === entry.entryId
  );
}

function isRefundable(entry: YearEntryRecord): boolean {
  return (
    entry.purchaseId !== null && REFUNDABLE_STATUSES.has(entry.refundStatus)
  );
}

@injectable()
export class DirectoryYearEntryPanelReader implements YearEntryPanelReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly entries: YearEntryStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
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
  ): Promise<YearEntryPanel | null> {
    const found = await this.latestEntryOf(viewer, productHandle, now);
    if (found === undefined) {
      return null;
    }
    const { launchId, entry } = found;
    const year = await this.yearOf(entry, now);
    const exempt = await this.isExempt(viewer, entry, year, now);
    // 受付期限は決済期限より前のため、受付期限の前に免除でなければ現在も特典を受けていない
    const payable =
      entry.status === 'awaiting_payment' &&
      !exempt &&
      now.getTime() < year.schedule.acceptUntil.getTime();
    const [fee, progress] = await Promise.all([
      payable ? this.entryFee() : Promise.resolve(null),
      this.progressOf({ launchId, entry, year, now }),
    ]);
    return {
      launchId,
      entry,
      year,
      exempt,
      fee,
      refundable: isRefundable(entry),
      progress,
    };
  }

  private async latestEntryOf(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<
    { readonly launchId: string; readonly entry: YearEntryRecord } | undefined
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
    const { productId } = resolution.product;
    const launches =
      (await this.products.listLaunches([productId], now)).get(productId) ?? [];
    const latest = launches.find(({ status }) => status !== 'canceled');
    if (latest === undefined) {
      return undefined;
    }
    const { launchId } = latest;
    const entry = (await this.entries.findByLaunches([launchId])).get(launchId);
    return entry === undefined ? undefined : { launchId, entry };
  }

  // 分類した枠はその年を、分類の前の枠はWeek優勝の日から4年分の日程を1回で読んで対象年を求める
  private async yearOf(
    entry: YearEntryRecord,
    now: Date,
  ): Promise<YearCalendarEntry> {
    if (entry.classifiedYear !== null) {
      return this.describeOne(
        await this.calendar.describe([entry.classifiedYear], now),
        entry.classifiedYear,
      );
    }
    const calendar = await this.calendar.describe(
      targetYearCandidates(entry.awardedDate),
      now,
    );
    const target = resolveTargetIn(entry.awardedDate, calendar);
    return this.describeOne(
      calendar,
      target.kind === 'open' ? target.year.year : target.year,
    );
  }

  private describeOne(
    calendar: ReadonlyMap<number, YearCalendarEntry>,
    year: number,
  ): YearCalendarEntry {
    const described = calendar.get(year);
    if (described === undefined) {
      throw new Error(`年の日程を読めませんでした: ${String(year)}`);
    }
    return described;
  }

  private async isExempt(
    viewer: CurrentUser,
    entry: YearEntryRecord,
    year: YearCalendarEntry,
    now: Date,
  ): Promise<boolean> {
    if (entry.entitlementSource === 'ultras') {
      return true;
    }
    if (entry.status !== 'awaiting_payment') {
      return false;
    }
    const { deadlineAt } = year.schedule;
    const to = now.getTime() < deadlineAt.getTime() ? now : deadlineAt;
    if (entry.awardedAt.getTime() > to.getTime()) {
      return false;
    }
    return this.entitlements.wasEntitledDuring(
      viewer.user.id,
      entry.awardedAt,
      to,
    );
  }

  // 参加費を表示できなくても状態と期限は出すため、Stripeに到達できず保持した値も無い失敗だけは参加費を空にして返す
  private async entryFee(): Promise<CheckoutMoney | null> {
    let result: PriceCatalogResult;
    try {
      result = await this.prices.getPrices([YEAR_ENTRY_PRICE_LOOKUP_KEY]);
    } catch (error: unknown) {
      if (isPaymentsUnavailable(error)) {
        return null;
      }
      throw error;
    }
    const price = result.prices.find(
      ({ lookupKey }) => lookupKey === YEAR_ENTRY_PRICE_LOOKUP_KEY,
    );
    if (price === undefined) {
      logger.warn(
        'Yearトーナメントの参加費の価格が照会の結果に無いため、参加費を表示できないものとして返しました',
        { priceLookup: YEAR_ENTRY_PRICE_LOOKUP_KEY, stale: result.stale },
      );
      return null;
    }
    return { amount: price.unitAmount, currency: price.currency };
  }

  // ローンチの要約の供給元と同じ規則で、ブラケットへの記録の前に確定した直近のYearのマッチの負けも敗退とみなす
  private async progressOf({
    launchId,
    entry,
    year,
    now,
  }: {
    readonly launchId: string;
    readonly entry: YearEntryRecord;
    readonly year: YearCalendarEntry;
    readonly now: Date;
  }): Promise<YearEntryProgress | null> {
    if (entry.status !== 'drawn') {
      return null;
    }
    if (isChampion(entry, year)) {
      return CHAMPION;
    }
    const standing = (
      await this.brackets.findParticipantStandings('year', [entry.entryId])
    ).get(entry.entryId);
    // 凍結の後、組み合わせを書き終えるまではブラケットの参加者が無い
    if (standing === undefined) {
      return year.record?.status === 'drawing' ? ALIVE : SETTLED;
    }
    if (standing.eliminatedRound !== null) {
      return eliminatedIn(standing.shape, standing.eliminatedRound);
    }
    if (standing.status !== 'active' || standing.champion) {
      return SETTLED;
    }
    const latest = (
      (await this.matches.listByLaunches([launchId], now)).get(launchId) ?? []
    ).find(({ kind }) => kind === 'year');
    if (latest?.phase !== 'finished' || latest.round === null) {
      return ALIVE;
    }
    const side = latest.entries.find((match) => match.launchId === launchId);
    return side?.result === 'lost'
      ? eliminatedIn(standing.shape, latest.round)
      : ALIVE;
  }
}
