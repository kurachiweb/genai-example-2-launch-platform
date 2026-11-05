import type { StripeGateway } from '../../../core/payments/ports.ts';

export type StripeGatewayMethod = keyof StripeGateway;

export interface StripeGatewayCall {
  readonly method: StripeGatewayMethod;
  readonly args: readonly unknown[];
}

export interface FakeStripeGateway extends StripeGateway {
  readonly calls: readonly StripeGatewayCall[];
  callsOf(method: StripeGatewayMethod): readonly StripeGatewayCall[];
}

// 型検査で契約の全ての操作を挙げていることを確かめる
const METHODS: Readonly<Record<StripeGatewayMethod, true>> = {
  ensureCustomer: true,
  deleteCustomer: true,
  resolvePrices: true,
  createCheckoutSession: true,
  retrieveCheckoutSession: true,
  expireCheckoutSession: true,
  retrieveInvoice: true,
  retrieveRefund: true,
  retrieveDispute: true,
  retrieveSubscription: true,
  createRefund: true,
  cancelSubscription: true,
  createPortalSession: true,
  retrievePaymentIntentOwner: true,
};

type AnyHandler = (...args: readonly unknown[]) => Promise<unknown>;

// テストが渡した操作だけに応答し、呼び出しを記録する。渡していない操作の呼び出しは想定外としてテストを失敗させる
export function createFakeStripeGateway(
  handlers: Partial<StripeGateway> = {},
): FakeStripeGateway {
  const calls: StripeGatewayCall[] = [];
  const operations = Object.fromEntries(
    Object.keys(METHODS).map((key) => {
      const method = key as StripeGatewayMethod;
      const operation: AnyHandler = async (...args) => {
        calls.push({ method, args });
        const handler = handlers[method] as AnyHandler | undefined;
        if (handler === undefined) {
          throw new Error(`偽のStripeGatewayに${method}の応答がありません`);
        }
        return handler(...args);
      };
      return [method, operation];
    }),
  ) as unknown as StripeGateway;
  return {
    ...operations,
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method),
  };
}
