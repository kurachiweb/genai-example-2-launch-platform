import type {
  PaymentReflector,
  PurchaseRecord,
  StripeGateway,
} from '../../../../lib/core/payments/ports.ts';
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
  readonly clock: Clock;
  readonly incidents: PaymentsJobIncidentReporter;
}

// 反映は状態の前進だけを行うため、同じ購入を何度突合しても結果は変わらない。1件の失敗で残りを止めず、失敗した購入はエラートラッキングへ知らせる
export async function reconcilePurchases(
  { job, gateway, reflector, clock, incidents }: PurchaseReconciliation,
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
      const snapshot = await gateway.retrieveCheckoutSession(sessionId);
      const outcome = await reflector.reflectCheckoutSnapshot(
        snapshot,
        clock.now(),
      );
      if (outcome.kind === 'applied') {
        applied += 1;
      } else {
        unchanged += 1;
      }
    } catch (error: unknown) {
      failed += 1;
      incidents.report({
        kind: 'reconciliation-failed',
        job,
        purchaseId: purchase.id,
        error,
      });
    }
  }
  return { targets: purchases.length, applied, unchanged, failed };
}
