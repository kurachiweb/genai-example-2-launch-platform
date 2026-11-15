import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { EXPAND_NOTIFICATION_EVENT_MESSAGE } from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { NotificationEventPublisher } from '../../lib/core/notifications/notification-event-contract.ts';
import type { NotificationSettingsExport } from '../../lib/core/notifications/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1NotificationEventExpander } from '../../lib/workers/notifications/d1-notification-event-expander.ts';
import { D1NotificationEventPublisher } from '../../lib/workers/notifications/d1-notification-event-publisher.ts';
import { D1NotificationNoticeStore } from '../../lib/workers/notifications/d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from '../../lib/workers/notifications/d1-notification-preference-store.ts';
import { D1NotificationSettingsExport } from '../../lib/workers/notifications/d1-notification-settings-export.ts';
import { D1NotificationSlotStore } from '../../lib/workers/notifications/d1-notification-slot-store.ts';
import { D1SenderInfoStore } from '../../lib/workers/notifications/d1-sender-info-store.ts';
import { D1UnsubscribeTokenService } from '../../lib/workers/notifications/d1-unsubscribe-token-service.ts';
import { MessageWorkRequester } from '../../lib/workers/notifications/message-work-requester.ts';
import { SentryNotificationIncidentReporter } from '../../lib/workers/notifications/sentry-notification-incident-reporter.ts';
import { awardProductIdOf } from '../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  readEventRows,
  recipientIdOf,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { MODULES } from './modules.ts';

interface RecordingQueue {
  readonly queue: Queue;
  readonly sent: unknown[];
}

const IMPLEMENTATIONS: readonly (readonly [
  symbol,
  abstract new (...args: never[]) => unknown,
])[] = [
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
    D1NotificationPreferenceStore,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
    D1UnsubscribeTokenService,
  ],
  [NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore, D1SenderInfoStore],
  [NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore, D1NotificationSlotStore],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore,
    D1NotificationNoticeStore,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
    D1NotificationEventPublisher,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationEventExpander,
    D1NotificationEventExpander,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester,
    MessageWorkRequester,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport,
    D1NotificationSettingsExport,
  ],
  [
    NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter,
    SentryNotificationIncidentReporter,
  ],
];

const PUBLISHED_AT = new Date('2026-11-19T10:00:00.000Z');

function createRecordingQueue(): RecordingQueue {
  const sent: unknown[] = [];
  const queue: Queue = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createContainer(jobsQueue: Queue = env.JOBS_QUEUE): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await clearNotificationTables();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのモジュールの一覧への通知の登録', () => {
  test('通知の共通の束縛と、それが使うマッチ・プロダクト・フォロー・利用者・メールの共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'notifications-platform',
      'match-platform',
      'product-platform',
      'profile-platform',
      'identity-platform',
      'email-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });
});

describe('APIサーバーの通知の共通の束縛', () => {
  test('処理単位のコンテナから通知の共有の部品を実装のクラスに解決する', () => {
    const container = createContainer();

    for (const [identifier, implementation] of IMPLEMENTATIONS) {
      expect(container.get(identifier)).toBeInstanceOf(implementation);
    }
  });

  test('処理単位のコンテナから発行の口を解決し、受賞の展開の依頼を処理単位のQueueへ送る', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createContainer(queue).get<NotificationEventPublisher>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
    );

    await expect(
      publisher.publish({
        publisher: 'tournament-week',
        events: [
          {
            type: 'award',
            award: 'product_of_the_week',
            period: '2026-W47',
            productId: awardProductIdOf(1),
          },
        ],
        at: PUBLISHED_AT,
      }),
    ).resolves.toEqual({ recorded: 1, duplicates: 0 });

    const rows = await readEventRows();
    expect(sent).toEqual([
      expect.objectContaining<Partial<QueueEnvelope>>({
        type: EXPAND_NOTIFICATION_EVENT_MESSAGE.type,
        body: { eventId: rows[0]?.id },
      }),
    ]);
  });

  test('処理単位のコンテナからデータエクスポートの部品を解決し、利用者の受信設定を引ける', async () => {
    await insertRecipient(1, { emailVerifiedAt: T0 });
    const settingsExport = createContainer().get<NotificationSettingsExport>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport,
    );

    await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
      matchPreview: false,
      matchResult: false,
      followedUserMatch: false,
      followedUserAward: false,
      suppressedReason: null,
    });
  });
});
