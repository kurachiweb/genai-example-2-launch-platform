import { formatUtcDateTime } from '../../../lib/core/email/format-utc-date-time.ts';
import { isWinningResult } from '../../../lib/core/match/match-model.ts';
import type {
  ResultNoticeSupplement,
  ResultNoticeSupplementInput,
  ResultNoticeSupplementProvider,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../../common-lib/time/business-date-label.ts';
import type { YearSchedule } from '../../../lib/core/year-tournament/year-schedule.ts';

export interface YearEntrySupplementProviderDependencies {
  readonly store: YearEntryStore;
  readonly calendar: YearCalendar;
  readonly products: ProductDirectory;
  readonly clock: Clock;
  readonly clientSiteOrigin: string;
}

const PRODUCT_PATH_PREFIX = '/p/';

const EXEMPT_TITLE = 'Yearトーナメントの参加資格を得ました';
const EXEMPT_LINE =
  'Ultrasの特典により参加費は免除されます。参加のための操作は不要です。';
const PAYABLE_TITLE = 'Yearトーナメントに参加できます';
const PAYMENT_ACTION_LABEL = '参加費を支払う';

function isWeekChampionResult(input: ResultNoticeSupplementInput): boolean {
  return input.kind === 'week' && isWinningResult(input.result);
}

function isUltrasEntitled(entry: YearEntryRecord): boolean {
  return entry.status === 'entitled' && entry.entitlementSource === 'ultras';
}

// 枠はWeek優勝の取り込み(23:45のジョブ)が作り、送り出しはその後に始まる。Yearのジョブが失敗して枠が無い夜は追記しない。
export class YearEntrySupplementProvider implements ResultNoticeSupplementProvider {
  private readonly store: YearEntryStore;
  private readonly calendar: YearCalendar;
  private readonly products: ProductDirectory;
  private readonly clock: Clock;
  private readonly clientSiteOrigin: string;

  constructor(dependencies: YearEntrySupplementProviderDependencies) {
    this.store = dependencies.store;
    this.calendar = dependencies.calendar;
    this.products = dependencies.products;
    this.clock = dependencies.clock;
    this.clientSiteOrigin = dependencies.clientSiteOrigin;
  }

  async supplementFor(
    input: ResultNoticeSupplementInput,
  ): Promise<ResultNoticeSupplement | undefined> {
    if (!isWeekChampionResult(input) || input.launchId === null) {
      return undefined;
    }
    const entry = (await this.store.findByLaunches([input.launchId])).get(
      input.launchId,
    );
    if (entry === undefined) {
      return undefined;
    }
    const ultrasEntitled = isUltrasEntitled(entry);
    if (!ultrasEntitled && entry.status !== 'awaiting_payment') {
      return undefined;
    }
    const now = this.clock.now();
    const target = await this.calendar.resolveAward(entry.awardedDate, now);
    if (target.kind !== 'open') {
      return undefined;
    }
    const { schedule } = target.year;
    if (ultrasEntitled) {
      return {
        title: EXEMPT_TITLE,
        lines: [
          EXEMPT_LINE,
          `組み合わせは${formatUtcDateTime(schedule.drawAt)}に決定します。`,
        ],
        emphasized: false,
      };
    }
    if (now.getTime() >= schedule.acceptUntil.getTime()) {
      return undefined;
    }
    return this.payableSupplementOf(schedule, input.productId);
  }

  private async payableSupplementOf(
    schedule: YearSchedule,
    productId: string,
  ): Promise<ResultNoticeSupplement> {
    const action = await this.paymentActionOf(productId);
    return {
      title: PAYABLE_TITLE,
      lines: [
        `参加費の決済期限: ${formatUtcDateTime(schedule.acceptUntil)}`,
        `期限までに決済すると、${String(schedule.year)}年のProduct of the Yearを決めるトーナメントに参加できます。決勝は${formatBusinessDateWithWeekdayLabel(schedule.finalDate)}です。`,
      ],
      ...(action === undefined ? {} : { action }),
      emphasized: false,
    };
  }

  private async paymentActionOf(
    productId: string,
  ): Promise<ResultNoticeSupplement['action']> {
    const product = (
      await this.products.findSummaries([productId], 'visible')
    ).get(productId);
    if (product === undefined) {
      return undefined;
    }
    return {
      label: PAYMENT_ACTION_LABEL,
      url: new URL(
        `${PRODUCT_PATH_PREFIX}${encodeURIComponent(product.handle)}`,
        this.clientSiteOrigin,
      ).href,
    };
  }
}
