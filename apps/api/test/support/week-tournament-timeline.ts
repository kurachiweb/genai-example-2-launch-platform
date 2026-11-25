import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { and, asc, eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { vi } from 'vitest';

import { matchEntries } from '../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../db/schema/match/match-events.ts';
import { matches } from '../../db/schema/match/matches.ts';
import { notificationEvents } from '../../db/schema/notifications/notification-events.ts';
import { notificationSlotReadyMarks } from '../../db/schema/notifications/notification-slot-ready-marks.ts';
import { paymentCustomers } from '../../db/schema/payments/payment-customers.ts';
import { paymentPriceSnapshots } from '../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../db/schema/payments/payment-stripe-objects.ts';
import { bracketMatches } from '../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../db/schema/tournament/bracket-participants.ts';
import { weekTournamentEntries } from '../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../db/schema/tournament/week-tournaments.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { EmailSender } from '../../lib/core/email/ports.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  PaymentReflector,
  ReflectionOutcome,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
} from '../../lib/core/payments/ports.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekProgressionService,
  WeekTournamentStore,
} from '../../lib/core/week-tournament/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearNotificationRows } from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  createRecordingSender,
  insertPurchase,
  type RecordingSender,
  sessionIdOf,
  snapshotOf,
} from '../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import { createFakeStripeGateway } from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
  launchIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { createScheduledDispatcher } from '../../lib/workers/scheduling/scheduled-dispatcher.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekTournamentIdOf,
} from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import { clearYearTournamentRows } from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';

export type ModuleOverride = Pick<AppModule, 'bindings'>;

export interface QueuedMessage {
  readonly envelope: QueueEnvelope;
  readonly delaySeconds: number | undefined;
  // 送信の時点で読んだD1の状態。順序の検証に使う
  readonly snapshot: unknown;
}

export interface JobSummary {
  readonly name: string;
  readonly result: string;
}

export interface Timeline {
  readonly queued: readonly QueuedMessage[];
  readonly emails: RecordingSender;
  // Stripeの照会が一時的に失敗する決済セッションの番号
  readonly stripeUnavailable: Set<number>;
  // 業務日付と業務時刻の定期実行を、実際のジョブの一覧と同じ順で動かす。時計はその予定時刻に合わせる
  run(
    date: string,
    time: BusinessTimeOfDay,
    extra?: readonly ModuleOverride[],
  ): Promise<void>;
  // 定期実行の外の処理(決済の反映・確定のマッチイベントの処理)を動かす処理単位のコンテナ
  container(extra?: readonly ModuleOverride[]): Container;
}

export interface TimelineOptions {
  readonly inspect?: (envelope: QueueEnvelope) => Promise<unknown>;
  // Stripeの決済セッションのメタデータの購入種別(既定はWeekトーナメント参加費)
  readonly purchaseKind?: string;
}

// 組み合わせ決定の月曜日と、その週のトーナメントの1回戦・2回戦の日
export const DRAW_DATE = '2026-11-23';
export const FIRST_ROUND_DATE = '2026-11-24';
export const SECOND_ROUND_DATE = '2026-11-25';

export const RECONCILIATION_TIME: BusinessTimeOfDay = { hour: 23, minute: 40 };
export const EVENING_TIME: BusinessTimeOfDay = { hour: 23, minute: 45 };
export const KICKOFF_TIME: BusinessTimeOfDay = { hour: 0, minute: 0 };

export const OWNER = 1;

const ENTITLED_AT = new Date('2026-11-22T00:00:00.000Z');

export const TIMELINE_JOB_PREFIXES: readonly string[] = [
  'payments.',
  'match-engine.',
  'notifications.',
  'tournament-week.',
];

export function instantOf(
  date: string,
  time: BusinessTimeOfDay,
  seconds = 0,
): Date {
  return new Date(
    fromBusinessDateTime(parseBusinessDate(date), time).getTime() +
      seconds * 1000,
  );
}

// 定期実行以外の処理の時刻を合わせる。時計の偽物はDateだけを差し替える
export function setClock(at: Date): void {
  vi.setSystemTime(at);
}

function sessionOf(
  index: number,
  purchaseKind: string,
): StripeCheckoutSessionSnapshot {
  return snapshotOf(index, {
    metadata: {
      ...snapshotOf(index).metadata,
      purchase_kind: purchaseKind,
    },
  });
}

function stripeGatewayOf(
  unavailable: ReadonlySet<number>,
  purchaseKind: string,
): StripeGateway {
  return createFakeStripeGateway({
    retrieveCheckoutSession: (sessionId) => {
      const index = Number(sessionId.split('_').at(-1));
      return unavailable.has(index)
        ? Promise.reject(new Error('Stripeの一時的な障害'))
        : Promise.resolve(sessionOf(index, purchaseKind));
    },
  });
}

function createRecordingQueue(
  queued: QueuedMessage[],
  inspect: TimelineOptions['inspect'],
): Queue<QueueEnvelope> {
  return {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: async (envelope, options) => {
      queued.push({
        envelope,
        delaySeconds: options?.delaySeconds,
        snapshot: await inspect?.(envelope),
      });
      return {
        metadata: { metrics: { backlogCount: queued.length, backlogBytes: 0 } },
      };
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
}

// Stripeへ通信せず、メールの依頼を記録するため、共通の束縛のうち2つだけを差し替える
function externalServicesOf(
  stripe: StripeGateway,
  emails: RecordingSender,
): ModuleOverride {
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(
        stripe,
      );
      rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
        emails.sender,
      );
    }),
  };
}

export function createTimeline(options: TimelineOptions = {}): Timeline {
  const queued: QueuedMessage[] = [];
  const emails = createRecordingSender();
  const stripeUnavailable = new Set<number>();
  const timelineEnv: Env = {
    ...env,
    JOBS_QUEUE: createRecordingQueue(queued, options.inspect),
  };
  const external = externalServicesOf(
    stripeGatewayOf(
      stripeUnavailable,
      options.purchaseKind ?? 'week_tournament_entry',
    ),
    emails,
  );
  const registry = createCronRegistry(SCHEDULED_JOBS);
  return {
    queued,
    emails,
    stripeUnavailable,
    async run(date, time, extra = []) {
      const scheduledAt = instantOf(date, time);
      setClock(scheduledAt);
      const dispatcher = createScheduledDispatcher<Env>(registry, [
        ...MODULES,
        external,
        ...extra,
      ]);
      const ctx = createExecutionContext();
      await dispatcher.dispatch(
        createScheduledController({
          cron: toUtcCronExpression(time),
          scheduledTime: scheduledAt.getTime(),
        }),
        timelineEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    },
    container(extra = []) {
      return createInvocationContainer(
        {
          env: timelineEnv,
          executionCtx: createExecutionContext(),
          info: {
            kind: 'fetch',
            correlationId: crypto.randomUUID(),
            clientIp: undefined,
          },
        },
        [...MODULES, external, ...extra],
      );
    },
  };
}

// 定期実行の起動ごとに、時刻の連鎖に関わる機能のジョブの結果を実行の順に並べる
export function scheduledRunsOf(
  logs: readonly {
    readonly message: string;
    readonly [key: string]: unknown;
  }[],
  prefixes: readonly string[] = TIMELINE_JOB_PREFIXES,
): JobSummary[][] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .map((summary) =>
      ((summary['jobs'] ?? []) as readonly JobSummary[])
        .filter(({ name }) =>
          prefixes.some((prefix) => name.startsWith(prefix)),
        )
        .map(({ name, result }) => ({ name, result })),
    );
}

// Webhook: 決済セッションの完了の通知から決済セッションを照会して反映する
export function reflectByWebhook(
  container: Container,
  index: number,
): Promise<ReflectionOutcome> {
  return container
    .get<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector)
    .reflect({
      kind: 'checkout_session',
      sessionId: sessionIdOf(index),
      occurredAt: container.get<Clock>(PLATFORM_TYPES.Clock).now(),
    });
}

// eventの確定のマッチイベントの処理と同じく、マッチのブラケットのWeekトーナメントを進めて結果と予告を発行する
export async function progressDecidedWeekMatch(
  container: Container,
  matchId: string,
): Promise<void> {
  const bracket = (
    await container
      .get<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
      .findByMatchIds([matchId])
  ).get(matchId);
  if (bracket?.kind !== 'week') {
    throw new Error(`Weekのブラケットのマッチではありません: ${matchId}`);
  }
  const tournament = await container
    .get<WeekTournamentStore>(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    .findTournament(bracket.tournamentId);
  if (tournament === undefined) {
    throw new Error(`週のトーナメントがありません: ${bracket.tournamentId}`);
  }
  const progression = container.get<WeekProgressionService>(
    WEEK_TOURNAMENT_TYPES.WeekProgressionService,
  );
  const now = container.get<Clock>(PLATFORM_TYPES.Clock).now();
  const result = await progression.advance(tournament.tournamentId, now);
  if (result !== undefined) {
    await progression.applyResult(tournament, result, now);
  }
}

export interface EntrantFixture {
  readonly index: number;
  readonly entitled: boolean;
}

// 投稿者1の同じ番号のプロダクトとローンチで、2026-11-16の週の受付中の週と枠を作る。参加資格を得た枠はUltrasによる
export async function seedWeekEntrants(
  entrants: readonly EntrantFixture[],
): Promise<void> {
  const indexes = entrants.map(({ index }) => index);
  await insertUser(OWNER);
  await insertProducts(indexes, OWNER);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
  await insertWeekTournaments([{ index: 1 }]);
  await insertWeekEntries(
    entrants.map(({ index, entitled }) => ({
      index,
      tournament: 1,
      launch: index,
      product: index,
      owner: OWNER,
      columns: entitled
        ? {
            status: 'entitled',
            entitlementSource: 'ultras',
            entitledAt: ENTITLED_AT,
          }
        : {},
    })),
  );
}

// 受付期限の前に開始した、同じ番号のローンチへの参加費の未完了の購入と決済セッション
export async function insertWeekPurchase(index: number): Promise<void> {
  await insertPurchase(index, {
    kind: 'week_tournament_entry',
    targetId: launchIdOf(index),
    relatedId: launchIdOf(index),
    exclusivityKey: `launch:${launchIdOf(index)}:week`,
    priceLookupKey: 'week_tournament_entry',
    deadlineAt: WEEK_WINDOW.deadlineAt,
    acceptUntil: WEEK_WINDOW.acceptUntil,
    fulfillableUntil: WEEK_WINDOW.drawAt,
  });
}

// マッチの側1に3票、側2に1票を入れた集計にする
export async function castVotes(matchId: string): Promise<void> {
  const [match] = await db
    .select({ startsAt: matches.startsAt })
    .from(matches)
    .where(eq(matches.id, matchId));
  if (match === undefined) {
    throw new Error(`マッチがありません: ${matchId}`);
  }
  for (const [slot, upvoteCount] of [
    [1, 3],
    [2, 1],
  ] as const) {
    await db
      .update(matchEntries)
      .set({
        upvoteCount,
        lastUpvotedAt: new Date(match.startsAt.getTime() + slot * 60_000),
        lastUpvoteSeq: slot,
      })
      .where(
        and(eq(matchEntries.matchId, matchId), eq(matchEntries.slot, slot)),
      );
  }
}

export async function readWeekTournament(index = 1) {
  const [row] = await db
    .select({
      status: weekTournaments.status,
      bracketId: weekTournaments.bracketId,
      outcome: weekTournaments.outcome,
      championEntryId: weekTournaments.championEntryId,
    })
    .from(weekTournaments)
    .where(eq(weekTournaments.id, weekTournamentIdOf(index)));
  return row;
}

export async function readEntryStatuses() {
  return db
    .select({
      id: weekTournamentEntries.id,
      status: weekTournamentEntries.status,
      entitlementSource: weekTournamentEntries.entitlementSource,
      purchaseId: weekTournamentEntries.purchaseId,
    })
    .from(weekTournamentEntries)
    .orderBy(asc(weekTournamentEntries.id));
}

export async function readParticipantRefs(bracketId: string) {
  const rows = await db
    .select({ entryRef: bracketParticipants.entryRef })
    .from(bracketParticipants)
    .where(eq(bracketParticipants.bracketId, bracketId))
    .orderBy(asc(bracketParticipants.entryRef));
  return rows.map(({ entryRef }) => entryRef);
}

// ブラケットの位置と、その位置のマッチの予定・開始・確定
export async function readBracketRounds(bracketId: string) {
  return db
    .select({
      matchId: bracketMatches.matchId,
      round: bracketMatches.round,
      matchDate: bracketMatches.matchDate,
      status: bracketMatches.status,
      kind: matches.kind,
      startedAt: matches.startedAt,
      decidedAt: matches.decidedAt,
    })
    .from(bracketMatches)
    .innerJoin(matches, eq(matches.id, bracketMatches.matchId))
    .where(eq(bracketMatches.bracketId, bracketId))
    .orderBy(asc(bracketMatches.round), asc(bracketMatches.position));
}

export async function readDecidedWeekMatchIds(): Promise<string[]> {
  const rows = await db
    .select({ matchId: matchEvents.matchId })
    .from(matchEvents)
    .where(
      and(eq(matchEvents.type, 'decided'), eq(matchEvents.matchKind, 'week')),
    )
    .orderBy(asc(matchEvents.matchId));
  return rows.map(({ matchId }) => matchId);
}

export interface PublishedEvent {
  readonly type: string;
  readonly subject: string | null;
}

// 記録された通知イベントを、種類と対象(マッチかプロダクト)で並べる
export async function readPublishedEvents(): Promise<PublishedEvent[]> {
  const rows = await db
    .select({
      type: notificationEvents.type,
      matchId: notificationEvents.matchId,
      productId: notificationEvents.productId,
    })
    .from(notificationEvents)
    .orderBy(
      asc(notificationEvents.type),
      asc(notificationEvents.matchId),
      asc(notificationEvents.productId),
    );
  return rows.map(({ type, matchId, productId }) => ({
    type,
    subject: matchId ?? productId,
  }));
}

export async function readReadyParticipants(slotKey: string) {
  const rows = await db
    .select({ participant: notificationSlotReadyMarks.participant })
    .from(notificationSlotReadyMarks)
    .where(eq(notificationSlotReadyMarks.slotKey, slotKey));
  return rows.map(({ participant }) => participant);
}

// paymentsの表は利用者を参照し、Yearの枠は23:45の夜の処理がWeekの優勝から作るため、Weekとマッチ・プロダクト・利用者の行より先に消す
export async function clearTimelineTables(): Promise<void> {
  await clearYearTournamentRows();
  await db.delete(weekTournamentEntries);
  await db.delete(weekTournaments);
  await db.delete(paymentRefunds);
  await db.delete(paymentRecords);
  await db.delete(paymentStripeObjects);
  await db.delete(paymentPriceSnapshots);
  await db.delete(paymentPurchases);
  await db.delete(paymentCustomers);
  await clearNotificationRows();
  await clearWeekTournamentTables();
}
