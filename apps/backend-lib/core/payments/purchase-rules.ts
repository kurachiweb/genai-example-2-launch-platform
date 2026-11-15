import type {
  PurchaseStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import { AppError } from '../errors/app-error.ts';
import type { PurchaseOffer } from './purchase-kind-contract.ts';

export const SESSION_DEFAULT_LIFETIME_MS = 86_400_000;

// 開いたままの決済で広告の掲載開始日や価格が古くならないよう、決済期限の無い購入は短くする
export const SESSION_UNBOUNDED_LIFETIME_MS = 3_600_000;

// Stripeの決済セッションのexpires_atは作成から30分より前にできない
export const SESSION_MIN_LIFETIME_MS = 1_800_000;

export function computeSessionExpiry(now: Date, deadlineAt: Date | null): Date {
  const nowMs = now.getTime();
  const expiresAtMs =
    deadlineAt === null
      ? nowMs + SESSION_UNBOUNDED_LIFETIME_MS
      : Math.min(nowMs + SESSION_DEFAULT_LIFETIME_MS, deadlineAt.getTime());
  return new Date(Math.max(expiresAtMs, nowMs + SESSION_MIN_LIFETIME_MS));
}

export function assertAcceptable(now: Date, offer: PurchaseOffer): void {
  if (
    offer.acceptUntil !== null &&
    now.getTime() >= offer.acceptUntil.getTime()
  ) {
    throw new AppError({
      kind: 'unprocessable',
      code: 'checkout_closed',
      message: '決済の受付は終了しました。',
    });
  }
}

export type PurchaseAdvanceTarget = Extract<
  PurchaseStatus,
  'processing' | 'fulfilled' | 'rejected' | 'expired'
>;

// 完了した購入(fulfilled・rejected・expired)は戻さない。失効の前に旧セッションで支払いが確定し得るため、supersededからも進める
export const ADVANCEABLE_FROM: Readonly<
  Record<PurchaseAdvanceTarget, readonly PurchaseStatus[]>
> = Object.freeze({
  processing: Object.freeze(['open', 'superseded'] as const),
  fulfilled: Object.freeze(['open', 'processing', 'superseded'] as const),
  rejected: Object.freeze(['open', 'processing', 'superseded'] as const),
  expired: Object.freeze(['open', 'processing', 'superseded'] as const),
});

export type CompletionDecision =
  | { readonly kind: 'try_fulfill' }
  | {
      readonly kind: 'reject';
      readonly reason: Extract<RejectionReason, 'late'>;
    };

export function decideCompletion(input: {
  readonly paidAt: Date;
  readonly fulfillableUntil: Date | null;
}): CompletionDecision {
  if (
    input.fulfillableUntil !== null &&
    input.paidAt.getTime() > input.fulfillableUntil.getTime()
  ) {
    return { kind: 'reject', reason: 'late' };
  }
  return { kind: 'try_fulfill' };
}
