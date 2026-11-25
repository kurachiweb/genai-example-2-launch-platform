import { eq } from 'drizzle-orm';

import type { Database } from '../../../../db/client.ts';
import { weekTournamentEntries } from '../../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../../db/schema/tournament/week-tournaments.ts';
import type {
  EmailSender,
  EmailSendRequest,
} from '../../../core/email/ports.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';
import { matchWindow } from '../../../core/match/match-model.ts';
import type { MatchRecord } from '../../../core/match/ports.ts';
import {
  type NotificationEvent,
  notificationEventDedupeKey,
  type NotificationEventPublisher,
  type NotificationPublishRequest,
  type NotificationPublishResult,
} from '../../../core/notifications/notification-event-contract.ts';
import type {
  PaymentRefunds,
  RefundRequestInput,
} from '../../../core/payments/ports.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import type { BracketDraw } from '../../../core/tournament/ports.ts';
import type { UltrasEntitlements } from '../../../core/ultras/ports.ts';
import type {
  WeekEntryClassification,
  WeekEntryRecord,
  WeekEntryRegistrar,
  WeekTournamentFinish,
} from '../../../core/week-tournament/ports.ts';
import { D1UserContactDirectory } from '../../identity/d1-user-contact-directory.ts';
import { D1MatchDirectory } from '../../match/d1-match-directory.ts';
import type { MatchFixture } from '../../match/testing/match-fixtures.ts';
import { D1ProductDirectory } from '../../product/d1-product-directory.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  launchIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import { D1BracketDraw } from '../../tournament/d1-bracket-draw.ts';
import { createProgression } from '../../tournament/testing/progression-fixtures.ts';
import { D1WeekTournamentStore } from '../d1-week-tournament-store.ts';
import { WeekTournamentDrawService } from '../week-draw-service.ts';
import { WeekEntryRefundFollowUp } from '../week-entry-follow-up.ts';
import { QualifierWeekEntryRegistrar } from '../week-entry-registrar.ts';
import { WeekTournamentNotificationPublisher } from '../week-notification-publisher.ts';
import { WeekTournamentProgressionService } from '../week-progression-service.ts';
import {
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekEntryFixture,
  weekTournamentIdOf,
} from './week-tournament-fixtures.ts';

export const DRAW_CATEGORY = 'api.week-tournament.draw';

export const TOURNAMENT_ID = weekTournamentIdOf(1);

export const DRAW_AT = WEEK_WINDOW.drawAt;

export const DEADLINE_AT = WEEK_WINDOW.deadlineAt;

// 枠の勝利の確定(補助の既定値)
export const WON_AT = new Date('2026-11-21T08:00:00.000Z');

export const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

// 投稿者1は特典なし、2は期間内にUltrasへ加入、3は停止中、4は組み合わせ決定と同時にUltrasへ加入
export const PLAIN_OWNER = 1;
export const ULTRAS_OWNER = 2;
export const SUSPENDED_OWNER = 3;
export const LATE_ULTRAS_OWNER = 4;

const ULTRAS_ACTIVATED_AT = new Date('2026-11-22T00:00:00.000Z');

const DECIDED_OFFSET_MS = 60_000;

export const ENTITLED_BY_PAYMENT = {
  status: 'entitled',
  entitlementSource: 'payment',
  purchaseId: PURCHASE_ID,
  entitledAt: T0,
} as const;

export const ENTITLED_BY_ULTRAS = {
  status: 'entitled',
  entitlementSource: 'ultras',
  entitledAt: T0,
} as const;

export interface EntitlementQuery {
  readonly userIds: readonly string[];
  readonly from: Date;
  readonly to: Date;
}

export interface FakeEntitlements {
  readonly entitlements: UltrasEntitlements;
  readonly activate: (userIndex: number, at: Date) => void;
  readonly queries: EntitlementQuery[];
}

// 実物と同じく両端を含む期間との重なりで答え、始まりが終わりより後の期間は例外にする。特典は加入の後に終わらない
export function createEntitlements(): FakeEntitlements {
  const activations = new Map<string, Date>([
    [userIdOf(ULTRAS_OWNER), ULTRAS_ACTIVATED_AT],
  ]);
  const queries: EntitlementQuery[] = [];
  const entitledUsersDuring = (
    userIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<ReadonlySet<string>> => {
    if (from.getTime() > to.getTime()) {
      return Promise.reject(new RangeError('期間の始まりが終わりより後です'));
    }
    queries.push({ userIds, from, to });
    return Promise.resolve(
      new Set(
        userIds.filter((userId) => {
          const activatedAt = activations.get(userId);
          return activatedAt !== undefined && activatedAt <= to;
        }),
      ),
    );
  };
  const unused = (): never => {
    throw new Error('この判定は使わない');
  };
  return {
    entitlements: {
      isEntitledAt: unused,
      wasEntitledDuring: async (userId, from, to) =>
        (await entitledUsersDuring([userId], from, to)).has(userId),
      entitledUsersAt: unused,
      entitledUsersDuring,
      currentPlan: unused,
    },
    activate: (userIndex, at) => {
      activations.set(userIdOf(userIndex), at);
    },
    queries,
  };
}

function sequentialEntryIds(start: number): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = weekEntryIdOf(next);
      next += 1;
      return id;
    },
  };
}

export type StoreCall =
  'freeze' | 'listEntriesForClassification' | 'classify' | 'insertEntry';

export interface ObservedStoreHooks {
  readonly afterFreeze?: () => Promise<void>;
  readonly failFreezeOf?: string;
  // 組み合わせの後、週への記録の前に中断した状態を作る
  readonly failMarkDrawnOf?: string;
}

// 呼び出しの順と分類の読み取りの件数を記録し、凍結の直後に同時の書き込みを差し込めるストア
export class ObservedStore extends D1WeekTournamentStore {
  readonly calls: StoreCall[] = [];
  readonly classificationPageSizes: number[] = [];
  readonly classified: WeekEntryClassification[] = [];

  constructor(
    database: Database,
    private readonly hooks: ObservedStoreHooks = {},
  ) {
    super(database);
  }

  override async freeze(tournamentId: string, at: Date): Promise<boolean> {
    this.calls.push('freeze');
    if (tournamentId === this.hooks.failFreezeOf) {
      throw new Error('凍結の一時的な失敗');
    }
    const frozen = await super.freeze(tournamentId, at);
    await this.hooks.afterFreeze?.();
    return frozen;
  }

  override async listEntriesForClassification(
    tournamentId: string,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]> {
    this.calls.push('listEntriesForClassification');
    const entries = await super.listEntriesForClassification(
      tournamentId,
      afterEntryId,
      limit,
    );
    this.classificationPageSizes.push(entries.length);
    return entries;
  }

  override async classify(
    updates: readonly WeekEntryClassification[],
    at: Date,
  ): Promise<void> {
    this.calls.push('classify');
    this.classified.push(...updates);
    await super.classify(updates, at);
  }

  override insertEntry(
    ...args: Parameters<D1WeekTournamentStore['insertEntry']>
  ): ReturnType<D1WeekTournamentStore['insertEntry']> {
    this.calls.push('insertEntry');
    return super.insertEntry(...args);
  }

  override markDrawn(
    tournamentId: string,
    bracketId: string,
    finished: WeekTournamentFinish | null,
    at: Date,
  ): Promise<void> {
    if (tournamentId === this.hooks.failMarkDrawnOf) {
      return Promise.reject(new Error('週への記録の一時的な失敗'));
    }
    return super.markDrawn(tournamentId, bracketId, finished, at);
  }
}

// 実物の発行の口と同じく、記録済みの通知イベントを重複として数える
export class RecordingNotificationEvents implements NotificationEventPublisher {
  readonly recorded = new Map<string, NotificationEvent>();

  publish(
    request: NotificationPublishRequest,
  ): Promise<NotificationPublishResult> {
    const newEvents = request.events.filter(
      (event) => !this.recorded.has(notificationEventDedupeKey(event)),
    );
    for (const event of newEvents) {
      this.recorded.set(notificationEventDedupeKey(event), event);
    }
    return Promise.resolve({
      recorded: newEvents.length,
      duplicates: request.events.length - newEvents.length,
    });
  }

  events(): NotificationEvent[] {
    return [...this.recorded.values()];
  }
}

const notUsed = (): never => {
  throw new Error('この操作は使わない');
};

function createRefunds(requests: RefundRequestInput[]): PaymentRefunds {
  return {
    request: (input) => {
      requests.push(input);
      return Promise.resolve({
        kind: 'accepted',
        refundRequestId: `01JD0REFVND${String(requests.length).padStart(15, '0')}`,
        duplicate: false,
      });
    },
    dispatch: notUsed,
    redispatch: notUsed,
  };
}

// 実際の送信要求と同じく、入力が種別の検証規則に合わなければ拒否する
function createSender(
  sent: EmailSendRequest<unknown>[],
  failure: Error | undefined,
): EmailSender {
  return {
    send: <TInput>(request: EmailSendRequest<TInput>) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      request.kind.inputSchema.parse(request.input);
      sent.push(request);
      return Promise.resolve(
        `01JC0EMA11${String(sent.length).padStart(16, '0')}`,
      );
    },
  };
}

function failingDrawOf(inner: BracketDraw, tournamentId: string): BracketDraw {
  return {
    create: (input) =>
      input.tournamentId === tournamentId
        ? Promise.reject(new Error('組み合わせの一時的な失敗'))
        : inner.create(input),
  };
}

export const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

// 組み合わせ決定が作るマッチのIDの採番の始まり
export const DRAW_MATCH_IDS = 701;

export interface DrawServiceOptions extends ObservedStoreHooks {
  readonly database?: Database;
  readonly entitlements?: FakeEntitlements;
  readonly notifications?: RecordingNotificationEvents;
  readonly failDrawOf?: string;
  readonly emailFailure?: Error;
}

export function createDrawService(options: DrawServiceOptions = {}) {
  const database = options.database ?? db;
  const store = new ObservedStore(database, options);
  const { entitlements, queries } =
    options.entitlements ?? createEntitlements();
  const registered: string[] = [];
  const qualifierRegistrar = new QualifierWeekEntryRegistrar(
    store,
    entitlements,
    sequentialEntryIds(500),
    'api',
  );
  const registrar: WeekEntryRegistrar = {
    registerFromMatch: (match: MatchRecord, at: Date) => {
      registered.push(match.matchId);
      return qualifierRegistrar.registerFromMatch(match, at);
    },
  };
  const matches = new D1MatchDirectory(database);
  const notifications =
    options.notifications ?? new RecordingNotificationEvents();
  const { progression, scheduler } = createProgression(
    DRAW_MATCH_IDS,
    database,
  );
  const bracketDraw = new D1BracketDraw(database, progression);
  const refundRequests: RefundRequestInput[] = [];
  const sent: EmailSendRequest<unknown>[] = [];
  const service = new WeekTournamentDrawService({
    appName: 'api',
    store,
    registrar,
    matches,
    products: new D1ProductDirectory(database),
    entitlements,
    bracketDraw:
      options.failDrawOf === undefined
        ? bracketDraw
        : failingDrawOf(bracketDraw, options.failDrawOf),
    progression: new WeekTournamentProgressionService(
      store,
      progression,
      new WeekTournamentNotificationPublisher(
        store,
        matches,
        notifications,
        'api',
      ),
      'api',
    ),
    followUp: new WeekEntryRefundFollowUp({
      appName: 'api',
      store,
      refunds: createRefunds(refundRequests),
      contacts: new D1UserContactDirectory(database),
      emails: createSender(sent, options.emailFailure),
      clientSiteOrigin: CLIENT_SITE_ORIGIN,
    }),
  });
  return {
    service,
    store,
    registered,
    queries,
    notifications,
    scheduler,
    refundRequests,
    sent,
  };
}

export async function readEntry(index: number) {
  const [row] = await db
    .select({
      status: weekTournamentEntries.status,
      closeReason: weekTournamentEntries.closeReason,
      entitlementSource: weekTournamentEntries.entitlementSource,
      purchaseId: weekTournamentEntries.purchaseId,
      entitledAt: weekTournamentEntries.entitledAt,
      closedAt: weekTournamentEntries.closedAt,
      refundStatus: weekTournamentEntries.refundStatus,
    })
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

export async function readEntryByLaunch(launch: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.launchId, launchIdOf(launch)));
  return row;
}

export async function readTournament(index = 1) {
  const [row] = await db
    .select({
      status: weekTournaments.status,
      drawStartedAt: weekTournaments.drawStartedAt,
    })
    .from(weekTournaments)
    .where(eq(weekTournaments.id, weekTournamentIdOf(index)));
  return row;
}

export async function readDrawnTournament(index = 1) {
  const [row] = await db
    .select({
      status: weekTournaments.status,
      bracketId: weekTournaments.bracketId,
      drawnAt: weekTournaments.drawnAt,
      outcome: weekTournaments.outcome,
      championEntryId: weekTournaments.championEntryId,
      awardedAt: weekTournaments.awardedAt,
    })
    .from(weekTournaments)
    .where(eq(weekTournaments.id, weekTournamentIdOf(index)));
  return row;
}

// 同じ番号のプロダクトとローンチを投稿者ごとに作る
export async function seedProducts(
  owner: number,
  indexes: readonly number[],
  columns: Parameters<typeof insertProducts>[2] = {},
): Promise<void> {
  await insertProducts(indexes, owner, columns);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
}

// 週1の枠を、同じ番号のローンチとプロダクトで作る
export function entryOf(
  index: number,
  owner: number,
  columns: WeekEntryFixture['columns'] = {},
): WeekEntryFixture {
  return {
    index,
    tournament: 1,
    launch: index,
    product: index,
    owner,
    columns: { wonAt: WON_AT, ...columns },
  };
}

interface QualifierSide {
  readonly launch: number;
  readonly owner: number;
}

// 指定した日の予選で、勝利の側と敗北の側を持つ確定したマッチ
export function decidedQualifierOn(
  index: number,
  date: string,
  winner: QualifierSide,
  loser: QualifierSide,
): MatchFixture {
  const window = matchWindow(parseBusinessDate(date));
  return {
    index,
    columns: {
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      startedAt: window.startsAt,
      decidedAt: new Date(window.endsAt.getTime() + DECIDED_OFFSET_MS),
      decision: 'votes',
    },
    entries: [
      {
        index: index * 10 + 1,
        launch: winner.launch,
        product: winner.launch,
        owner: winner.owner,
        columns: {
          upvoteCount: 12,
          lastUpvotedAt: new Date(window.startsAt.getTime() + 3_600_000),
          lastUpvoteSeq: 1,
          result: 'won',
        },
      },
      {
        index: index * 10 + 2,
        launch: loser.launch,
        product: loser.launch,
        owner: loser.owner,
        columns: { upvoteCount: 3, lastUpvoteSeq: 2, result: 'lost' },
      },
    ],
  };
}

// 指定した日の予選で、結果が確定していないマッチ
export function undecidedQualifierOn(
  index: number,
  date: string,
  sides: readonly [QualifierSide, QualifierSide],
): MatchFixture {
  const window = matchWindow(parseBusinessDate(date));
  return {
    index,
    columns: {
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    },
    entries: sides.map((side, position) => ({
      index: index * 10 + position + 1,
      launch: side.launch,
      product: side.launch,
      owner: side.owner,
    })),
  };
}
