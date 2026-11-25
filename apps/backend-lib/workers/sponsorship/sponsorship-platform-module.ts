import { type Bind, ContainerModule, type ResolutionContext } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type { PaymentRefunds } from '../../core/payments/ports.ts';
import type { PurchaseOfferPolicy } from '../../core/payments/purchase-kind-contract.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../core/sponsorship/identifiers.ts';
import type {
  DisplayStopStore,
  EligibleProductReader,
  NoticeRequester,
  NoticeScheduler,
  PlacementReader,
  RefundEstimator,
  SponsorshipExport,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { PurchaseFulfillment } from '../payments/fulfillment-contract.ts';
import type { PaymentRefundStatements } from '../payments/statement-contracts.ts';
import { D1DisplayStopStore } from './d1-display-stop-store.ts';
import { D1EligibleProductReader } from './d1-eligible-product-reader.ts';
import { D1NoticeScheduler } from './d1-notice-scheduler.ts';
import { D1PlacementReader } from './d1-placement-reader.ts';
import { D1SponsorshipExport } from './d1-sponsorship-export.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import {
  D1DisplayStopStatements,
  type DisplayStopStatements,
} from './display-stop-statements.ts';
import { QueueNoticeRequester } from './queue-notice-requester.ts';
import {
  D1RefundSettlement,
  type RefundSettlement,
} from './refund-settlement.ts';
import { SponsorshipFulfillment } from './sponsorship-fulfillment.ts';
import { SponsorshipOfferPolicy } from './sponsorship-offer-policy.ts';

type AppName = LoggingOptions['appName'];

function bindStores(bind: Bind): void {
  bind<SponsorshipStore>(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    .to(D1SponsorshipStore)
    .inSingletonScope();
  bind<EligibleProductReader>(SPONSORSHIP_PLATFORM_TYPES.EligibleProductReader)
    .to(D1EligibleProductReader)
    .inSingletonScope();
  bind<PlacementReader>(SPONSORSHIP_PLATFORM_TYPES.PlacementReader)
    .to(D1PlacementReader)
    .inSingletonScope();
  bind<NoticeScheduler>(SPONSORSHIP_PLATFORM_TYPES.NoticeScheduler)
    .to(D1NoticeScheduler)
    .inSingletonScope();
  bind<NoticeRequester>(SPONSORSHIP_PLATFORM_TYPES.NoticeRequester)
    .to(QueueNoticeRequester)
    .inSingletonScope();
  bind<DisplayStopStore>(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStore)
    .to(D1DisplayStopStore)
    .inSingletonScope();
  bind<DisplayStopStatements>(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStatements)
    .to(D1DisplayStopStatements)
    .inSingletonScope();
  bind<SponsorshipExport>(SPONSORSHIP_PLATFORM_TYPES.SponsorshipExport)
    .to(D1SponsorshipExport)
    .inSingletonScope();
}

// paymentsの登録箇所(purchase-kind-registrations.ts)が指す購入の可否と掲載権の付与の識別子を束縛する
function bindPaymentsPorts(bind: Bind, appName: AppName): void {
  bind<PurchaseOfferPolicy>(SPONSORSHIP_PLATFORM_TYPES.SponsorshipOfferPolicy)
    .to(SponsorshipOfferPolicy)
    .inSingletonScope();
  bind<PurchaseFulfillment>(SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment)
    .toDynamicValue(
      (context) =>
        new SponsorshipFulfillment({
          appName,
          store: context.get<SponsorshipStore>(
            SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore,
          ),
          eligibleProducts: context.get<EligibleProductReader>(
            SPONSORSHIP_PLATFORM_TYPES.EligibleProductReader,
          ),
          notices: context.get<NoticeRequester>(
            SPONSORSHIP_PLATFORM_TYPES.NoticeRequester,
          ),
        }),
    )
    .inSingletonScope();
}

const createRefundSettlement = (
  context: ResolutionContext,
  appName: AppName,
): D1RefundSettlement =>
  new D1RefundSettlement({
    appName,
    displayStops: context.get<DisplayStopStore>(
      SPONSORSHIP_PLATFORM_TYPES.DisplayStopStore,
    ),
    refundStatements: context.get<PaymentRefundStatements>(
      PAYMENTS_TYPES.PaymentRefundStatements,
    ),
    refunds: context.get<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds),
  });

// 強制終了の見積もりと確定が同じ計算を使うよう、1つの実装を2つの識別子から引けるようにする
function bindRefunds(bind: Bind, appName: AppName): void {
  bind<RefundSettlement>(SPONSORSHIP_PLATFORM_TYPES.RefundSettlement)
    .toDynamicValue((context) => createRefundSettlement(context, appName))
    .inSingletonScope();
  bind<RefundEstimator>(SPONSORSHIP_PLATFORM_TYPES.RefundEstimator)
    .toDynamicValue((context) =>
      context.get<D1RefundSettlement>(
        SPONSORSHIP_PLATFORM_TYPES.RefundSettlement,
      ),
    )
    .inSingletonScope();
}

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。部品は決済・プロダクトの共通の束縛が同じコンテナにある前提で組み立て、アプリの名前はログのカテゴリの先頭になる
export function createSponsorshipPlatformModule(
  appName: AppName,
): Omit<AppModule, 'routes'> {
  return {
    name: 'sponsorship-platform',
    bindings: new ContainerModule(({ bind }) => {
      bindStores(bind);
      bindPaymentsPorts(bind, appName);
      bindRefunds(bind, appName);
    }),
  };
}
