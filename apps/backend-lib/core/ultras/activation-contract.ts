import type { ServiceIdentifier } from 'inversify';

export interface UltrasActivation {
  readonly activationId: string;
  readonly userId: string;
  readonly stripeSubscriptionId: string;
  readonly activatedAt: Date;
}

// 例外を投げると知らせ全体が再試行されるため、同じ知らせを2回以上受けても結果が変わらないようにする
export interface UltrasActivationHandler {
  handle(activation: UltrasActivation): Promise<void>;
}

export interface UltrasActivationHandlerRegistration {
  readonly name: string;
  readonly order: number;
  readonly handler: ServiceIdentifier<UltrasActivationHandler>;
}

export class UltrasActivationRegistrationError extends Error {
  override readonly name = 'UltrasActivationRegistrationError';
}

// <spec名>.<名詞句>の形で、各部分の文字の規則はメッセージの種別と同じにする(例: tournament-week.open-entry-checkout-expiry)
const HANDLER_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertUltrasActivationHandlerName(name: string): void {
  if (!HANDLER_NAME_PATTERN.test(name)) {
    throw new UltrasActivationRegistrationError(
      `加入の知らせの処理の名前は<spec名>.<名詞句>の形で指定してください: ${JSON.stringify(name)}`,
    );
  }
}

function assertOrder(registration: UltrasActivationHandlerRegistration): void {
  if (!Number.isInteger(registration.order)) {
    throw new UltrasActivationRegistrationError(
      `加入の知らせの処理${JSON.stringify(registration.name)}のorderは整数で指定してください: ${String(registration.order)}`,
    );
  }
}

function assertDistinct(
  accepted: readonly UltrasActivationHandlerRegistration[],
  registration: UltrasActivationHandlerRegistration,
): void {
  if (accepted.some(({ name }) => name === registration.name)) {
    throw new UltrasActivationRegistrationError(
      `加入の知らせの処理の名前が重複しています: ${JSON.stringify(registration.name)}`,
    );
  }
  const colliding = accepted.find(({ order }) => order === registration.order);
  if (colliding !== undefined) {
    throw new UltrasActivationRegistrationError(
      `加入の知らせの処理${JSON.stringify(colliding.name)}と${JSON.stringify(registration.name)}のorderが重複しています: ${String(registration.order)}`,
    );
  }
}

export function createUltrasActivationRegistry(
  registrations: readonly UltrasActivationHandlerRegistration[],
): readonly UltrasActivationHandlerRegistration[] {
  const accepted = registrations.reduce<
    readonly UltrasActivationHandlerRegistration[]
  >((validated, registration) => {
    assertUltrasActivationHandlerName(registration.name);
    assertOrder(registration);
    assertDistinct(validated, registration);
    return [...validated, registration];
  }, []);
  return Object.freeze(
    accepted.toSorted((left, right) => left.order - right.order),
  );
}
