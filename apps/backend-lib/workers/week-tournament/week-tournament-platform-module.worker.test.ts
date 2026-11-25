import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { type Container, ContainerModule } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import { formatWeekPeriodLabel } from '../../../common-lib/tournament/week-period.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import { TOURNAMENT_WEEK_ENTRY_REFUND_KIND } from '../../core/email/kinds/tournament-week.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
} from '../../core/payments/purchase-kind-contract.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../core/week-tournament/identifiers.ts';
import type {
  WeekEntryFollowUp,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { createMatchPlatformModule } from '../match/match-platform-module.ts';
import { createNotificationsPlatformModule } from '../notifications/notifications-platform-module.ts';
import type { PurchaseKindRegistration } from '../payments/fulfillment-contract.ts';
import { createPaymentsPlatformModule } from '../payments/payments-platform-module.ts';
import {
  createRecordingSender,
  type RecordingSender,
} from '../payments/testing/checkout-reflection-harness.ts';
import { PRODUCT_PLATFORM_MODULE } from '../product/product-platform-module.ts';
import {
  insertLaunch,
  insertProduct,
  insertUser,
} from '../product/testing/product-fixtures.ts';
import { createTournamentPlatformModule } from '../tournament/tournament-platform-module.ts';
import { createUltrasPlatformModule } from '../ultras/ultras-platform-module.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_START,
  weekEntryIdOf,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';
import { WEEK_TOURNAMENT_IMPLEMENTATIONS } from './testing/week-tournament-platform-implementations.ts';
import { WeekEntryFulfillment } from './week-entry-fulfillment.ts';
import { WeekEntryOfferPolicy } from './week-entry-offer-policy.ts';
import { createWeekTournamentPlatformModule } from './week-tournament-platform-module.ts';
import { WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION } from './week-tournament-registrations.ts';

const PAYMENTS_ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'true',
  CLIENT_SITE_ORIGIN: env.CLIENT_SITE_ORIGIN,
};

const NOW = new Date('2026-11-25T12:21:00.000Z');

const OWNER = 1;

// 返金の知らせのメールの依頼を記録するため、メールの送信だけを差し替える
function emailOverrideOf(emails: RecordingSender): Pick<AppModule, 'bindings'> {
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
        emails.sender,
      );
    }),
  };
}

function createContainer(
  options: {
    readonly kind?: InvocationScopeInfo['kind'];
    readonly appName?: LoggingOptions['appName'];
    readonly emails?: RecordingSender;
  } = {},
): Container {
  const appName = options.appName ?? 'api';
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: options.kind ?? 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      EMAIL_PLATFORM_MODULE,
      IDENTITY_PLATFORM_MODULE,
      PRODUCT_PLATFORM_MODULE,
      createMatchPlatformModule(appName),
      createTournamentPlatformModule(appName),
      createNotificationsPlatformModule(appName),
      createPaymentsPlatformModule(appName),
      createUltrasPlatformModule(appName),
      createWeekTournamentPlatformModule(appName),
      ...(options.emails === undefined
        ? []
        : [emailOverrideOf(options.emails)]),
    ],
  );
}

beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(OWNER);
  await insertProduct(1, OWNER);
  await insertLaunch(1, 1, { launchDate: '2026-11-20' });
  await insertWeekTournaments([{ index: 1 }]);
});

afterAll(() => {
  resetSync();
});

describe('createWeekTournamentPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられ、経路を持たない', () => {
    const module = createWeekTournamentPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
      createWeekTournamentPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('week-tournament-platform');
    expect('routes' in module).toBe(false);
  });

  test('解決を確かめる識別子はWEEK_TOURNAMENT_TYPESの全てである', () => {
    expect(
      WEEK_TOURNAMENT_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(WEEK_TOURNAMENT_TYPES).toSorted());
  });

  describe.each(['api', 'event'] as const)('アプリの名前が%s', (appName) => {
    test.each(
      (['fetch', 'queue', 'scheduled'] as const).flatMap((kind) =>
        WEEK_TOURNAMENT_IMPLEMENTATIONS.map(
          ([name, implementation]) => [kind, name, implementation] as const,
        ),
      ),
    )(
      '%sの処理単位のコンテナから%sを上流の共通の束縛と組んだ実装に解決する',
      (kind, name, implementation) => {
        expect(
          createContainer({ kind, appName }).get(WEEK_TOURNAMENT_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createContainer();
    const second = createContainer();

    expect(first.get(WEEK_TOURNAMENT_TYPES.WeekDrawService)).toBe(
      first.get(WEEK_TOURNAMENT_TYPES.WeekDrawService),
    );
    expect(first.get(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)).toBe(
      first.get(WEEK_TOURNAMENT_TYPES.WeekTournamentStore),
    );
    expect(first.get(WEEK_TOURNAMENT_TYPES.WeekDrawService)).not.toBe(
      second.get(WEEK_TOURNAMENT_TYPES.WeekDrawService),
    );
  });

  test('週のトーナメントのストアは処理単位のD1から週の行を読める', async () => {
    const store = createContainer().get<WeekTournamentStore>(
      WEEK_TOURNAMENT_TYPES.WeekTournamentStore,
    );

    await expect(store.findTournamentByWeek(WEEK_START)).resolves.toMatchObject(
      {
        tournamentId: weekTournamentIdOf(1),
        window: expect.objectContaining({ weekStart: WEEK_START }) as unknown,
        status: 'open',
      },
    );
  });

  test('返金の知らせの決済履歴への導線を環境のクライアントサイトのオリジンから組み立てる', async () => {
    const emails = createRecordingSender();
    await insertWeekEntries([
      {
        index: 1,
        tournament: 1,
        launch: 1,
        product: 1,
        owner: OWNER,
        columns: {
          status: 'forfeited',
          closeReason: 'deleted',
          entitlementSource: 'payment',
          purchaseId: '01JD0PVRCHASE0000000000001',
          refundStatus: 'requested',
          refundNoticeStatus: 'pending',
        },
      },
    ]);
    const followUp = createContainer({ emails }).get<WeekEntryFollowUp>(
      WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp,
    );

    await followUp.process([weekEntryIdOf(1)], NOW);

    expect(emails.sent).toEqual([
      expect.objectContaining({
        kind: TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
        to: emailOf(OWNER),
        input: expect.objectContaining({
          weekLabel: formatWeekPeriodLabel(WEEK_START),
          billingUrl: new URL('/settings/billing', env.CLIENT_SITE_ORIGIN).href,
        }) as unknown,
      }),
    ]);
  });
});

describe('購入種別の登録の定数', () => {
  test('購入種別week_tournament_entryを、Weekの購入の可否と参加資格の付与の識別子へ結ぶ凍結した値である', () => {
    expect(WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION).toEqual({
      kind: 'week_tournament_entry',
      offer: WEEK_TOURNAMENT_TYPES.WeekEntryOfferPolicy,
      fulfillment: WEEK_TOURNAMENT_TYPES.WeekEntryFulfillment,
    });
    expect(Object.isFrozen(WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION)).toBe(
      true,
    );
  });

  test('paymentsの購入種別の解決は登録を返し、その識別子は処理単位のコンテナでWeekの実装に解決される', () => {
    const container = createContainer();

    const registration = container
      .get<PurchaseKindRegistry<PurchaseKindRegistration>>(
        PAYMENTS_TYPES.PurchaseKindRegistry,
      )
      .resolve('week_tournament_entry', PAYMENTS_ENV);

    expect(registration).toBe(WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION);
    expect(container.get(registration?.offer ?? Symbol())).toBeInstanceOf(
      WeekEntryOfferPolicy,
    );
    expect(container.get(registration?.fulfillment ?? Symbol())).toBeInstanceOf(
      WeekEntryFulfillment,
    );
  });
});
