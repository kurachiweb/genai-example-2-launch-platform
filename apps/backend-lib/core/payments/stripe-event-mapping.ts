import type { ReflectionInstruction, VerifiedStripeEvent } from './ports.ts';

type DisputeStage = Extract<
  ReflectionInstruction,
  { kind: 'dispute' }
>['stage'];

type InstructionBuilder = (
  objectId: string,
  occurredAt: Date,
) => ReflectionInstruction;

const toCheckoutSession: InstructionBuilder = (sessionId, occurredAt) => ({
  kind: 'checkout_session',
  sessionId,
  occurredAt,
});

const toInvoice: InstructionBuilder = (invoiceId, occurredAt) => ({
  kind: 'invoice',
  invoiceId,
  occurredAt,
});

const toSubscription: InstructionBuilder = (subscriptionId, occurredAt) => ({
  kind: 'subscription',
  subscriptionId,
  occurredAt,
});

const toRefund: InstructionBuilder = (refundId, occurredAt) => ({
  kind: 'refund',
  refundId,
  occurredAt,
});

function toDispute(stage: DisputeStage): InstructionBuilder {
  return (disputeId, occurredAt) => ({
    kind: 'dispute',
    disputeId,
    stage,
    occurredAt,
  });
}

// 種類を足す・減らすときは、Webhook endpointの購読の一覧と運用文書の表も同じ変更で合わせる
const INSTRUCTION_BUILDERS: ReadonlyMap<string, InstructionBuilder> = new Map([
  ['checkout.session.completed', toCheckoutSession],
  ['checkout.session.async_payment_succeeded', toCheckoutSession],
  ['checkout.session.async_payment_failed', toCheckoutSession],
  ['checkout.session.expired', toCheckoutSession],
  ['invoice.paid', toInvoice],
  ['invoice.payment_failed', toInvoice],
  ['customer.subscription.created', toSubscription],
  ['customer.subscription.updated', toSubscription],
  ['customer.subscription.deleted', toSubscription],
  ['refund.created', toRefund],
  ['refund.updated', toRefund],
  ['refund.failed', toRefund],
  ['charge.dispute.funds_withdrawn', toDispute('funds_withdrawn')],
  ['charge.dispute.funds_reinstated', toDispute('funds_reinstated')],
  ['charge.dispute.closed', toDispute('closed')],
]);

export const HANDLED_STRIPE_EVENT_TYPES: readonly string[] = Object.freeze([
  ...INSTRUCTION_BUILDERS.keys(),
]);

const MILLISECONDS_PER_SECOND = 1000;

// 反映は対象の最新の状態をStripeから取得し直すため、通知の本文からは種類・発生時刻・対象のIDだけを使う
export function mapStripeEvent(
  event: Pick<VerifiedStripeEvent, 'type' | 'created' | 'data'>,
): ReflectionInstruction {
  const build = INSTRUCTION_BUILDERS.get(event.type);
  if (build === undefined) {
    return { kind: 'ignored', eventType: event.type };
  }
  return build(
    event.data.object.id,
    new Date(event.created * MILLISECONDS_PER_SECOND),
  );
}
