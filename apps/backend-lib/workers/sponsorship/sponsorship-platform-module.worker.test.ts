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

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
} from '../../core/payments/purchase-kind-contract.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../core/sponsorship/identifiers.ts';
import type {
  NoticeRequester,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { PurchaseKindRegistration } from '../payments/fulfillment-contract.ts';
import { createPaymentsPlatformModule } from '../payments/payments-platform-module.ts';
import { PRODUCT_PLATFORM_MODULE } from '../product/product-platform-module.ts';
import { createSponsorshipPlatformModule } from './sponsorship-platform-module.ts';
import { SPONSORSHIP_PURCHASE_KIND_REGISTRATION } from './sponsorship-registrations.ts';
import { SponsorshipFulfillment } from './sponsorship-fulfillment.ts';
import { SponsorshipOfferPolicy } from './sponsorship-offer-policy.ts';
import {
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from './testing/observability-recording.ts';
import {
  clearSponsorshipTables,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  sponsorshipPurchaseIdOf,
  TODAY,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';
import { SPONSORSHIP_IMPLEMENTATIONS } from './testing/sponsorship-platform-implementations.ts';

type AppName = LoggingOptions['appName'];

const PAYMENTS_ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'true',
  CLIENT_SITE_ORIGIN: env.CLIENT_SITE_ORIGIN,
};

const OWNER = 1;

// 基準時刻(UTC-08:00)の2026-11-25の0:07。開始日が今日の申込の開始通知を確定で依頼待ちにする時刻
const START_NOTICE_AT = new Date('2026-11-25T08:07:00.000Z');

// 開始通知の送信の依頼を必ず失敗させ、確定の後のwarnのログを出させる
function failingNoticesOverride(): Pick<AppModule, 'bindings'> {
  const failing: NoticeRequester = {
    request: () => Promise.reject(new Error('Queueへの送信に失敗しました')),
    requestSettlement: () => Promise.reject(new Error('テストでは使わない')),
  };
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<NoticeRequester>(
        SPONSORSHIP_PLATFORM_TYPES.NoticeRequester,
      ).toConstantValue(failing);
    }),
  };
}

function createContainer(
  options: {
    readonly kind?: InvocationScopeInfo['kind'];
    readonly appName?: AppName;
    readonly failNotices?: boolean;
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
      createPaymentsPlatformModule(appName),
      createSponsorshipPlatformModule(appName),
      ...(options.failNotices === true ? [failingNoticesOverride()] : []),
    ],
  );
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
});

afterAll(() => {
  resetSync();
});

describe('createSponsorshipPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられ、経路を持たない', () => {
    const module = createSponsorshipPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
      createSponsorshipPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('sponsorship-platform');
    expect('routes' in module).toBe(false);
  });

  test('解決を確かめる識別子はSPONSORSHIP_PLATFORM_TYPESの全てである', () => {
    expect(
      SPONSORSHIP_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(SPONSORSHIP_PLATFORM_TYPES).toSorted());
  });

  describe.each(['api', 'event'] as const)('アプリの名前が%s', (appName) => {
    test.each(
      (['fetch', 'queue', 'scheduled'] as const).flatMap((kind) =>
        SPONSORSHIP_IMPLEMENTATIONS.map(
          ([name, implementation]) => [kind, name, implementation] as const,
        ),
      ),
    )(
      '%sの処理単位のコンテナから%sを上流の共通の束縛と組んだ実装に解決する',
      (kind, name, implementation) => {
        expect(
          createContainer({ kind, appName }).get(
            SPONSORSHIP_PLATFORM_TYPES[name],
          ),
        ).toBeInstanceOf(implementation);
      },
    );
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createContainer();
    const second = createContainer();

    expect(first.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)).toBe(
      first.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore),
    );
    expect(first.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment)).toBe(
      first.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment),
    );
    expect(first.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)).not.toBe(
      second.get(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore),
    );
  });

  test('返金の見積もりと日割りの返金の精算は、1つの処理単位で同じインスタンスに解決する', () => {
    const container = createContainer();

    expect(container.get(SPONSORSHIP_PLATFORM_TYPES.RefundEstimator)).toBe(
      container.get(SPONSORSHIP_PLATFORM_TYPES.RefundSettlement),
    );
  });

  test('申込のストアは処理単位のD1から申込の行を読める', async () => {
    await insertSponsorships([{ index: 1, owner: OWNER, product: 1 }]);
    const store = createContainer().get<SponsorshipStore>(
      SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore,
    );

    await expect(store.findById(sponsorshipIdOf(1))).resolves.toMatchObject({
      id: sponsorshipIdOf(1),
      userId: userIdOf(OWNER),
      state: 'pending_payment',
    });
  });

  describe.each(['api', 'event'] as const)(
    '購入種別の口のログ(アプリの名前が%s)',
    (appName) => {
      afterAll(() => {
        resetSponsorshipObservability();
      });

      test('掲載権の付与の口のログのカテゴリは、束縛したアプリの名前で始まる', async () => {
        const logs = recordSponsorshipLogs(appName);
        await insertSponsorships([
          {
            index: 1,
            owner: OWNER,
            product: 1,
            columns: paidColumnsOf(1, {
              startsOn: TODAY,
              endsOn: TODAY,
              days: 1,
              paidAt: START_NOTICE_AT,
              startNotice: 'pending',
            }),
          },
        ]);
        const fulfillment = createContainer({
          appName,
          failNotices: true,
        }).get<SponsorshipFulfillment>(
          SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment,
        );

        await fulfillment.afterCommit({
          purchaseId: sponsorshipPurchaseIdOf(1),
          userId: userIdOf(OWNER),
          kind: 'sponsorship',
          targetId: sponsorshipIdOf(1),
          relatedId: sponsorshipIdOf(1),
          quantity: 1,
          amountTotal: 1_000,
          paymentRecordId: sponsorshipPaymentRecordIdOf(1),
          paidAt: START_NOTICE_AT,
          stripeSubscriptionId: null,
        });

        expect(
          logs
            .filter(({ level }) => level === 'warning')
            .map(({ category }) => category),
        ).toEqual([`${appName}.sponsorship.fulfillment`]);
      });
    },
  );
});

describe('購入種別の登録の定数', () => {
  test('購入種別sponsorshipを、スポンサー広告の購入の可否と掲載権の付与の識別子へ結ぶ凍結した値である', () => {
    expect(SPONSORSHIP_PURCHASE_KIND_REGISTRATION).toEqual({
      kind: 'sponsorship',
      offer: SPONSORSHIP_PLATFORM_TYPES.SponsorshipOfferPolicy,
      fulfillment: SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment,
    });
    expect(Object.isFrozen(SPONSORSHIP_PURCHASE_KIND_REGISTRATION)).toBe(true);
  });

  test('paymentsの購入種別の解決は登録を返し、その識別子は処理単位のコンテナでスポンサー広告の実装に解決される', () => {
    const container = createContainer();

    const registration = container
      .get<PurchaseKindRegistry<PurchaseKindRegistration>>(
        PAYMENTS_TYPES.PurchaseKindRegistry,
      )
      .resolve('sponsorship', PAYMENTS_ENV);

    expect(registration).toBe(SPONSORSHIP_PURCHASE_KIND_REGISTRATION);
    expect(container.get(registration?.offer ?? Symbol())).toBeInstanceOf(
      SponsorshipOfferPolicy,
    );
    expect(container.get(registration?.fulfillment ?? Symbol())).toBeInstanceOf(
      SponsorshipFulfillment,
    );
  });
});
