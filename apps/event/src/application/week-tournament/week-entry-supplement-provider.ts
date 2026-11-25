import { weekStartOf } from '../../../common-lib/tournament/week-period.ts';
import { formatUtcDateTime } from '../../../lib/core/email/format-utc-date-time.ts';
import { isWinningResult } from '../../../lib/core/match/match-model.ts';
import type {
  ResultNoticeSupplement,
  ResultNoticeSupplementInput,
  ResultNoticeSupplementProvider,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  WeekEntryRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import {
  entryWindowFor,
  isSundayLaunch,
  type WeekEntryWindow,
} from '../../../lib/core/week-tournament/week-schedule.ts';

export interface WeekEntrySupplementProviderDependencies {
  readonly store: WeekTournamentStore;
  readonly products: ProductDirectory;
  readonly clock: Clock;
  readonly clientSiteOrigin: string;
}

const PRODUCT_PATH_PREFIX = '/p/';

const EXEMPT_TITLE = 'Weekトーナメントの参加資格を得ました';
const EXEMPT_LINE =
  'Ultrasの特典により参加費は免除されます。参加のための操作は不要です。';
const PAYABLE_TITLE = 'Weekトーナメントに参加できます';
const PAYABLE_LINE =
  '期限までに決済すると、Product of the Weekを決めるトーナメントに参加できます。';
const PAYMENT_ACTION_LABEL = '参加費を支払う';

// 枠の作成(予選のマッチイベントの処理)より先に夜の結果通知が送られ得るため、枠の無い勝利も受付中として扱う
export class WeekEntrySupplementProvider implements ResultNoticeSupplementProvider {
  private readonly store: WeekTournamentStore;
  private readonly products: ProductDirectory;
  private readonly clock: Clock;
  private readonly clientSiteOrigin: string;

  constructor(dependencies: WeekEntrySupplementProviderDependencies) {
    this.store = dependencies.store;
    this.products = dependencies.products;
    this.clock = dependencies.clock;
    this.clientSiteOrigin = dependencies.clientSiteOrigin;
  }

  async supplementFor(
    input: ResultNoticeSupplementInput,
  ): Promise<ResultNoticeSupplement | undefined> {
    if (
      input.kind !== 'qualifier' ||
      !isWinningResult(input.result) ||
      input.launchId === null
    ) {
      return undefined;
    }
    const entry = (await this.store.findEntriesByLaunch([input.launchId])).get(
      input.launchId,
    );
    if (entry?.status === 'entitled' && entry.entitlementSource === 'ultras') {
      const window = await this.windowOf(entry, input.matchDate);
      return {
        title: EXEMPT_TITLE,
        lines: [
          EXEMPT_LINE,
          `組み合わせは${formatUtcDateTime(window.drawAt)}に決定します。`,
        ],
        emphasized: false,
      };
    }
    if (entry !== undefined && entry.status !== 'awaiting_payment') {
      return undefined;
    }
    const window = await this.windowOf(entry, input.matchDate);
    if (this.clock.now().getTime() >= window.acceptUntil.getTime()) {
      return undefined;
    }
    const action = await this.paymentActionOf(input.productId);
    return {
      title: PAYABLE_TITLE,
      lines: [
        `参加費の決済期限: ${formatUtcDateTime(window.acceptUntil)}`,
        PAYABLE_LINE,
      ],
      ...(action === undefined ? {} : { action }),
      emphasized: isSundayLaunch(input.matchDate),
    };
  }

  // 期限は週の作成時に保存した列を読む。週がまだ作られていなければ、作成時に保存されるのと同じ規則の値を使う
  private async windowOf(
    entry: WeekEntryRecord | undefined,
    matchDate: BusinessDate,
  ): Promise<WeekEntryWindow> {
    const weekStart = parseBusinessDate(weekStartOf(matchDate));
    const tournament =
      entry === undefined
        ? await this.store.findTournamentByWeek(weekStart)
        : await this.store.findTournament(entry.tournamentId);
    return tournament?.window ?? entryWindowFor(weekStart);
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
