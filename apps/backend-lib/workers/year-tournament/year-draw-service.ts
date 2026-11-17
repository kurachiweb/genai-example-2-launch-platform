import type { Logger } from '@logtape/logtape';
import { captureException } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../core/product/ports.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  YearDrawService,
  YearEntryClassification,
  YearEntryRecord,
  YearEntryRegistrar,
  YearEntryStore,
  YearTournamentRecord,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import {
  type CapacityCandidate,
  selectWithinCapacity,
} from '../../core/year-tournament/year-capacity.ts';
import { YEAR_MAX_PARTICIPANTS } from '../../core/year-tournament/year-schedule.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { safeTagOf } from './incident-tags.ts';

// 23:45のジョブの1回の実行で組み合わせを決める年の上限
const DRAW_DUE_LIMIT = 2;

// プロダクトの照会が1回に読む件数にそろえる
const CLASSIFICATION_PAGE_SIZE = 90;

const DRAW_FAILED_MESSAGE = 'Yearトーナメントの組み合わせ決定に失敗しました';

const PARTICIPANTS_SELECTED_MESSAGE =
  'Yearトーナメントの組み合わせの対象を決めました';

export interface YearTournamentDrawServiceOptions {
  readonly appName: LoggingOptions['appName'];
  readonly tournaments: YearTournamentStore;
  readonly entries: YearEntryStore;
  readonly registrar: YearEntryRegistrar;
  readonly products: ProductDirectory;
  readonly entitlements: UltrasEntitlements;
}

type DrawnCapacityCandidate = CapacityCandidate & {
  readonly entry: YearEntryRecord;
};

// 受付中の枠はUltrasの期間内なら参加資格の枠として、参加資格の枠と同じ規則でプロダクトの状態から分類する
function classificationOf(
  entry: YearEntryRecord,
  products: ReadonlyMap<string, ProductSummaryRecord>,
  ultrasEntryIds: ReadonlySet<string>,
): YearEntryClassification {
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

// 紐付けの解除でローンチのIDを失っても再実行で同じ枠を選ぶよう、枠ごとに一意で変わらないWeekトーナメントのIDを同時刻の決め手にする
function capacityCandidateOf(entry: YearEntryRecord): DrawnCapacityCandidate {
  return {
    ref: entry.entryId,
    awardedAt: entry.awardedAt,
    tieBreaker: entry.weekTournamentId,
    entry,
  };
}

export class YearTournamentDrawService implements YearDrawService {
  private readonly logger: Logger;
  private readonly tournaments: YearTournamentStore;
  private readonly entries: YearEntryStore;
  private readonly registrar: YearEntryRegistrar;
  private readonly products: ProductDirectory;
  private readonly entitlements: UltrasEntitlements;

  constructor(options: YearTournamentDrawServiceOptions) {
    this.logger = getAppLogger([options.appName, 'year-tournament', 'draw']);
    this.tournaments = options.tournaments;
    this.entries = options.entries;
    this.registrar = options.registrar;
    this.products = options.products;
    this.entitlements = options.entitlements;
  }

  async drawDue(now: Date): Promise<{
    readonly drawn: readonly number[];
    readonly failed: readonly number[];
  }> {
    const tournaments = await this.tournaments.listDue(now, DRAW_DUE_LIMIT);
    const drawn: number[] = [];
    const failed: number[] = [];
    for (const tournament of tournaments) {
      try {
        await this.drawYear(tournament, now);
        drawn.push(tournament.year);
      } catch (error) {
        failed.push(tournament.year);
        this.reportFailure(tournament, error);
      }
    }
    return { drawn, failed };
  }

  private async drawYear(
    tournament: YearTournamentRecord,
    now: Date,
  ): Promise<void> {
    await this.selectParticipants(tournament, now);
  }

  // 凍結済みの年は前回の実行が補完を終えているため、続きの分類から行う。
  // 再実行でも同じ枠を返すよう、上限の判定は分類を終えた後の組み合わせの対象の全体で毎回行う
  private async selectParticipants(
    tournament: YearTournamentRecord,
    now: Date,
  ): Promise<readonly YearEntryRecord[]> {
    if (tournament.drawStartedAt === null) {
      await this.registrar.syncChampions({ awardedFrom: null, now });
      await this.tournaments.freeze(tournament.yearTournamentId, now);
    }
    await this.classifyEntries(tournament, now);
    const { kept, overflow } = selectWithinCapacity(
      (await this.entries.listDrawn(tournament.year)).map(capacityCandidateOf),
      YEAR_MAX_PARTICIPANTS,
    );
    await this.entries.excludeOverCapacity(
      tournament.year,
      overflow.map(({ ref }) => ref),
      now,
    );
    this.logger.info(PARTICIPANTS_SELECTED_MESSAGE, {
      yearTournamentId: tournament.yearTournamentId,
      year: tournament.year,
      participantCount: kept.length,
      overCapacityCount: overflow.length,
    });
    return kept.map(({ entry }) => entry);
  }

  // 分類した枠は対象の候補から外れるため、読んだ最後の枠より後を続けて読む
  private async classifyEntries(
    tournament: YearTournamentRecord,
    now: Date,
  ): Promise<void> {
    const { deadlineDate, deadlineAt } = tournament.schedule;
    let after: string | undefined;
    for (;;) {
      const entries = await this.entries.listCandidates(
        deadlineDate,
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
        this.ultrasEntitledEntryIds(entries, deadlineAt),
      ]);
      await this.entries.classify(
        tournament.year,
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

  // 投稿者の一覧で期間内の加入がある投稿者に絞ってから、枠ごとにWeek優勝の日時から決済期限までを確かめる
  private async ultrasEntitledEntryIds(
    entries: readonly YearEntryRecord[],
    deadlineAt: Date,
  ): Promise<ReadonlySet<string>> {
    const awaiting = entries.flatMap((entry) =>
      entry.status === 'awaiting_payment' && entry.ownerUserId !== null
        ? [
            {
              entryId: entry.entryId,
              ownerUserId: entry.ownerUserId,
              awardedAt: entry.awardedAt,
            },
          ]
        : [],
    );
    if (awaiting.length === 0) {
      return new Set();
    }
    const candidates = await this.entitlements.entitledUsersDuring(
      [...new Set(awaiting.map(({ ownerUserId }) => ownerUserId))],
      new Date(
        Math.min(...awaiting.map(({ awardedAt }) => awardedAt.getTime())),
      ),
      deadlineAt,
    );
    const checked = await Promise.all(
      awaiting
        .filter(({ ownerUserId }) => candidates.has(ownerUserId))
        .map(async ({ entryId, ownerUserId, awardedAt }) =>
          (await this.entitlements.wasEntitledDuring(
            ownerUserId,
            awardedAt,
            deadlineAt,
          ))
            ? [entryId]
            : [],
        ),
    );
    return new Set(checked.flat());
  }

  private reportFailure(
    tournament: YearTournamentRecord,
    error: unknown,
  ): void {
    this.logger.error(DRAW_FAILED_MESSAGE, {
      yearTournamentId: tournament.yearTournamentId,
      year: tournament.year,
      error,
    });
    captureException(error, {
      tags: {
        year: String(tournament.year),
        year_tournament_id: safeTagOf(tournament.yearTournamentId),
      },
    });
  }
}
