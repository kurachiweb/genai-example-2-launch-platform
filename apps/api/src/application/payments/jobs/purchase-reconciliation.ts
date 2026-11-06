import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import {
  type PaymentReflector,
  type PurchaseRecord,
  type PurchaseStore,
  type StripeCheckoutSessionSnapshot,
  type StripeGateway,
  StripeNotFoundError,
} from '../../../../lib/core/payments/ports.ts';
import { ADVANCEABLE_FROM } from '../../../../lib/core/payments/purchase-rules.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type { PaymentsJobIncidentReporter } from './payments-job-incidents.ts';

export interface ReconciliationTally {
  readonly targets: number;
  readonly applied: number;
  readonly unchanged: number;
  readonly failed: number;
}

export interface PurchaseReconciliation {
  readonly job: string;
  readonly gateway: StripeGateway;
  readonly reflector: PaymentReflector;
  readonly purchases: PurchaseStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly incidents: PaymentsJobIncidentReporter;
}

type ReconcileResult = 'applied' | 'unchanged';

const logger = getAppLogger(['api', 'payments', 'checkout-expiry']);

// Stripeに決済セッションが無い購入は支払われ得ない。失敗として残すと毎回の突合で知らせ続け、件数の上限の枠を使い続けるため、失効へ進める
async function expireMissing(
  { purchases, ids, clock }: PurchaseReconciliation,
  purchase: PurchaseRecord,
  sessionId: string,
): Promise<ReconcileResult> {
  logger.warn('Stripeに決済セッションが無いため、購入を失効にします', {
    purchaseId: purchase.id,
    sessionId,
  });
  const advanced = await purchases.advanceAlone({
    purchaseId: purchase.id,
    to: 'expired',
    from: ADVANCEABLE_FROM.expired,
    nextToken: ids.generate(),
    patch: { lastEventAt: clock.now() },
  });
  return advanced ? 'applied' : 'unchanged';
}

async function reconcileOne(
  reconciliation: PurchaseReconciliation,
  purchase: PurchaseRecord,
  sessionId: string,
): Promise<ReconcileResult> {
  let snapshot: StripeCheckoutSessionSnapshot;
  try {
    snapshot = await reconciliation.gateway.retrieveCheckoutSession(sessionId);
  } catch (error: unknown) {
    if (!(error instanceof StripeNotFoundError)) {
      throw error;
    }
    return expireMissing(reconciliation, purchase, sessionId);
  }
  const outcome = await reconciliation.reflector.reflectCheckoutSnapshot(
    snapshot,
    reconciliation.clock.now(),
  );
  return outcome.kind === 'applied' ? 'applied' : 'unchanged';
}

// 反映は状態の前進だけを行うため、同じ購入を何度突合しても結果は変わらない。1件の失敗で残りを止めず、失敗した購入はエラートラッキングへ知らせる
export async function reconcilePurchases(
  reconciliation: PurchaseReconciliation,
  purchases: readonly PurchaseRecord[],
): Promise<ReconciliationTally> {
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  for (const purchase of purchases) {
    const sessionId = purchase.stripeCheckoutSessionId;
    if (sessionId === null) {
      unchanged += 1;
      continue;
    }
    try {
      if (
        (await reconcileOne(reconciliation, purchase, sessionId)) === 'applied'
      ) {
        applied += 1;
      } else {
        unchanged += 1;
      }
    } catch (error: unknown) {
      failed += 1;
      reconciliation.incidents.report({
        kind: 'reconciliation-failed',
        job: reconciliation.job,
        purchaseId: purchase.id,
        error,
      });
    }
  }
  return { targets: purchases.length, applied, unchanged, failed };
}
