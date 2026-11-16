import type { Logger } from '@logtape/logtape';
import { captureException } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MatchDirectory } from '../../core/match/ports.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../core/product/ports.ts';
import type { BusinessDate } from '../../core/time/business-time.ts';
import { nextBusinessDate } from '../../core/tournament/round-schedule.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  WeekDrawService,
  WeekEntryClassification,
  WeekEntryRecord,
  WeekEntryRegistrar,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { safeTagOf } from './incident-tags.ts';
import { qualifierWinnersOf } from './week-entry-registrar.ts';

// 23:45のジョブの1回の実行で組み合わせを決める週の上限
const DRAW_DUE_LIMIT = 4;

// プロダクトの照会が1回に読む件数にそろえる
const CLASSIFICATION_PAGE_SIZE = 90;

const DAYS_PER_WEEK = 7;

const DRAW_FAILED_MESSAGE = 'Weekトーナメントの組み合わせ決定に失敗しました';

export interface WeekTournamentDrawServiceOptions {
  readonly appName: LoggingOptions['appName'];
  readonly store: WeekTournamentStore;
  readonly registrar: WeekEntryRegistrar;
  readonly matches: MatchDirectory;
  readonly products: ProductDirectory;
  readonly entitlements: UltrasEntitlements;
}

function weekDatesOf(weekStart: BusinessDate): BusinessDate[] {
  const dates = [weekStart];
  while (dates.length < DAYS_PER_WEEK) {
    dates.push(nextBusinessDate(dates.at(-1) ?? weekStart));
  }
  return dates;
}

// 受付中の枠はUltrasの期間内なら参加資格の枠として、資格を得た枠と同じ規則でプロダクトの状態から分類する
function classificationOf(
  entry: WeekEntryRecord,
  products: ReadonlyMap<string, ProductSummaryRecord>,
  ultrasEntryIds: ReadonlySet<string>,
): WeekEntryClassification {
  const { entryId } = entry;
  const grantedByUltras =
    entry.status === 'awaiting_payment' && ultrasEntryIds.has(entryId);
  if (entry.status === 'awaiting_payment' && !grantedByUltras) {
    return { entryId, status: 'expired', closeReason: 'deadline' };
  }
  const source = grantedByUltras
    ? { entitlementSource: 'ultras' as const }
    : {};
  const product =
    entry.productId === null ? undefined : products.get(entry.productId);
  if (product === undefined) {
    return { entryId, status: 'forfeited', closeReason: 'deleted', ...source };
  }
  if (!product.visible) {
    return {
      entryId,
      status: 'excluded',
      closeReason: 'hidden_or_suspended',
      ...source,
    };
  }
  return { entryId, status: 'drawn', closeReason: null, ...source };
}

export class WeekTournamentDrawService implements WeekDrawService {
  private readonly logger: Logger;
  private readonly store: WeekTournamentStore;
  private readonly registrar: WeekEntryRegistrar;
  private readonly matches: MatchDirectory;
  private readonly products: ProductDirectory;
  private readonly entitlements: UltrasEntitlements;

  constructor(options: WeekTournamentDrawServiceOptions) {
    this.logger = getAppLogger([options.appName, 'week-tournament', 'draw']);
    this.store = options.store;
    this.registrar = options.registrar;
    this.matches = options.matches;
    this.products = options.products;
    this.entitlements = options.entitlements;
  }

  async drawDue(now: Date): Promise<{
    readonly drawn: readonly string[];
    readonly failed: readonly string[];
  }> {
    const tournaments = await this.store.listDue(now, DRAW_DUE_LIMIT);
    const drawn: string[] = [];
    const failed: string[] = [];
    for (const tournament of tournaments) {
      try {
        await this.drawTournament(tournament, now);
        drawn.push(tournament.tournamentId);
      } catch (error) {
        failed.push(tournament.tournamentId);
        this.reportFailure(tournament.tournamentId, error);
      }
    }
    return { drawn, failed };
  }

  // 凍結済みの週は前回の実行が補完を終えているため、続きの分類から行う
  private async drawTournament(
    tournament: WeekTournamentRecord,
    now: Date,
  ): Promise<void> {
    if (tournament.drawStartedAt === null) {
      await this.complementEntries(tournament, now);
      await this.store.freeze(tournament.tournamentId, now);
    }
    await this.classifyEntries(tournament, now);
  }

  // 勝利の知らせの処理が遅れた枠を作る。枠のある勝利は登録の問い合わせを省き、1回の実行の問い合わせの数を抑える
  private async complementEntries(
    tournament: WeekTournamentRecord,
    now: Date,
  ): Promise<void> {
    for (const date of weekDatesOf(tournament.window.weekStart)) {
      const decided = (
        await this.matches.listForDate({ date, kinds: ['qualifier'], now })
      ).filter((match) => match.decidedAt !== null);
      const winningLaunchIds = decided.map((match) =>
        qualifierWinnersOf(match).map(({ launchId }) => launchId),
      );
      const existing = await this.store.findEntriesByLaunch(
        winningLaunchIds.flat(),
      );
      for (const [index, match] of decided.entries()) {
        if (
          winningLaunchIds[index]?.some((launchId) => !existing.has(launchId))
        ) {
          await this.registrar.registerFromMatch(match, now);
        }
      }
    }
  }

  private async classifyEntries(
    tournament: WeekTournamentRecord,
    now: Date,
  ): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const entries = await this.store.listEntriesForClassification(
        tournament.tournamentId,
        after,
        CLASSIFICATION_PAGE_SIZE,
      );
      if (entries.length === 0) {
        return;
      }
      const [products, ultrasEntryIds] = await Promise.all([
        this.products.findSummaries(
          entries.flatMap(({ productId }) =>
            productId === null ? [] : [productId],
          ),
          'not-deleted',
        ),
        this.ultrasEntitledEntryIds(entries, tournament.window.deadlineAt),
      ]);
      await this.store.classify(
        entries.map((entry) =>
          classificationOf(entry, products, ultrasEntryIds),
        ),
        now,
      );
      if (entries.length < CLASSIFICATION_PAGE_SIZE) {
        return;
      }
      after = entries.at(-1)?.entryId;
    }
  }

  // 投稿者の一覧で期間内の加入がある投稿者に絞ってから、枠ごとに勝利の確定から決済期限までを確かめる。
  // 決済期限の後に確定した勝利は免除の期間が空で、特典の判定は始まりが終わりより後の期間を例外にするため問い合わせない
  private async ultrasEntitledEntryIds(
    entries: readonly WeekEntryRecord[],
    deadlineAt: Date,
  ): Promise<ReadonlySet<string>> {
    const awaiting = entries.flatMap((entry) =>
      entry.status === 'awaiting_payment' &&
      entry.ownerUserId !== null &&
      entry.wonAt.getTime() <= deadlineAt.getTime()
        ? [{ entry, ownerUserId: entry.ownerUserId }]
        : [],
    );
    if (awaiting.length === 0) {
      return new Set();
    }
    const earliestWonAt = Math.min(
      ...awaiting.map(({ entry }) => entry.wonAt.getTime()),
    );
    const candidates = await this.entitlements.entitledUsersDuring(
      [...new Set(awaiting.map(({ ownerUserId }) => ownerUserId))],
      new Date(earliestWonAt),
      deadlineAt,
    );
    const checked = await Promise.all(
      awaiting
        .filter(({ ownerUserId }) => candidates.has(ownerUserId))
        .map(async ({ entry, ownerUserId }) =>
          (await this.entitlements.wasEntitledDuring(
            ownerUserId,
            entry.wonAt,
            deadlineAt,
          ))
            ? [entry.entryId]
            : [],
        ),
    );
    return new Set(checked.flat());
  }

  // タグは除去処理の対象外のため、識別子の形の値だけを送る
  private reportFailure(tournamentId: string, error: unknown): void {
    this.logger.error(DRAW_FAILED_MESSAGE, { tournamentId, error });
    captureException(error, {
      tags: {
        tournament_incident: 'draw-failed',
        tournament_id: safeTagOf(tournamentId),
      },
    });
  }
}
