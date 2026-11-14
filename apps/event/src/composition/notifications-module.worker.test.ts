import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { notificationSenderSettings } from '../../db/schema/notifications/notification-sender-settings.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { SenderInfoProvider } from '../../lib/core/email/ports.ts';
import { LifecycleRegistrationError } from '../../lib/core/identity/user-lifecycle.ts';
import {
  createResultNoticeSupplementRegistry,
  type ResultNoticeSupplement,
  type ResultNoticeSupplementInput,
  type ResultNoticeSupplementProvider,
  type ResultNoticeSupplementRegistration,
} from '../../lib/core/notifications/result-notice-supplements.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  db,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import { ExpandEventHandler } from '../application/notifications/expand-event-handler.ts';
import { FlushSlotHandler } from '../application/notifications/flush-slot-handler.ts';
import { OneClickUnsubscribe } from '../application/notifications/one-click-unsubscribe.ts';
import type { SupplementSource } from '../application/notifications/ports.ts';
import { D1SenderInfoProvider } from '../infrastructure/notifications/d1-sender-info-provider.ts';
import { EveningCollector } from '../infrastructure/notifications/evening-collector.ts';
import { EmailGroupDispatcher } from '../infrastructure/notifications/group-dispatcher.ts';
import { MorningCollector } from '../infrastructure/notifications/morning-collector.ts';
import { RegisteredSupplementSource } from '../infrastructure/notifications/registered-supplement-source.ts';
import { EMAIL_SENDER_INFO_PROVIDER } from './email-registrations.ts';
import { MODULES } from './modules.ts';
import {
  createEventNotificationsModule,
  EVENT_NOTIFICATIONS_MODULE,
} from './notifications-module.ts';
import { RESULT_NOTICE_SUPPLEMENTS } from './result-notice-supplements.ts';

const SENDER_INFO = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
} as const;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

const IMPLEMENTATIONS = [
  ['EveningCollector', EveningCollector],
  ['MorningCollector', MorningCollector],
  ['SupplementSource', RegisteredSupplementSource],
  ['GroupDispatcher', EmailGroupDispatcher],
  ['FlushSlotHandler', FlushSlotHandler],
  ['ExpandEventHandler', ExpandEventHandler],
  ['OneClickUnsubscribe', OneClickUnsubscribe],
] as const;

const FAKE_PROVIDER = Symbol.for('test.FakeResultNoticeSupplementProvider');

const FAKE_SUPPLEMENT: ResultNoticeSupplement = {
  title: 'Weekトーナメントの参加費',
  lines: ['支払いの期限は11月22日07:40(UTC)です。'],
  emphasized: true,
};

const FAKE_REGISTRATION: ResultNoticeSupplementRegistration = {
  name: 'supplement-test.entry-deadline',
  kinds: ['qualifier'],
  order: 100,
  provider: FAKE_PROVIDER,
};

const QUALIFIER_RESULT: ResultNoticeSupplementInput = {
  matchId: 'match-1',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: parseBusinessDate('2026-11-20'),
  entryId: 'entry-1',
  launchId: 'launch-1',
  productId: 'product-1',
  ownerUserId: 'user-1',
  result: 'won',
  decidedAt: new Date('2026-11-21T06:00:00.000Z'),
};

function createContainer(
  kind: (typeof INVOCATION_KINDS)[number],
  modules: typeof MODULES = MODULES,
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    modules,
  );
}

// eventの通知のモジュールだけをテスト用の追記の登録で組み立て直し、提供元の束縛を加えた一覧にする
function modulesWithFakeSupplement(
  calls: ResultNoticeSupplementInput[],
): typeof MODULES {
  const provider: ResultNoticeSupplementProvider = {
    supplementFor: (input) => {
      calls.push(input);
      return Promise.resolve(FAKE_SUPPLEMENT);
    },
  };
  return [
    ...MODULES.map((module) =>
      module === EVENT_NOTIFICATIONS_MODULE
        ? createEventNotificationsModule({
            resultNoticeSupplements: [FAKE_REGISTRATION],
          })
        : module,
    ),
    {
      name: 'fake-result-notice-supplements',
      bindings: new ContainerModule(({ bind }) => {
        bind<ResultNoticeSupplementProvider>(FAKE_PROVIDER).toConstantValue(
          provider,
        );
      }),
    },
  ];
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await restoreSenderInfoSeed();
});

describe('イベントサーバーのモジュールの一覧への通知のモジュールの登録', () => {
  test('通知のモジュールを1つだけ持ち、通知の共通の束縛の後に置く', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'event-notifications')).toHaveLength(
      1,
    );
    expect(names.indexOf('event-notifications')).toBeGreaterThan(
      names.indexOf('notifications-platform'),
    );
  });

  test('メールの送信者情報の取得口の登録箇所は、通知の送信者情報の実装を指す', () => {
    expect(EMAIL_SENDER_INFO_PROVIDER).toBe(D1SenderInfoProvider);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのメールの送信者情報の取得口(%s)',
  (kind) => {
    test('処理単位のコンテナから通知の送信者情報の実装に解決する', () => {
      expect(
        createContainer(kind).get(EMAIL_TYPES.SenderInfoProvider),
      ).toBeInstanceOf(D1SenderInfoProvider);
    });

    test('送信者情報が版0ならundefinedを、設定済みなら3項目を返す', async () => {
      const provider = createContainer(kind).get<SenderInfoProvider>(
        EMAIL_TYPES.SenderInfoProvider,
      );
      await expect(provider.get()).resolves.toBeUndefined();

      await db
        .update(notificationSenderSettings)
        .set({ ...SENDER_INFO, version: 1, updatedAt: after(1) })
        .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));

      await expect(provider.get()).resolves.toStrictEqual(SENDER_INFO);
    });
  },
);

describe('イベントサーバーの通知の識別子の解決', () => {
  test('解決を確かめる識別子はEVENT_NOTIFICATIONS_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(EVENT_NOTIFICATIONS_TYPES).toSorted(),
    );
  });

  describe.each(INVOCATION_KINDS)('%sの処理単位のコンテナ', (kind) => {
    test.each(IMPLEMENTATIONS)('%sを解決する', (name, implementation) => {
      expect(
        createContainer(kind).get(EVENT_NOTIFICATIONS_TYPES[name]),
      ).toBeInstanceOf(implementation);
    });
  });
});

describe('結果の追記の登録口', () => {
  test('初版の登録口は空の凍結済みの配列で、登録の検証を通る', () => {
    expect(RESULT_NOTICE_SUPPLEMENTS).toStrictEqual([]);
    expect(Object.isFrozen(RESULT_NOTICE_SUPPLEMENTS)).toBe(true);
    expect(() =>
      createResultNoticeSupplementRegistry(RESULT_NOTICE_SUPPLEMENTS),
    ).not.toThrow();
  });

  test('同じ種別でorderが重複した登録は、最初のメッセージではなくモジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventNotificationsModule({
        resultNoticeSupplements: [
          FAKE_REGISTRATION,
          {
            ...FAKE_REGISTRATION,
            name: 'supplement-test.exemption',
            kinds: ['qualifier', 'week'],
          },
        ],
      }),
    ).toThrow(LifecycleRegistrationError);
  });

  test('<spec名>.<名詞句>の形でない名前の登録は、モジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventNotificationsModule({
        resultNoticeSupplements: [
          { ...FAKE_REGISTRATION, name: 'entry-deadline' },
        ],
      }),
    ).toThrow(LifecycleRegistrationError);
  });

  describe.each(INVOCATION_KINDS)('%sの処理単位のコンテナ', (kind) => {
    test('初版の登録口では、結果の通知に追記を返さない', async () => {
      const source = createContainer(kind).get<SupplementSource>(
        EVENT_NOTIFICATIONS_TYPES.SupplementSource,
      );

      const supplements = await source.supplementsFor([
        { noticeId: 'notice-1', input: QUALIFIER_RESULT },
      ]);

      expect(supplements.size).toBe(0);
    });

    test('登録口に1件を足すと、処理単位のコンテナから提供元を解決して追記を返す', async () => {
      const calls: ResultNoticeSupplementInput[] = [];
      const source = createContainer(
        kind,
        modulesWithFakeSupplement(calls),
      ).get<SupplementSource>(EVENT_NOTIFICATIONS_TYPES.SupplementSource);

      const supplements = await source.supplementsFor([
        { noticeId: 'notice-1', input: QUALIFIER_RESULT },
        {
          noticeId: 'notice-2',
          input: { ...QUALIFIER_RESULT, matchId: 'match-2', kind: 'week' },
        },
      ]);

      expect(supplements).toStrictEqual(
        new Map([['notice-1', [FAKE_SUPPLEMENT]]]),
      );
      expect(calls).toStrictEqual([QUALIFIER_RESULT]);
    });
  });
});
