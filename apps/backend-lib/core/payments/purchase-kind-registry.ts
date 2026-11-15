import type { PurchaseKind } from '../../../common-lib/payments/purchase-kinds.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
  PurchaseOfferRegistration,
} from './purchase-kind-contract.ts';

export class PurchaseKindRegistrationError extends Error {
  override readonly name = 'PurchaseKindRegistrationError';
}

// <spec名>.<名詞句>の形で、各部分は小文字の英数字をハイフンでつなぐ(例: ultras-subscription.plan-state)
const SUBSCRIPTION_EVENT_SINK_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const isEnabled = (
  registration: PurchaseOfferRegistration,
  env: PaymentsEnv,
): boolean => registration.enabled?.(env) ?? true;

export function createPurchaseKindRegistry<
  TRegistration extends PurchaseOfferRegistration,
>(
  registrations: readonly TRegistration[],
): PurchaseKindRegistry<TRegistration> {
  const byKind = new Map<PurchaseKind, TRegistration>();
  for (const registration of registrations) {
    if (byKind.has(registration.kind)) {
      throw new PurchaseKindRegistrationError(
        `購入種別${JSON.stringify(registration.kind)}が重ねて登録されています`,
      );
    }
    byKind.set(registration.kind, registration);
  }
  return Object.freeze({
    resolve: (kind: PurchaseKind, env: PaymentsEnv) => {
      const registration = byKind.get(kind);
      return registration !== undefined && isEnabled(registration, env)
        ? registration
        : undefined;
    },
  });
}

export function assertSubscriptionEventSinkNames(
  registrations: readonly { readonly name: string }[],
): void {
  const names = new Set<string>();
  for (const { name } of registrations) {
    if (!SUBSCRIPTION_EVENT_SINK_NAME_PATTERN.test(name)) {
      throw new PurchaseKindRegistrationError(
        `定期課金の受け取り口の名前は<spec名>.<名詞句>の形で指定してください: ${JSON.stringify(name)}`,
      );
    }
    if (names.has(name)) {
      throw new PurchaseKindRegistrationError(
        `定期課金の受け取り口の名前が重複しています: ${JSON.stringify(name)}`,
      );
    }
    names.add(name);
  }
}
