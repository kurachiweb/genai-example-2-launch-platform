import { asc } from 'drizzle-orm';

import type { NotificationTopic } from '../../../../common-lib/notifications/notification-topics.ts';
import { notificationNotices } from '../../../../db/schema/notifications/notification-notices.ts';
import { notificationPreferences } from '../../../../db/schema/notifications/notification-preferences.ts';
import { notificationUnsubscribeTokens } from '../../../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import { unsubscribeTokenKey } from '../../../../lib/core/notifications/notice-email.ts';
import type {
  UnsubscribeTarget,
  UnsubscribeTokenService,
} from '../../../../lib/core/notifications/ports.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  recipientIdOf,
  T0,
} from '../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';

export const WITHDRAWING = 1;
export const OTHER = 2;

const TOPICS: readonly NotificationTopic[] = ['match_result', 'match_preview'];

type NoticeRow = typeof notificationNotices.$inferInsert;

export const EARLIER_SETTLED_AT = new Date(T0.getTime() + 1_000);

export function noticeIdOf(index: number): string {
  return `01JC0NOTCE${String(index).padStart(16, '0')}`;
}

function noticeOf(
  index: number,
  recipient: number,
  settlement: Pick<NoticeRow, 'status' | 'skipReason' | 'emailRequestId'>,
): NoticeRow {
  return {
    id: noticeIdOf(index),
    dedupeKey: `dedupe-${String(index)}`,
    slotKey: 'evening:2026-11-01',
    groupKey: `group-${String(index)}`,
    topic: 'match_result',
    recipientUserId: recipientIdOf(recipient),
    settledAt: settlement.status === 'pending' ? null : EARLIER_SETTLED_AT,
    createdAt: T0,
    updatedAt: T0,
    ...settlement,
  };
}

const PENDING = {
  status: 'pending',
  skipReason: null,
  emailRequestId: null,
} as const;

// 退会する利用者は未送信の通知を2件と確定済みの通知を2件、他の利用者は未送信の通知を1件持つ
const NOTICES: readonly NoticeRow[] = [
  noticeOf(1, WITHDRAWING, PENDING),
  noticeOf(2, WITHDRAWING, PENDING),
  noticeOf(3, WITHDRAWING, {
    status: 'sent',
    skipReason: null,
    emailRequestId: 'email-request-3',
  }),
  noticeOf(4, WITHDRAWING, {
    status: 'skipped',
    skipReason: 'topic_disabled',
    emailRequestId: null,
  }),
  noticeOf(5, OTHER, PENDING),
];

export interface WithdrawalScenario {
  // キーは'<userId>:<topic>'
  readonly tokens: ReadonlyMap<string, string>;
}

export function tokenOf(
  scenario: WithdrawalScenario,
  recipient: number,
  topic: NotificationTopic,
): string {
  const token = scenario.tokens.get(
    unsubscribeTokenKey({ userId: recipientIdOf(recipient), topic }),
  );
  if (token === undefined) {
    throw new Error('トークンが発行されていません');
  }
  return token;
}

// 2人の利用者が受信設定・トークンの種・通知を持つ状態を作る。トークンは照合に使うサービスで発行する
export async function seedWithdrawalScenario(
  tokens: UnsubscribeTokenService,
): Promise<WithdrawalScenario> {
  await clearNotificationTables();
  await insertRecipient(WITHDRAWING);
  await insertRecipient(OTHER);
  const targets: UnsubscribeTarget[] = [WITHDRAWING, OTHER].flatMap(
    (recipient) =>
      TOPICS.map((topic) => ({ userId: recipientIdOf(recipient), topic })),
  );
  await db.insert(notificationPreferences).values(
    targets.map((target, index) => ({
      ...target,
      enabled: index % 2 === 0,
      createdAt: T0,
      updatedAt: T0,
    })),
  );
  await db.insert(notificationNotices).values([...NOTICES]);
  return { tokens: await tokens.tokensFor(targets, T0) };
}

export async function readWithdrawalState() {
  const [tokens, preferences, notices] = await Promise.all([
    db
      .select({
        userId: notificationUnsubscribeTokens.userId,
        topic: notificationUnsubscribeTokens.topic,
      })
      .from(notificationUnsubscribeTokens)
      .orderBy(
        asc(notificationUnsubscribeTokens.userId),
        asc(notificationUnsubscribeTokens.topic),
      ),
    db
      .select({
        userId: notificationPreferences.userId,
        topic: notificationPreferences.topic,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .orderBy(
        asc(notificationPreferences.userId),
        asc(notificationPreferences.topic),
      ),
    db
      .select({
        id: notificationNotices.id,
        status: notificationNotices.status,
        skipReason: notificationNotices.skipReason,
        emailRequestId: notificationNotices.emailRequestId,
        settledAt: notificationNotices.settledAt,
        updatedAt: notificationNotices.updatedAt,
      })
      .from(notificationNotices)
      .orderBy(asc(notificationNotices.id)),
  ]);
  return { tokens, preferences, notices };
}

function ownedRowsOf(recipients: readonly number[]) {
  return recipients
    .flatMap((recipient) =>
      TOPICS.map((topic, index) => ({
        userId: recipientIdOf(recipient),
        topic,
        enabled: index % 2 === 0,
      })),
    )
    .toSorted((left, right) =>
      `${left.userId}:${left.topic}`.localeCompare(
        `${right.userId}:${right.topic}`,
      ),
    );
}

// 何も変わっていない状態
export function untouchedState() {
  return {
    tokens: ownedRowsOf([WITHDRAWING, OTHER]).map(({ userId, topic }) => ({
      userId,
      topic,
    })),
    preferences: ownedRowsOf([WITHDRAWING, OTHER]),
    notices: NOTICES.map(
      ({ id, status, skipReason, emailRequestId, settledAt, updatedAt }) => ({
        id,
        status,
        skipReason,
        emailRequestId,
        settledAt,
        updatedAt,
      }),
    ),
  };
}

// 退会を at に確定した後の状態
export function withdrawnState(at: Date) {
  const untouched = untouchedState();
  return {
    tokens: ownedRowsOf([OTHER]).map(({ userId, topic }) => ({
      userId,
      topic,
    })),
    preferences: ownedRowsOf([OTHER]),
    notices: untouched.notices.map((notice) =>
      notice.id === noticeIdOf(1) || notice.id === noticeIdOf(2)
        ? {
            ...notice,
            status: 'skipped',
            skipReason: 'recipient_withdrawn',
            settledAt: at,
            updatedAt: at,
          }
        : notice,
    ),
  };
}
