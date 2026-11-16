import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { and, eq } from 'drizzle-orm';

import type { NotificationTopic } from '../../../../common-lib/notifications/notification-topics.ts';
import { emailAlertThrottles } from '../../../../db/schema/email/email-alert-throttles.ts';
import { emailSuppressions } from '../../../../db/schema/email/email-suppressions.ts';
import { notificationPreferences } from '../../../../db/schema/notifications/notification-preferences.ts';
import { notificationSenderSettings } from '../../../../db/schema/notifications/notification-sender-settings.ts';
import { createKeyedHasher } from '../../../../lib/core/crypto/keyed-hasher.ts';
import type {
  EmailSender,
  EmailSendRequest,
} from '../../../../lib/core/email/ports.ts';
import {
  type EntryResult,
  qualifierWindow,
} from '../../../../lib/core/match/match-model.ts';
import type { NoticeDraft } from '../../../../lib/core/notifications/notice-plan.ts';
import {
  eveningSlot,
  type NotificationSlot,
} from '../../../../lib/core/notifications/notification-slots.ts';
import type { NotificationIncident } from '../../../../lib/core/notifications/ports.ts';
import type {
  ResultNoticeSupplement,
  ResultNoticeSupplementInput,
} from '../../../../lib/core/notifications/result-notice-supplements.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import { createAlertThrottleRepository } from '../../../../lib/workers/email/alert-throttle-repository.ts';
import { createSuppressionRepository } from '../../../../lib/workers/email/suppression-repository.ts';
import { D1UserContactDirectory } from '../../../../lib/workers/identity/d1-user-contact-directory.ts';
import {
  createSequentialIds,
  emailOf,
} from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../../../../lib/workers/match/d1-match-directory.ts';
import {
  DECIDED_AT,
  STARTS_AT,
} from '../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  clearMatchTables,
  entryIdOf,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../../lib/workers/match/testing/match-fixtures.ts';
import { D1NotificationNoticeStore } from '../../../../lib/workers/notifications/d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from '../../../../lib/workers/notifications/d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from '../../../../lib/workers/notifications/d1-notification-slot-store.ts';
import { D1SenderInfoStore } from '../../../../lib/workers/notifications/d1-sender-info-store.ts';
import { D1UnsubscribeTokenService } from '../../../../lib/workers/notifications/d1-unsubscribe-token-service.ts';
import { SentryNotificationIncidentReporter } from '../../../../lib/workers/notifications/sentry-notification-incident-reporter.ts';
import {
  clearFollows,
  MATCH_DAY,
} from '../../../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  clearNotificationRows,
  db,
  insertRecipient,
  recipientIdOf,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
  T0,
} from '../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { D1ProductDirectory } from '../../../../lib/workers/product/d1-product-directory.ts';
import {
  insertProduct,
  productIdOf,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';
import { D1UserProfileDirectory } from '../../../../lib/workers/profile/d1-user-profile-directory.ts';
import type { SupplementSource } from '../../../application/notifications/ports.ts';
import {
  EmailGroupDispatcher,
  type EmailGroupDispatcherDependencies,
} from '../group-dispatcher.ts';

export const CLIENT_ORIGIN = 'https://client.test.example';
export const EVENT_ORIGIN = 'https://event.test.example';

const PEPPER = '0123456789abcdef0123456789abcdef';

export const SENDER_INFO = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
} as const;

export function emailRequestIdOf(index: number): string {
  return `01JC0EMA11${String(index).padStart(16, '0')}`;
}

export interface RecordingSender extends EmailSender {
  readonly sent: EmailSendRequest<unknown>[];
}

// 実際の送信要求と同じく入力をメール種別の検証規則で確かめ、rejectが返した例外で送信の依頼を失敗させる
export function createRecordingSender(
  reject: (request: EmailSendRequest<unknown>) => Error | undefined = () =>
    undefined,
): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  return {
    sent,
    send: <TInput>(request: EmailSendRequest<TInput>) => {
      const failure = reject(request);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      request.kind.inputSchema.parse(request.input);
      sent.push(request);
      return Promise.resolve(emailRequestIdOf(sent.length));
    },
  };
}

export interface RecordingSupplementSource extends SupplementSource {
  readonly requests: {
    readonly noticeId: string;
    readonly input: ResultNoticeSupplementInput;
  }[][];
}

// マッチのIDごとに決めた追記を返す
export function createRecordingSupplementSource(
  byMatchId: ReadonlyMap<string, readonly ResultNoticeSupplement[]> = new Map(),
): RecordingSupplementSource {
  const requests: RecordingSupplementSource['requests'] = [];
  return {
    requests,
    supplementsFor: (batch) => {
      requests.push([...batch]);
      return Promise.resolve(
        new Map(
          batch.flatMap(({ noticeId, input }) => {
            const supplements = byMatchId.get(input.matchId);
            return supplements === undefined ? [] : [[noticeId, supplements]];
          }),
        ),
      );
    },
  };
}

export interface DispatcherHarness {
  readonly dispatcher: EmailGroupDispatcher;
  readonly sender: RecordingSender;
  readonly supplements: RecordingSupplementSource;
  readonly incidents: NotificationIncident[];
  readonly dependencies: EmailGroupDispatcherDependencies;
}

export function createDispatcherHarness(
  options: {
    readonly sender?: RecordingSender;
    readonly supplements?: RecordingSupplementSource;
    readonly overrides?: Partial<EmailGroupDispatcherDependencies>;
    readonly clock?: Clock;
  } = {},
): DispatcherHarness {
  const sender = options.sender ?? createRecordingSender();
  const supplements = options.supplements ?? createRecordingSupplementSource();
  const incidents: NotificationIncident[] = [];
  const reporter = new SentryNotificationIncidentReporter('event');
  const slots = new D1NotificationSlotStore(db, createSequentialIds(8000));
  const dependencies: EmailGroupDispatcherDependencies = {
    db,
    notices: new D1NotificationNoticeStore(
      db,
      createSequentialIds(5000),
      slots,
    ),
    preferences: new D1NotificationPreferenceStore(db),
    senderInfo: new D1SenderInfoStore(db),
    tokens: new D1UnsubscribeTokenService(
      db,
      createKeyedHasher(PEPPER),
      createSequentialIds(9000),
    ),
    incidents: {
      report: (incident) => {
        incidents.push(incident);
        reporter.report(incident);
      },
    },
    alertThrottle: createAlertThrottleRepository(db),
    contacts: new D1UserContactDirectory(db),
    suppressions: createSuppressionRepository(
      db,
      options.clock ?? { now: () => new Date() },
    ),
    emails: sender,
    matches: new D1MatchDirectory(db),
    products: new D1ProductDirectory(db),
    profiles: new D1UserProfileDirectory(db),
    supplements,
    origins: { client: CLIENT_ORIGIN, event: EVENT_ORIGIN },
    ...options.overrides,
  };
  return {
    dispatcher: new EmailGroupDispatcher(dependencies),
    sender,
    supplements,
    incidents,
    dependencies,
  };
}

export async function resetDispatchTables(): Promise<void> {
  await clearFollows();
  await clearNotificationRows();
  await clearMatchTables();
  await db.delete(emailSuppressions);
  await db.delete(emailAlertThrottles);
  await restoreSenderInfoSeed();
}

export async function setSenderInfo(): Promise<void> {
  await db
    .update(notificationSenderSettings)
    .set({ ...SENDER_INFO, version: 1, updatedAt: T0 })
    .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));
}

// メールアドレスを確認済みの利用者と、同じ番号の利用者のプロダクトを作り、指定した種別を受信する設定にする
export async function seedRecipient(
  index: number,
  topics: readonly NotificationTopic[],
  columns: Parameters<typeof insertRecipient>[1] = {},
): Promise<void> {
  await insertRecipient(index, { emailVerifiedAt: T0, ...columns });
  await insertProduct(index, index, { userId: recipientIdOf(index) });
  if (topics.length > 0) {
    await db.insert(notificationPreferences).values(
      topics.map((topic) => ({
        userId: recipientIdOf(index),
        topic,
        enabled: true,
        createdAt: T0,
        updatedAt: T0,
      })),
    );
  }
}

export async function disableTopic(
  index: number,
  topic: NotificationTopic,
): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({ enabled: false })
    .where(
      and(
        eq(notificationPreferences.userId, recipientIdOf(index)),
        eq(notificationPreferences.topic, topic),
      ),
    );
}

export interface RecipientSide {
  readonly owner: number;
  readonly result?: EntryResult;
  readonly upvoteCount?: number;
}

// 側の番号の順に、同じ番号の受信者のプロダクトを出すマッチ
export function recipientMatch(
  index: number,
  sides: readonly RecipientSide[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns,
    entries: sides.map(({ owner, result, upvoteCount }, position) => ({
      index: index * 10 + position + 1,
      launch: null,
      product: owner,
      owner: null,
      columns: {
        ownerUserId: recipientIdOf(owner),
        ...(result === undefined ? {} : { result }),
        ...(upvoteCount === undefined ? {} : { upvoteCount }),
      },
    })),
  };
}

export function captureLogs(): {
  readonly records: LogRecord[];
  readonly stop: () => void;
} {
  const records: LogRecord[] = [];
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
  return { records, stop: resetSync };
}

export const NEXT_DAY = parseBusinessDate('2026-11-21');
export const NEXT_DAY_WINDOW = qualifierWindow(NEXT_DAY);
export const EVENING = eveningSlot(MATCH_DAY);
export const EVENING_NOW = fromBusinessDateTime(MATCH_DAY, {
  hour: 23,
  minute: 46,
});

export const DECIDED = {
  startedAt: STARTS_AT,
  decidedAt: DECIDED_AT,
  decision: 'votes',
} as const;

export const NEXT_DAY_WEEK_ROUND_1 = {
  kind: 'week',
  round: 1,
  matchDate: NEXT_DAY,
  startsAt: NEXT_DAY_WINDOW.startsAt,
  endsAt: NEXT_DAY_WINDOW.endsAt,
} as const;

export interface DraftTarget {
  readonly match?: number;
  readonly entry?: number;
  readonly product: number;
  readonly eventId?: string;
}

export function noticeDraft(
  topic: NotificationTopic,
  recipient: number,
  slot: NotificationSlot,
  target: DraftTarget,
): NoticeDraft {
  return {
    topic,
    recipientUserId: recipientIdOf(recipient),
    slot,
    matchId: target.match === undefined ? null : matchIdOf(target.match),
    entryId: target.entry === undefined ? null : entryIdOf(target.entry),
    productId: productIdOf(target.product),
    eventId: target.eventId ?? null,
  };
}

// 受信者1(勝敗結果と予告)・2(勝敗結果だけ)・3(予告だけ)と、当日の確定した予選1(1が2に勝利)・翌日のWeekの1回戦2(1と3)
export async function seedEveningMatches(): Promise<void> {
  await seedRecipient(1, ['match_result', 'match_preview']);
  await seedRecipient(2, ['match_result']);
  await seedRecipient(3, ['match_preview']);
  await insertMatches([
    recipientMatch(
      1,
      [
        { owner: 1, result: 'won', upvoteCount: 12 },
        { owner: 2, result: 'lost', upvoteCount: 9 },
      ],
      DECIDED,
    ),
    recipientMatch(2, [{ owner: 1 }, { owner: 3 }], NEXT_DAY_WEEK_ROUND_1),
  ]);
}

// 受信者1の統合できる結果と予告、2の結果、3の予告(まとめのキーは受信者の番号の順)
export function eveningDrafts(): readonly NoticeDraft[] {
  return [
    noticeDraft('match_result', 1, EVENING, {
      match: 1,
      entry: 11,
      product: 1,
    }),
    noticeDraft('match_preview', 1, EVENING, {
      match: 2,
      entry: 21,
      product: 1,
    }),
    noticeDraft('match_result', 2, EVENING, {
      match: 1,
      entry: 12,
      product: 2,
    }),
    noticeDraft('match_preview', 3, EVENING, {
      match: 2,
      entry: 22,
      product: 3,
    }),
  ];
}

export { emailOf, recipientIdOf };
