import type { Logger } from '@logtape/logtape';

import {
  PURCHASE_KINDS,
  type PurchaseKind,
} from '../../../common-lib/payments/purchase-kinds.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type PurchaseRecord,
  type PurchaseStore,
  type StripeGateway,
  StripeNotFoundError,
  type StripePaymentOwnerHint,
} from '../../core/payments/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { includes } from './stripe-snapshots.ts';

export interface PaymentOwnerTarget {
  readonly objectType: 'invoice' | 'refund' | 'dispute';
  // 結び付かないときにログへ残す、StripeのオブジェクトのID
  readonly objectId: string;
  readonly paymentIntentId: string | null;
  // 請求の定期課金のメタデータ。請求以外は省く
  readonly subscriptionMetadata?: Readonly<Record<string, string>>;
}

export type PaymentOwnerResolution =
  | {
      readonly kind: 'resolved';
      readonly pseudonymousId: string;
      readonly purchaseKind: PurchaseKind;
      // 物理削除の後もメタデータの購入IDを返す
      readonly purchaseId: string | null;
      // 物理削除の後はnull
      readonly purchase: PurchaseRecord | null;
    }
  | { readonly kind: 'unresolved' };

// 本サービスが決済セッションの作成時に付けたメタデータから、返金・チャージバック・請求の持ち主を特定する
export interface PaymentOwnerResolver {
  // Stripeの一時的な失敗は例外
  resolve(target: PaymentOwnerTarget): Promise<PaymentOwnerResolution>;
}

export interface StripePaymentOwnerResolverDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly gateway: StripeGateway;
  readonly purchases: PurchaseStore;
}

interface MetadataOwner {
  readonly pseudonymousId: string;
  readonly purchaseId: string | null;
  readonly purchaseKind: PurchaseKind | null;
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function ownerOf(
  metadata: Readonly<Record<string, string>> | null | undefined,
): MetadataOwner | undefined {
  const pseudonymousId = nonEmpty(metadata?.pseudonymous_id);
  if (pseudonymousId === null) {
    return undefined;
  }
  const purchaseKind = nonEmpty(metadata?.purchase_kind);
  return {
    pseudonymousId,
    purchaseId: nonEmpty(metadata?.purchase_id),
    purchaseKind: includes(PURCHASE_KINDS, purchaseKind) ? purchaseKind : null,
  };
}

export class StripePaymentOwnerResolver implements PaymentOwnerResolver {
  private readonly gateway: StripeGateway;
  private readonly purchases: PurchaseStore;
  private readonly logger: Logger;

  constructor(dependencies: StripePaymentOwnerResolverDependencies) {
    this.gateway = dependencies.gateway;
    this.purchases = dependencies.purchases;
    this.logger = getAppLogger([dependencies.appName, 'payments', 'owner']);
  }

  async resolve(target: PaymentOwnerTarget): Promise<PaymentOwnerResolution> {
    const { paymentIntentId } = target;
    const [purchaseByPaymentIntent, hint] =
      paymentIntentId === null
        ? [undefined, undefined]
        : await Promise.all([
            this.purchases.findByPaymentIntentId(paymentIntentId),
            this.retrieveHint(paymentIntentId),
          ]);
    // 都度決済はPaymentIntent、定期課金は定期課金にメタデータを付けているため、この順に探す
    const owner =
      ownerOf(hint?.metadata) ??
      ownerOf(hint?.subscriptionMetadata) ??
      ownerOf(target.subscriptionMetadata);
    if (owner !== undefined) {
      const purchase =
        purchaseByPaymentIntent ??
        (owner.purchaseId === null
          ? undefined
          : await this.purchases.findById(owner.purchaseId));
      const purchaseKind = purchase?.kind ?? owner.purchaseKind;
      if (purchaseKind !== null) {
        return {
          kind: 'resolved',
          pseudonymousId: owner.pseudonymousId,
          purchaseKind,
          purchaseId: purchase?.id ?? owner.purchaseId,
          purchase: purchase ?? null,
        };
      }
    }
    this.logger.warn(
      '本サービスの購入・利用者に結び付かないStripeの通知を反映しませんでした',
      {
        objectType: target.objectType,
        objectId: target.objectId,
        paymentIntentId,
      },
    );
    return { kind: 'unresolved' };
  }

  private async retrieveHint(
    paymentIntentId: string,
  ): Promise<StripePaymentOwnerHint | undefined> {
    try {
      return await this.gateway.retrievePaymentIntentOwner(paymentIntentId);
    } catch (error) {
      if (error instanceof StripeNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }
}
