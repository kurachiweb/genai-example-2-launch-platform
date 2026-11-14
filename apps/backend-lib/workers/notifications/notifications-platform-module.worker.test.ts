import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { EXPAND_NOTIFICATION_EVENT_MESSAGE } from '../../core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import type { NotificationEventPublisher } from '../../core/notifications/notification-event-contract.ts';
import type {
  NotificationIncidentReporter,
  NotificationSettingsExport,
} from '../../core/notifications/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../logging/configure-logging.ts';
import { createMatchPlatformModule } from '../match/match-platform-module.ts';
import { PRODUCT_PLATFORM_MODULE } from '../product/product-platform-module.ts';
import { PROFILE_PLATFORM_MODULE } from '../profile/profile-platform-module.ts';
import { D1NotificationEventExpander } from './d1-notification-event-expander.ts';
import { D1NotificationEventPublisher } from './d1-notification-event-publisher.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSettingsExport } from './d1-notification-settings-export.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import { D1SenderInfoStore } from './d1-sender-info-store.ts';
import { D1UnsubscribeTokenService } from './d1-unsubscribe-token-service.ts';
import { MessageWorkRequester } from './message-work-requester.ts';
import { createNotificationsPlatformModule } from './notifications-platform-module.ts';
import { SentryNotificationIncidentReporter } from './sentry-notification-incident-reporter.ts';
import { awardProductIdOf } from './testing/notification-event-fixtures.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  readEventRows,
  recipientIdOf,
  T0,
} from './testing/notification-store-fixtures.ts';

interface RecordingQueue {
  readonly queue: Queue;
  readonly sent: unknown[];
}

interface LoggedObject {
  readonly category: string;
  readonly message: string;
}

type SharedIdentifierName = Exclude<
  keyof typeof NOTIFICATIONS_PLATFORM_TYPES,
  'EveningDispatchGate' | 'EveningSlotOpener' | 'EveningDispatchParticipants'
>;

// 送り出しの入口と前提の一覧はapiの通知のモジュールだけが束縛するため、共通の束縛には含めない
const API_ONLY_IDENTIFIERS = [
  NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate,
  NOTIFICATIONS_PLATFORM_TYPES.EveningSlotOpener,
  NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchParticipants,
];

const IMPLEMENTATIONS: readonly (readonly [
  SharedIdentifierName,
  abstract new (...args: never[]) => unknown,
])[] = [
  ['NotificationPreferenceStore', D1NotificationPreferenceStore],
  ['UnsubscribeTokenService', D1UnsubscribeTokenService],
  ['SenderInfoStore', D1SenderInfoStore],
  ['NotificationSlotStore', D1NotificationSlotStore],
  ['NotificationNoticeStore', D1NotificationNoticeStore],
  ['NotificationEventPublisher', D1NotificationEventPublisher],
  ['NotificationEventExpander', D1NotificationEventExpander],
  ['NotificationWorkRequester', MessageWorkRequester],
  ['NotificationSettingsExport', D1NotificationSettingsExport],
  ['NotificationIncidentReporter', SentryNotificationIncidentReporter],
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

// 通知の部品が使うマッチ・プロダクト・フォロー・利用者・メールの共通の束縛と同じ処理単位に組む
function createContainer({
  kind = 'fetch',
  appName = 'api',
  jobsQueue = env.JOBS_QUEUE,
}: {
  readonly kind?: InvocationScopeInfo['kind'];
  readonly appName?: LoggingOptions['appName'];
  readonly jobsQueue?: Queue;
} = {}): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      createNotificationsPlatformModule(appName),
      createMatchPlatformModule(appName),
      PRODUCT_PLATFORM_MODULE,
      PROFILE_PLATFORM_MODULE,
      IDENTITY_PLATFORM_MODULE,
      EMAIL_PLATFORM_MODULE,
    ],
  );
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await clearNotificationTables();
});

afterAll(() => {
  resetSync();
});

describe('createNotificationsPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const module = createNotificationsPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('notifications-platform');
    expect('routes' in module).toBe(false);
  });

  test('解決を確かめる識別子は、apiだけが束縛する3つを除いたNOTIFICATIONS_PLATFORM_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(NOTIFICATIONS_PLATFORM_TYPES)
        .filter(
          (name) =>
            !API_ONLY_IDENTIFIERS.includes(
              NOTIFICATIONS_PLATFORM_TYPES[
                name as keyof typeof NOTIFICATIONS_PLATFORM_TYPES
              ],
            ),
        )
        .toSorted(),
    );
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した10の識別子を実装のクラスに解決し、apiだけが束縛する3つは束縛しない',
    (kind) => {
      const container = createContainer({ kind });

      for (const [name, implementation] of IMPLEMENTATIONS) {
        expect(
          container.get(NOTIFICATIONS_PLATFORM_TYPES[name]),
        ).toBeInstanceOf(implementation);
      }
      for (const identifier of API_ONLY_IDENTIFIERS) {
        expect(container.isBound(identifier)).toBe(false);
      }
    },
  );

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const [name] of IMPLEMENTATIONS) {
      const identifier = NOTIFICATIONS_PLATFORM_TYPES[name];
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });

  test('発行の口は受賞の通知イベントを記録し、展開の依頼を処理単位のQueueへ送る', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createContainer({
      jobsQueue: queue,
    }).get<NotificationEventPublisher>(
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
    expect(rows).toHaveLength(1);
    expect(sent).toEqual([
      expect.objectContaining<Partial<QueueEnvelope>>({
        type: EXPAND_NOTIFICATION_EVENT_MESSAGE.type,
        body: { eventId: rows[0]?.id },
      }),
    ]);
  });

  test('データエクスポートの部品は、受信設定と抑止の理由を利用者ごとに返す', async () => {
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
    await expect(
      settingsExport.find(recipientIdOf(2)),
    ).resolves.toBeUndefined();
  });

  test('異常の通知のログのカテゴリは、モジュールに渡したアプリの名前で始まる', () => {
    const logs: LoggedObject[] = [];
    const record = (logged: unknown) => {
      logs.push(logged as LoggedObject);
    };
    ensureLoggingConfigured({
      appName: 'event',
      level: 'debug',
      console: {
        debug: record,
        info: record,
        warn: record,
        error: record,
      } as unknown as Console,
    });
    const reporter = createContainer({
      appName: 'event',
    }).get<NotificationIncidentReporter>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter,
    );

    reporter.report({ kind: 'sender-info-missing', skipped: 1 });

    expect(logs.map((log) => log.category)).toEqual([
      'event.application.notifications',
    ]);
  });
});
