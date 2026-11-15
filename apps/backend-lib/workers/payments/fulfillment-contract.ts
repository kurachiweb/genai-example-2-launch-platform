import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type {
  FulfillablePurchase,
  PurchaseOfferRegistration,
  SubscriptionChange,
} from '../../core/payments/purchase-kind-contract.ts';

export type FulfillmentPlan =
  | {
      readonly kind: 'fulfill';
      readonly statements: readonly BatchItem<'sqlite'>[];
    }
  | { readonly kind: 'reject'; readonly reason: 'ineligible' };

// 権利の付与の文は条件を満たさなければ一意制約などで失敗する形にしてよく、失敗は拒否として扱い直される
export interface PurchaseFulfillment {
  // 外部の呼び出しやメッセージの送信を行わず、同じ購入には何度呼ばれても同じ判断を返す
  prepare(
    purchase: FulfillablePurchase,
    db: Database,
  ): Promise<FulfillmentPlan>;
  // 付与の一括の書き込みを確定させた側だけが1回呼ぶ。例外は呼び出し側がwarnのログにして反映の結果を変えない
  afterCommit?(purchase: FulfillablePurchase): Promise<void>;
}

export interface PurchaseKindRegistration extends PurchaseOfferRegistration {
  readonly fulfillment: ServiceIdentifier<PurchaseFulfillment>;
}

// 記録済みと同じ発生時刻の通知は再び確定し得るため、statementsForの文とafterCommitは冪等にする
export interface SubscriptionEventSink {
  statementsFor(
    change: SubscriptionChange,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
  // 定期課金の反映の一括の書き込みが確定した後に1回呼ばれる。例外はwarnのログだけにする
  afterCommit?(change: SubscriptionChange): Promise<void>;
}

export interface SubscriptionEventSinkRegistration {
  // <spec名>.<名詞句>
  readonly name: string;
  readonly sink: ServiceIdentifier<SubscriptionEventSink>;
}
